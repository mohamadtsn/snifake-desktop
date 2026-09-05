//! AF_PACKET SOCK_RAW bound to the egress interface. Needs CAP_NET_RAW,
//! which in practice means running as root.

use super::filter;
use super::{Capture, Captured, RECV_TIMEOUT};
use std::io;
use std::os::fd::{AsRawFd, OwnedFd};

const ETH_P_ALL: u16 = 0x0003;
const ETH_P_IP: u16 = 0x0800;
const ETH_HDR_LEN: usize = 14;

fn htons(v: u16) -> u16 {
    v.to_be()
}

/// Installs a classic-BPF program on the socket, so the kernel decides what
/// is worth a wake-up. `filter::Insn` has the layout of `struct sock_filter`.
fn attach_filter(fd: &OwnedFd, program: &[filter::Insn]) -> io::Result<()> {
    let prog = libc::sock_fprog {
        len: program.len() as u16,
        filter: program.as_ptr() as *mut libc::sock_filter,
    };
    // SAFETY: prog points at `program`, which outlives the call; the kernel
    // copies the instructions and keeps no reference to them.
    let rc = unsafe {
        libc::setsockopt(
            fd.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_ATTACH_FILTER,
            &prog as *const _ as *const libc::c_void,
            std::mem::size_of::<libc::sock_fprog>() as libc::socklen_t,
        )
    };
    if rc < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub struct AfPacket {
    fd: OwnedFd,
    ifindex: u32,
    buf: Vec<u8>,
}

impl AfPacket {
    pub fn open(ifindex: u32, connect_ip: [u8; 4], connect_port: u16) -> io::Result<Self> {
        // SAFETY: plain socket(2)/bind(2) with a correctly sized sockaddr_ll.
        let fd = unsafe {
            let raw = libc::socket(
                libc::AF_PACKET,
                libc::SOCK_RAW,
                htons(ETH_P_ALL) as libc::c_int,
            );
            if raw < 0 {
                return Err(io::Error::last_os_error());
            }
            use std::os::fd::FromRawFd;
            OwnedFd::from_raw_fd(raw)
        };

        // Attached *before* bind(2), so no unfiltered frame is ever queued:
        // the socket only starts receiving once it is bound. Without it every
        // frame on the interface — including every packet of the download we
        // are relaying — would be copied into user space just to be ignored.
        attach_filter(&fd, &filter::upstream_only(connect_ip, connect_port))?;

        let mut sll: libc::sockaddr_ll = unsafe { std::mem::zeroed() };
        sll.sll_family = libc::AF_PACKET as u16;
        sll.sll_protocol = htons(ETH_P_ALL);
        sll.sll_ifindex = ifindex as i32;
        // SAFETY: sll is a fully initialised sockaddr_ll of the given length.
        let rc = unsafe {
            libc::bind(
                fd.as_raw_fd(),
                &sll as *const _ as *const libc::sockaddr,
                std::mem::size_of::<libc::sockaddr_ll>() as libc::socklen_t,
            )
        };
        if rc < 0 {
            return Err(io::Error::last_os_error());
        }

        // The whole pipeline assumes an Ethernet link: `recv` strips a 14-byte
        // header and `send` puts it back. A tun/VPN or loopback interface hands
        // us raw IP instead, so every frame would fail the header check, nothing
        // would ever be classified, and — because the forwarder aborts
        // unconfirmed connections — the user would lose connectivity entirely
        // rather than merely go unspoofed. Refuse up front and say why.
        let hatype = {
            let mut got: libc::sockaddr_ll = unsafe { std::mem::zeroed() };
            let mut len = std::mem::size_of::<libc::sockaddr_ll>() as libc::socklen_t;
            // SAFETY: got/len describe a correctly sized sockaddr_ll out-param.
            let rc = unsafe {
                libc::getsockname(fd.as_raw_fd(), &mut got as *mut _ as *mut libc::sockaddr, &mut len)
            };
            if rc < 0 {
                return Err(io::Error::last_os_error());
            }
            got.sll_hatype
        };
        if hatype != libc::ARPHRD_ETHER {
            return Err(io::Error::other(format!(
                "interface index {ifindex} has ARP hardware type {hatype}, not Ethernet \
                 (ARPHRD_ETHER = {}) — only Ethernet interfaces are supported",
                libc::ARPHRD_ETHER
            )));
        }

        // Without this the sniff thread would sit in recvfrom forever on a
        // quiet interface and could never observe a stop request.
        let tv = libc::timeval {
            tv_sec: RECV_TIMEOUT.as_secs() as libc::time_t,
            tv_usec: RECV_TIMEOUT.subsec_micros() as libc::suseconds_t,
        };
        // SAFETY: tv is an initialised timeval of the given length.
        let rc = unsafe {
            libc::setsockopt(
                fd.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_RCVTIMEO,
                &tv as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::timeval>() as libc::socklen_t,
            )
        };
        if rc < 0 {
            return Err(io::Error::last_os_error());
        }

        Ok(AfPacket {
            fd,
            ifindex,
            buf: vec![0u8; 65536],
        })
    }
}

impl Capture for AfPacket {
    fn recv(&mut self, out: &mut Captured) -> io::Result<bool> {
        loop {
            // SAFETY: recvfrom into a buffer we own, length-checked below.
            let n = unsafe {
                libc::recvfrom(
                    self.fd.as_raw_fd(),
                    self.buf.as_mut_ptr() as *mut libc::c_void,
                    self.buf.len(),
                    0,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if n < 0 {
                let err = io::Error::last_os_error();
                return match err.kind() {
                    io::ErrorKind::Interrupted => continue,
                    // SO_RCVTIMEO expiry: no packet this interval, not a fault.
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut => {
                        out.clear();
                        Ok(false)
                    }
                    _ => Err(err),
                };
            }
            let n = (n as usize).min(self.buf.len());
            out.clear();
            // A rejected frame hands control back rather than looping, so a busy
            // interface full of IPv6/ARP/VLAN traffic cannot keep us in here past
            // one timeout. The caller re-enters after checking its stop flag.
            if n < ETH_HDR_LEN {
                return Ok(false);
            }
            if u16::from_be_bytes([self.buf[12], self.buf[13]]) != ETH_P_IP {
                return Ok(false);
            }
            let mut l2 = [0u8; ETH_HDR_LEN];
            l2.copy_from_slice(&self.buf[..ETH_HDR_LEN]);
            out.l2 = Some(l2);
            out.ip.extend_from_slice(&self.buf[ETH_HDR_LEN..n]);
            return Ok(true);
        }
    }

    fn send(&mut self, pkt: &Captured) -> io::Result<()> {
        send_on(&self.fd, self.ifindex, pkt)
    }

    /// A second descriptor for the same socket, via `dup(2)`: it shares the
    /// one receive queue and buffer, so this costs nothing but a file
    /// descriptor. It exists only so the injector thread has a handle of its
    /// own; concurrent `sendto(2)` on the two descriptors is serialised by
    /// the kernel.
    fn split_sender(&self) -> Option<Box<dyn Capture>> {
        let fd = self.fd.try_clone().ok()?;
        Some(Box::new(AfPacketSender {
            fd,
            ifindex: self.ifindex,
        }))
    }
}

/// Transmit-only view of an open [`AfPacket`].
///
/// `recv` is inert by construction rather than by convention: reading from
/// this descriptor would dequeue a packet the sniff loop is waiting for.
struct AfPacketSender {
    fd: OwnedFd,
    ifindex: u32,
}

impl Capture for AfPacketSender {
    fn recv(&mut self, out: &mut Captured) -> io::Result<bool> {
        out.clear();
        Ok(false)
    }

    fn send(&mut self, pkt: &Captured) -> io::Result<()> {
        send_on(&self.fd, self.ifindex, pkt)
    }
}

fn send_on(fd: &OwnedFd, ifindex: u32, pkt: &Captured) -> io::Result<()> {
    let l2 = pkt
        .l2
        .ok_or_else(|| io::Error::other("AF_PACKET send needs a link-layer header"))?;
    let mut frame = Vec::with_capacity(ETH_HDR_LEN + pkt.ip.len());
    frame.extend_from_slice(&l2);
    frame.extend_from_slice(&pkt.ip);

    let mut sll: libc::sockaddr_ll = unsafe { std::mem::zeroed() };
    sll.sll_family = libc::AF_PACKET as u16;
    sll.sll_protocol = htons(ETH_P_IP);
    sll.sll_ifindex = ifindex as i32;
    sll.sll_halen = 6;
    sll.sll_addr[..6].copy_from_slice(&l2[..6]);

    // SAFETY: frame and sll are owned, correctly sized buffers.
    let rc = unsafe {
        libc::sendto(
            fd.as_raw_fd(),
            frame.as_ptr() as *const libc::c_void,
            frame.len(),
            0,
            &sll as *const _ as *const libc::sockaddr,
            std::mem::size_of::<libc::sockaddr_ll>() as libc::socklen_t,
        )
    };
    if rc < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Some address no test host is talking to, so the attached filter is
    /// guaranteed to drop everything the interface carries.
    const UPSTREAM: [u8; 4] = [192, 0, 2, 1]; // TEST-NET-1, RFC 5737

    /// `open` now refuses anything that is not ARPHRD_ETHER, so the tests need
    /// a real Ethernet link rather than the loopback they used to borrow.
    fn first_ethernet_ifindex() -> Option<u32> {
        for entry in std::fs::read_dir("/sys/class/net").ok()? {
            let entry = entry.ok()?;
            let kind = std::fs::read_to_string(entry.path().join("type")).ok()?;
            if kind.trim() != "1" {
                continue;
            }
            let index = std::fs::read_to_string(entry.path().join("ifindex")).ok()?;
            if let Ok(i) = index.trim().parse::<u32>() {
                return Some(i);
            }
        }
        None
    }

    #[test]
    fn a_non_ethernet_interface_is_refused() {
        // Loopback is ARPHRD_LOOPBACK (772). If we cannot open a packet socket
        // at all the error is about permission, not the datalink type — that is
        // still a refusal, just not the one under test, so only assert when the
        // message names the type.
        match AfPacket::open(1 /* lo */, UPSTREAM, 443) {
            Ok(_) => panic!("loopback is not Ethernet and must be refused"),
            Err(e) => {
                let msg = e.to_string();
                assert!(
                    msg.contains("not Ethernet") || e.kind() == io::ErrorKind::PermissionDenied,
                    "unexpected error: {msg}"
                );
            }
        }
    }

    /// The whole point of SO_RCVTIMEO: on a quiet interface `recv` must come
    /// back so the sniff loop can check for a stop request. If the timeout is
    /// missing this test hangs; if EAGAIN is mishandled it fails with an Err.
    ///
    /// Bound to the first Ethernet interface, which other tests in this suite
    /// may put traffic on,
    /// so a frame may arrive before the interval elapses. That is not the case
    /// under test: retry until the link goes idle and the timeout actually
    /// fires, and fail if it never does.
    #[test]
    fn recv_returns_a_timeout_instead_of_blocking_forever() {
        // AF_PACKET needs CAP_NET_RAW. The build container has it, but a bare
        // `cargo test` on a dev host may not, and a test cannot tell "no
        // permission" from "feature broken" — so skip loudly instead of
        // failing. A silent green here would hide nothing: the assertions
        // below are the only thing this test does.
        let Some(ifindex) = first_ethernet_ifindex() else {
            eprintln!("SKIPPED recv timeout test: no Ethernet interface on this host");
            return;
        };
        let mut cap = match AfPacket::open(ifindex, UPSTREAM, 443) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("SKIPPED recv timeout test: no AF_PACKET socket ({e})");
                return;
            }
        };
        let mut pkt = Captured::default();
        let deadline = std::time::Instant::now() + RECV_TIMEOUT * 8;
        loop {
            pkt.clear();
            let start = std::time::Instant::now();
            let got = cap.recv(&mut pkt).expect("a timeout must not be an error");
            if !got {
                assert!(pkt.ip.is_empty(), "a timeout must not yield a packet");
                assert!(
                    start.elapsed() >= RECV_TIMEOUT / 2,
                    "returned in {:?} — too early to be the {RECV_TIMEOUT:?} timeout",
                    start.elapsed()
                );
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "loopback never went idle; recv never reported a timeout"
            );
        }
    }

    /// Builds a minimal Ethernet + IPv4 + TCP frame. The destination MAC is
    /// a locally administered address that belongs to nobody, so the frame
    /// goes out, is seen on the way out — which is the whole point — and is
    /// then dropped by the first thing that receives it.
    fn frame(src: [u8; 4], dst: [u8; 4], sport: u16, dport: u16) -> Captured {
        let mut ip = vec![0u8; 40];
        ip[0] = 0x45;
        ip[2..4].copy_from_slice(&40u16.to_be_bytes());
        ip[8] = 64; // TTL
        ip[9] = 6; // TCP
        ip[12..16].copy_from_slice(&src);
        ip[16..20].copy_from_slice(&dst);
        ip[20..22].copy_from_slice(&sport.to_be_bytes());
        ip[22..24].copy_from_slice(&dport.to_be_bytes());
        ip[32] = 5 << 4; // data offset
        ip[33] = 0x02; // SYN
        let mut l2 = [0u8; ETH_HDR_LEN];
        l2[..6].copy_from_slice(&[0x02, 0, 0, 0, 0, 0x01]);
        l2[6..12].copy_from_slice(&[0x02, 0, 0, 0, 0, 0x02]);
        l2[12..14].copy_from_slice(&ETH_P_IP.to_be_bytes());
        Captured {
            l2: Some(l2),
            ip,
        }
    }

    /// The filter is the reason the sniff loop is cheap, and a wrong one is
    /// invisible until connections quietly stop being confirmed. So: put two
    /// frames on the wire — one for the upstream we are watching, one for
    /// another address — and read back what the kernel let through.
    ///
    /// A packet socket sees outgoing frames too (that is how the sniffer
    /// catches our own SYN), which is what makes this testable without a
    /// second host.
    #[test]
    fn the_kernel_filter_delivers_only_the_upstream_connection() {
        let Some(ifindex) = first_ethernet_ifindex() else {
            eprintln!("SKIPPED filter test: no Ethernet interface on this host");
            return;
        };
        // Two sockets, because `dev_queue_xmit_nit` skips the socket a frame
        // came from: one to put the frames on the wire, one under test.
        let (mut cap, mut tx) = match (
            AfPacket::open(ifindex, UPSTREAM, 443),
            AfPacket::open(ifindex, UPSTREAM, 443),
        ) {
            (Ok(rx), Ok(tx)) => (rx, tx),
            (Err(e), _) | (_, Err(e)) => {
                eprintln!("SKIPPED filter test: no AF_PACKET socket ({e})");
                return;
            }
        };

        // A source address nothing else on the link will be using, so a frame
        // carrying it is unambiguously one of ours.
        const SRC: [u8; 4] = [198, 51, 100, 7]; // TEST-NET-2, RFC 5737
        const OTHER: [u8; 4] = [203, 0, 113, 9]; // TEST-NET-3
        // The one that must be dropped goes first: an unfiltered socket would
        // then hand it back before the one that must survive, so a broken
        // filter fails the assertion below instead of slipping past it.
        tx.send(&frame(SRC, OTHER, 51001, 443)).unwrap();
        tx.send(&frame(SRC, UPSTREAM, 51000, 443)).unwrap();

        let mut wanted = false;
        let mut pkt = Captured::default();
        let deadline = std::time::Instant::now() + RECV_TIMEOUT * 3;
        while std::time::Instant::now() < deadline {
            if !cap.recv(&mut pkt).unwrap() {
                continue;
            }
            let Some(v) = crate::netpkt::parse_ipv4_tcp(&pkt.ip) else {
                continue;
            };
            if v.src_ip != SRC {
                continue;
            }
            assert_ne!(
                v.dst_ip, OTHER,
                "the filter let through a packet for another address"
            );
            assert_eq!(v.dst_ip, UPSTREAM);
            wanted = true;
            break;
        }
        assert!(
            wanted,
            "the filter dropped the upstream's own packet — every connection \
             would go unconfirmed"
        );
    }

    /// The injector's handle must be able to transmit and must never consume
    /// a packet: it shares one receive queue with the sniff loop, so a read
    /// here would silently steal the loop's next packet.
    #[test]
    fn the_split_sender_transmits_but_never_receives() {
        let Some(ifindex) = first_ethernet_ifindex() else {
            eprintln!("SKIPPED split sender test: no Ethernet interface on this host");
            return;
        };
        let cap = match AfPacket::open(ifindex, UPSTREAM, 443) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("SKIPPED split sender test: no AF_PACKET socket ({e})");
                return;
            }
        };
        let mut sender = cap.split_sender().expect("Linux can always dup its socket");

        let mut pkt = Captured::default();
        pkt.ip.extend_from_slice(&[0xff; 4]);
        let start = std::time::Instant::now();
        assert!(!sender.recv(&mut pkt).expect("an inert recv is not an error"));
        assert!(pkt.ip.is_empty(), "recv must clear the packet it was given");
        assert!(
            start.elapsed() < RECV_TIMEOUT / 2,
            "an inert recv must not go near the socket"
        );

        // A frame with no link-layer header is the one send error this
        // backend raises itself, which proves the call reached `send_on`.
        assert!(sender.send(&Captured::default()).is_err());
    }
}
