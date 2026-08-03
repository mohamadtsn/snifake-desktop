//! AF_PACKET SOCK_RAW bound to the egress interface. Needs CAP_NET_RAW,
//! which in practice means running as root.

use super::{Capture, Captured};
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

        Ok(AfPacket {
            fd,
            ifindex,
            buf: vec![0u8; 65536],
        })
    }
}

impl Capture for AfPacket {
    fn recv(&mut self, out: &mut Captured) -> io::Result<()> {
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
                if err.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(err);
            }
            let n = (n as usize).min(self.buf.len());
            out.clear();
            if n < ETH_HDR_LEN {
                continue;
            }
            if u16::from_be_bytes([self.buf[12], self.buf[13]]) != ETH_P_IP {
                continue;
            }
            let mut l2 = [0u8; ETH_HDR_LEN];
            l2.copy_from_slice(&self.buf[..ETH_HDR_LEN]);
            out.l2 = Some(l2);
            out.ip.extend_from_slice(&self.buf[ETH_HDR_LEN..n]);
            return Ok(());
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
