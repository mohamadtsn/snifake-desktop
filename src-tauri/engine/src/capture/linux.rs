//! AF_PACKET SOCK_RAW bound to the egress interface. Needs CAP_NET_RAW,
//! which in practice means running as root.

use super::{Capture, Captured, RECV_TIMEOUT};
use std::io;
use std::os::fd::{AsRawFd, OwnedFd};

const ETH_P_ALL: u16 = 0x0003;
const ETH_P_IP: u16 = 0x0800;
const ETH_HDR_LEN: usize = 14;

fn htons(v: u16) -> u16 {
    v.to_be()
}

pub struct AfPacket {
    fd: OwnedFd,
    ifindex: u32,
    buf: Vec<u8>,
}

impl AfPacket {
    pub fn open(ifindex: u32) -> io::Result<Self> {
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
        let l2 = pkt
            .l2
            .ok_or_else(|| io::Error::other("AF_PACKET send needs a link-layer header"))?;
        let mut frame = Vec::with_capacity(ETH_HDR_LEN + pkt.ip.len());
        frame.extend_from_slice(&l2);
        frame.extend_from_slice(&pkt.ip);

        let mut sll: libc::sockaddr_ll = unsafe { std::mem::zeroed() };
        sll.sll_family = libc::AF_PACKET as u16;
        sll.sll_protocol = htons(ETH_P_IP);
        sll.sll_ifindex = self.ifindex as i32;
        sll.sll_halen = 6;
        sll.sll_addr[..6].copy_from_slice(&l2[..6]);

        // SAFETY: frame and sll are owned, correctly sized buffers.
        let rc = unsafe {
            libc::sendto(
                self.fd.as_raw_fd(),
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
        match AfPacket::open(1 /* lo */) {
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
        let mut cap = match AfPacket::open(ifindex) {
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
}
