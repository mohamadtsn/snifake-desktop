//! The classic-BPF program that keeps the sniff loop off the data path.
//!
//! Without a kernel filter an `ETH_P_ALL` packet socket copies **every** frame
//! on the interface into user space — including every packet of the very
//! download we are relaying — only for [`classify`] to answer `Ignore`. The
//! program below answers the same question in the kernel, so the sniff thread
//! wakes for little beyond the handshake packets of our own connections.
//!
//! It is deliberately a *superset* of what `classify` accepts: the filter is
//! an optimisation and never the authority on what gets acted upon. It keeps
//! everything TCP that shares an address **and** a port with the upstream, in
//! either direction; `classify` still applies the exact test.
//!
//! Written by hand rather than pulled from a crate because it is seventeen
//! instructions, it has to be byte-identical across Linux and BSD, and it runs
//! in the kernel of a process running as root.
//!
//! [`classify`]: crate::sniffer::classify

/// One classic-BPF instruction.
///
/// The layout matches Linux's `struct sock_filter` and BSD's `struct bpf_insn`
/// field for field, which is what lets the array be handed to
/// `SO_ATTACH_FILTER`/`BIOCSETF` as-is.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Insn {
    pub code: u16,
    pub jt: u8,
    pub jf: u8,
    pub k: u32,
}

const fn insn(code: u16, jt: u8, jf: u8, k: u32) -> Insn {
    Insn { code, jt, jf, k }
}

// Opcodes, spelled out from <linux/bpf_common.h> so the constants below read
// like the tcpdump disassembly they mirror.
const LD_W_ABS: u16 = 0x20; // A = u32 at [k]
const LD_H_ABS: u16 = 0x28; // A = u16 at [k]
const LD_B_ABS: u16 = 0x30; // A = u8  at [k]
const LD_H_IND: u16 = 0x48; // A = u16 at [X + k]
const LDX_B_MSH: u16 = 0xb1; // X = 4 * (u8 at [k] & 0x0f)
const JEQ_K: u16 = 0x15;
const JSET_K: u16 = 0x45;
const RET_K: u16 = 0x06;

/// Ethernet frame offsets. The filter always runs over a link-layer frame:
/// Linux binds `AF_PACKET` with an Ethernet header present, and both Unix
/// backends refuse anything that is not `ARPHRD_ETHER`/`DLT_EN10MB`.
const ETHERTYPE: u32 = 12;
const IP_START: u32 = 14;
const IP_FLAGS_FRAG: u32 = IP_START + 6;
const IP_PROTO: u32 = IP_START + 9;
const IP_SRC: u32 = IP_START + 12;
const IP_DST: u32 = IP_START + 16;

const ETH_P_IP: u32 = 0x0800;
const IPPROTO_TCP: u32 = 6;
/// The fragment-offset field. A non-zero offset means the "ports" at the far
/// end of the IP header are payload bytes, not ports, so such a packet must
/// never reach the port comparisons.
const FRAG_OFFSET_MASK: u32 = 0x1fff;

/// `ret` value that accepts the whole frame. `u32::MAX` is the portable
/// spelling (`ret #-1`); a short snap length would truncate the very packet
/// the injector uses as its template.
const ACCEPT: u32 = u32::MAX;
const DROP: u32 = 0;

/// Number of instructions in the program. Fixed, so the jump offsets below
/// can be written as constants and checked by the assertions in the tests.
pub const PROGRAM_LEN: usize = 17;

const ACCEPT_AT: usize = 15;
const DROP_AT: usize = 16;

/// Relative jump from `at` to `target`, as classic BPF counts it: the number
/// of instructions to skip *after* the jump.
const fn jump(at: usize, target: usize) -> u8 {
    (target - at - 1) as u8
}

/// Builds the program: IPv4 TCP, unfragmented, to or from
/// `connect_ip`:`connect_port`.
pub fn upstream_only(connect_ip: [u8; 4], connect_port: u16) -> [Insn; PROGRAM_LEN] {
    let ip = u32::from_be_bytes(connect_ip);
    let port = connect_port as u32;
    [
        // 0..2  IPv4 over Ethernet?
        insn(LD_H_ABS, 0, 0, ETHERTYPE),
        insn(JEQ_K, 0, jump(1, DROP_AT), ETH_P_IP),
        // 2..4  TCP?
        insn(LD_B_ABS, 0, 0, IP_PROTO),
        insn(JEQ_K, 0, jump(3, DROP_AT), IPPROTO_TCP),
        // 4..6  first fragment only.
        insn(LD_H_ABS, 0, 0, IP_FLAGS_FRAG),
        insn(JSET_K, jump(5, DROP_AT), 0, FRAG_OFFSET_MASK),
        // 6..10  either endpoint is the upstream address.
        insn(LD_W_ABS, 0, 0, IP_SRC),
        insn(JEQ_K, jump(7, 10), 0, ip),
        insn(LD_W_ABS, 0, 0, IP_DST),
        insn(JEQ_K, 0, jump(9, DROP_AT), ip),
        // 10..15  either endpoint is the upstream port. X becomes the IP
        // header length, so options are handled without assuming 20 bytes.
        insn(LDX_B_MSH, 0, 0, IP_START),
        insn(LD_H_IND, 0, 0, IP_START),
        insn(JEQ_K, jump(12, ACCEPT_AT), 0, port),
        insn(LD_H_IND, 0, 0, IP_START + 2),
        insn(JEQ_K, jump(14, ACCEPT_AT), jump(14, DROP_AT), port),
        // 15, 16
        insn(RET_K, 0, 0, ACCEPT),
        insn(RET_K, 0, 0, DROP),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A classic-BPF interpreter covering exactly the opcodes
    /// [`upstream_only`] emits, so the program is checked by execution rather
    /// than by eye. Out-of-range loads return 0, as the kernel's do.
    fn run(prog: &[Insn], frame: &[u8]) -> u32 {
        let load = |at: u32, width: usize| -> Option<u32> {
            let at = at as usize;
            let end = at.checked_add(width)?;
            let bytes = frame.get(at..end)?;
            Some(bytes.iter().fold(0u32, |acc, b| (acc << 8) | *b as u32))
        };

        let (mut a, mut x) = (0u32, 0u32);
        let mut pc = 0usize;
        for _ in 0..1024 {
            let i = prog.get(pc).expect("program ran off the end");
            pc += 1;
            match i.code {
                LD_W_ABS | LD_H_ABS | LD_B_ABS => {
                    let width = match i.code {
                        LD_W_ABS => 4,
                        LD_H_ABS => 2,
                        _ => 1,
                    };
                    let Some(v) = load(i.k, width) else { return 0 };
                    a = v;
                }
                LD_H_IND => {
                    let Some(v) = x.checked_add(i.k).and_then(|at| load(at, 2)) else {
                        return 0;
                    };
                    a = v;
                }
                LDX_B_MSH => {
                    let Some(v) = load(i.k, 1) else { return 0 };
                    x = 4 * (v & 0x0f);
                }
                JEQ_K => pc += if a == i.k { i.jt } else { i.jf } as usize,
                JSET_K => pc += if a & i.k != 0 { i.jt } else { i.jf } as usize,
                RET_K => return i.k,
                other => panic!("the program emitted an opcode the test cannot run: {other:#x}"),
            }
        }
        panic!("the program did not terminate");
    }

    const UPSTREAM: [u8; 4] = [104, 18, 4, 130];
    const LOCAL: [u8; 4] = [192, 168, 1, 10];
    const PORT: u16 = 443;

    struct Frame {
        ethertype: u16,
        proto: u8,
        ihl: usize,
        frag: u16,
        src: [u8; 4],
        dst: [u8; 4],
        sport: u16,
        dport: u16,
    }

    impl Default for Frame {
        fn default() -> Self {
            Frame {
                ethertype: 0x0800,
                proto: 6,
                ihl: 20,
                frag: 0,
                src: LOCAL,
                dst: UPSTREAM,
                sport: 51000,
                dport: PORT,
            }
        }
    }

    impl Frame {
        /// Ethernet + IPv4 + the first four bytes of the TCP header, which is
        /// all the filter reads.
        fn bytes(&self) -> Vec<u8> {
            let mut f = vec![0u8; 14];
            f[12..14].copy_from_slice(&self.ethertype.to_be_bytes());
            let mut ip = vec![0u8; self.ihl];
            ip[0] = 0x40 | (self.ihl / 4) as u8;
            ip[6..8].copy_from_slice(&self.frag.to_be_bytes());
            ip[9] = self.proto;
            ip[12..16].copy_from_slice(&self.src);
            ip[16..20].copy_from_slice(&self.dst);
            f.extend_from_slice(&ip);
            f.extend_from_slice(&self.sport.to_be_bytes());
            f.extend_from_slice(&self.dport.to_be_bytes());
            f.extend_from_slice(&[0u8; 16]); // rest of the TCP header
            f
        }
    }

    fn verdict(frame: &Frame) -> u32 {
        run(&upstream_only(UPSTREAM, PORT), &frame.bytes())
    }

    #[test]
    fn the_jump_targets_land_on_the_two_returns() {
        let prog = upstream_only(UPSTREAM, PORT);
        assert_eq!(prog[ACCEPT_AT], insn(RET_K, 0, 0, ACCEPT));
        assert_eq!(prog[DROP_AT], insn(RET_K, 0, 0, DROP));
        for (at, i) in prog.iter().enumerate() {
            if i.code == RET_K {
                continue;
            }
            for target in [i.jt, i.jf] {
                assert!(
                    at + 1 + target as usize <= DROP_AT,
                    "instruction {at} jumps past the end of the program"
                );
            }
        }
    }

    /// Both directions of our own connection must survive: the outbound SYN
    /// registers the connection, the outbound bare ACK triggers injection and
    /// the inbound bare ACK confirms it. Dropping any of these would leave
    /// every connection unconfirmed — and the forwarder aborts those.
    #[test]
    fn keeps_both_directions_of_the_upstream_connection() {
        assert_eq!(verdict(&Frame::default()), ACCEPT, "outbound");
        assert_eq!(
            verdict(&Frame {
                src: UPSTREAM,
                dst: LOCAL,
                sport: PORT,
                dport: 51000,
                ..Frame::default()
            }),
            ACCEPT,
            "inbound"
        );
    }

    /// The port lives past the IP header, so a header carrying options is the
    /// case that a hard-coded offset would get wrong.
    #[test]
    fn reads_the_ports_past_ip_options() {
        assert_eq!(
            verdict(&Frame {
                ihl: 24,
                ..Frame::default()
            }),
            ACCEPT
        );
    }

    #[test]
    fn drops_everything_that_is_not_this_connection() {
        let cases: [(&str, Frame); 6] = [
            (
                "another host",
                Frame {
                    dst: [1, 1, 1, 1],
                    ..Frame::default()
                },
            ),
            (
                "another port on the same host",
                Frame {
                    dport: 8443,
                    ..Frame::default()
                },
            ),
            (
                "UDP",
                Frame {
                    proto: 17,
                    ..Frame::default()
                },
            ),
            (
                "IPv6",
                Frame {
                    ethertype: 0x86dd,
                    ..Frame::default()
                },
            ),
            (
                "ARP",
                Frame {
                    ethertype: 0x0806,
                    ..Frame::default()
                },
            ),
            (
                // A later fragment's "ports" are payload bytes. `classify`
                // has no fragment test of its own, so this is the one place
                // the filter is stricter than it — deliberately: a handshake
                // packet is never fragmented.
                "a later fragment",
                Frame {
                    frag: 0x0001,
                    ..Frame::default()
                },
            ),
        ];
        for (what, frame) in cases {
            assert_eq!(verdict(&frame), DROP, "{what} must be dropped");
        }
    }

    /// The don't-fragment bit sits in the same halfword as the offset and is
    /// set on virtually every packet the kernel sends; masking it in by
    /// mistake would drop the entire connection.
    #[test]
    fn the_dont_fragment_bit_is_not_a_fragment() {
        assert_eq!(
            verdict(&Frame {
                frag: 0x4000,
                ..Frame::default()
            }),
            ACCEPT
        );
    }

    /// A runt frame must not be read past its end. The last byte any of the
    /// comparisons needs is the destination port's, at offset 37, so every
    /// shorter frame has to come out as a drop.
    #[test]
    fn a_truncated_frame_is_dropped_rather_than_read_out_of_bounds() {
        let full = Frame::default().bytes();
        for len in 0..38 {
            assert_eq!(
                run(&upstream_only(UPSTREAM, PORT), &full[..len]),
                DROP,
                "a {len}-byte frame must not be accepted"
            );
        }
    }
}
