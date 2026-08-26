//! BPF (/dev/bpfN) backend. Needs read/write on a bpf device, which in
//! practice means running as root.
//!
//! Only the syscall wrapping lives here; the wire format it walks is in
//! `super::bpf`, which compiles and is tested on any host.

use super::bpf::{self, next_record, strip_ethernet, ETH_HDR_LEN};
use super::{Capture, Captured, RECV_TIMEOUT};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

/// What we ask the kernel for. It clamps to `bpf_maxbufsize` and reports the
/// value it actually used, which is what we allocate.
const WANTED_BUF_LEN: u32 = 32768;

/// `struct ifreq` on Darwin: 16 bytes of name plus a 16-byte union. Only the
/// name matters to `BIOCSETIF`, but the whole 32 bytes are copied in, so the
/// size has to be right — `BIOCSETIF` encodes it.
#[repr(C)]
struct IfReq {
    name: [u8; 16],
    _pad: [u8; 16],
}

// Everything `bpf.rs` hardcodes, checked against the real headers on the only
// platform that compiles this file. A mismatch is a build error rather than a
// mystery at runtime.
const _: () = {
    assert!(std::mem::size_of::<IfReq>() == 32);
    assert!(std::mem::offset_of!(libc::bpf_hdr, bh_caplen) == 8);
    assert!(std::mem::offset_of!(libc::bpf_hdr, bh_datalen) == 12);
    assert!(std::mem::offset_of!(libc::bpf_hdr, bh_hdrlen) == 16);

    // The `BIOC*` commands this backend needs are not in libc, so `bpf_ioc`
    // derives them — but the encoding is shared by the whole group, so running
    // it against every constant libc *does* publish for Darwin is a real test
    // of the ones we derive. Also pins LP64: the 16-byte arguments are 8 bytes
    // on a 32-bit Darwin userland, where `BIOCSETIF`'s `struct ifreq` would be
    // the wrong size too.
    use bpf::{bpf_ioc, IOC_IN, IOC_OUT};
    assert!(bpf_ioc(IOC_IN, 103, 16) == libc::BIOCSETF as u64);
    assert!(bpf_ioc(IOC_IN, 109, 16) == libc::BIOCSRTIMEOUT as u64);
    assert!(bpf_ioc(IOC_OUT, 110, 16) == libc::BIOCGRTIMEOUT as u64);
    assert!(bpf_ioc(IOC_OUT, 114, 4) == libc::BIOCGRSIG as u64);
    assert!(bpf_ioc(IOC_IN, 115, 4) == libc::BIOCSRSIG as u64);
    assert!(bpf_ioc(IOC_OUT, 118, 4) == libc::BIOCGSEESENT as u64);
    assert!(bpf_ioc(IOC_IN, 119, 4) == libc::BIOCSSEESENT as u64);
    assert!(bpf_ioc(IOC_IN, 120, 4) == libc::BIOCSDLT as u64);
    assert!(bpf_ioc(IOC_IN | IOC_OUT, 121, 12) == libc::BIOCGDLTLIST as u64);
    assert!(bpf_ioc(IOC_IN, 126, 16) == libc::BIOCSETFNR as u64);
};

pub struct Bpf {
    fd: OwnedFd,
    /// Exactly `BIOCGBLEN` bytes — a shorter or longer read(2) is `EINVAL`.
    buf: Vec<u8>,
    /// Bytes of `buf` the last read(2) filled.
    avail: usize,
    /// Where the next record starts. One read(2) can carry many frames, so
    /// the batch is drained across calls rather than in a loop.
    pos: usize,
}

/// Wraps an ioctl that takes a pointer, turning the `-1` into an `io::Error`
/// tagged with which command failed.
///
/// # Safety
/// `arg` must point at a fully initialised value of the type `cmd` encodes.
unsafe fn ioctl(fd: &OwnedFd, name: &str, cmd: u64, arg: *mut libc::c_void) -> io::Result<()> {
    if libc::ioctl(fd.as_raw_fd(), cmd as libc::c_ulong, arg) < 0 {
        let err = io::Error::last_os_error();
        return Err(io::Error::new(err.kind(), format!("{name}: {err}")));
    }
    Ok(())
}

impl Bpf {
    pub fn open(iface_name: &str) -> io::Result<Self> {
        let mut ifr = IfReq {
            name: [0; 16],
            _pad: [0; 16],
        };
        // Leave room for the NUL the kernel expects.
        if iface_name.len() >= ifr.name.len() {
            return Err(io::Error::other(format!(
                "interface name too long: {iface_name}"
            )));
        }
        ifr.name[..iface_name.len()].copy_from_slice(iface_name.as_bytes());

        // macOS has no cloning /dev/bpf; the nodes are per-open and a busy one
        // returns EBUSY, so walk until one takes.
        let mut last_err = io::Error::other("no /dev/bpf* device exists");
        let mut fd = None;
        for i in 0..256 {
            let path = std::ffi::CString::new(format!("/dev/bpf{i}")).unwrap();
            // SAFETY: path is a valid NUL-terminated C string.
            let raw = unsafe { libc::open(path.as_ptr(), libc::O_RDWR) };
            if raw >= 0 {
                // SAFETY: open(2) just handed us this descriptor.
                fd = Some(unsafe { OwnedFd::from_raw_fd(raw) });
                break;
            }
            last_err = io::Error::last_os_error();
        }
        let fd = fd.ok_or_else(|| {
            io::Error::new(
                last_err.kind(),
                format!("could not open any /dev/bpf* device ({last_err}) — run with administrator privileges"),
            )
        })?;

        // SAFETY: every argument below is a fully initialised value of the
        // type its command encodes, and outlives the call.
        unsafe {
            // Must precede BIOCSETIF — the buffer is fixed once attached.
            let mut blen = WANTED_BUF_LEN;
            ioctl(
                &fd,
                "BIOCSBLEN",
                super::bpf::BIOCSBLEN,
                &mut blen as *mut u32 as *mut _,
            )?;
            ioctl(
                &fd,
                "BIOCSETIF",
                super::bpf::BIOCSETIF,
                &mut ifr as *mut IfReq as *mut _,
            )?;

            // Only meaningful once a device is attached. `strip_ethernet` reads
            // a 14-byte link header; a utun/PPP/loopback device hands back a
            // bare IP header instead, so every frame would be dropped as a runt
            // and the backend would capture nothing at all. Refuse instead.
            let mut dlt: u32 = 0;
            ioctl(
                &fd,
                "BIOCGDLT",
                super::bpf::BIOCGDLT,
                &mut dlt as *mut u32 as *mut _,
            )?;
            if dlt != super::bpf::DLT_EN10MB {
                return Err(io::Error::other(format!(
                    "interface {iface_name} has datalink type {dlt}, not Ethernet \
                     (DLT_EN10MB = {}) — only Ethernet interfaces are supported",
                    super::bpf::DLT_EN10MB
                )));
            }

            let mut one: u32 = 1;
            let one_ptr = &mut one as *mut u32 as *mut libc::c_void;
            // Hand each frame over as it arrives. Without this the kernel
            // holds frames until the buffer fills or the read timeout expires,
            // and the injection has to happen within one RTT.
            ioctl(&fd, "BIOCIMMEDIATE", super::bpf::BIOCIMMEDIATE, one_ptr)?;
            // We write complete Ethernet frames; don't rewrite our source MAC.
            ioctl(&fd, "BIOCSHDRCMPLT", super::bpf::BIOCSHDRCMPLT, one_ptr)?;
            // Seeing our own outbound packets is the whole point — the trigger
            // is our own third-handshake ACK. It is the default, so treat a
            // failure as benign rather than refusing to start.
            let _ = ioctl(&fd, "BIOCSSEESENT", libc::BIOCSSEESENT, one_ptr);

            // Bounds how long read(2) blocks, which is the sniff thread's only
            // cancellation point (see Capture::recv).
            let mut tv = libc::timeval {
                tv_sec: RECV_TIMEOUT.as_secs() as libc::time_t,
                tv_usec: RECV_TIMEOUT.subsec_micros() as libc::suseconds_t,
            };
            ioctl(
                &fd,
                "BIOCSRTIMEOUT",
                libc::BIOCSRTIMEOUT,
                &mut tv as *mut libc::timeval as *mut _,
            )?;

            // Authoritative, and not necessarily what we asked for: read(2)
            // must be given exactly this many bytes.
            ioctl(
                &fd,
                "BIOCGBLEN",
                super::bpf::BIOCGBLEN,
                &mut blen as *mut u32 as *mut _,
            )?;
            if (blen as usize) < ETH_HDR_LEN {
                return Err(io::Error::other(format!(
                    "bpf read buffer is unusably small: {blen} bytes"
                )));
            }

            Ok(Bpf {
                fd,
                buf: vec![0u8; blen as usize],
                avail: 0,
                pos: 0,
            })
        }
    }
}

impl Capture for Bpf {
    fn recv(&mut self, out: &mut Captured) -> io::Result<bool> {
        out.clear();

        if self.pos >= self.avail {
            // SAFETY: read into a buffer we own, of exactly the length
            // BIOCGBLEN reported.
            let n = unsafe {
                libc::read(
                    self.fd.as_raw_fd(),
                    self.buf.as_mut_ptr() as *mut libc::c_void,
                    self.buf.len(),
                )
            };
            if n < 0 {
                let err = io::Error::last_os_error();
                return match err.kind() {
                    // A signal, or the read timeout on a device that reports it
                    // as EAGAIN: nothing this call, and the caller gets its
                    // chance to notice a stop request.
                    io::ErrorKind::Interrupted
                    | io::ErrorKind::WouldBlock
                    | io::ErrorKind::TimedOut => Ok(false),
                    _ => Err(err),
                };
            }
            self.avail = (n as usize).min(self.buf.len());
            self.pos = 0;
            // BIOCSRTIMEOUT expiry with an empty store buffer comes back as a
            // 0-byte read, not an error. A bpf device has no EOF, so this is
            // "no packets this interval" — treating it as one would abort the
            // sniff thread on the first quiet second.
            if self.avail == 0 {
                return Ok(false);
            }
        }

        let Some(rec) = next_record(&self.buf[..self.avail], self.pos) else {
            // Nothing to resynchronise to; drop the rest of the batch.
            self.pos = self.avail;
            return Ok(false);
        };
        self.pos = rec.next;

        // One record per call: walking the already-read batch would be bounded,
        // but there is no reason to, and returning keeps the stop check hot.
        let Some((l2, ip)) = strip_ethernet(rec.frame) else {
            return Ok(false);
        };
        out.l2 = Some(l2);
        out.ip.extend_from_slice(ip);
        Ok(true)
    }

    fn send(&mut self, pkt: &Captured) -> io::Result<()> {
        let l2 = pkt
            .l2
            .ok_or_else(|| io::Error::other("bpf send needs a link-layer header"))?;
        let mut frame = Vec::with_capacity(ETH_HDR_LEN + pkt.ip.len());
        frame.extend_from_slice(&l2);
        frame.extend_from_slice(&pkt.ip);
        // SAFETY: write from a buffer we own.
        let n = unsafe {
            libc::write(
                self.fd.as_raw_fd(),
                frame.as_ptr() as *const libc::c_void,
                frame.len(),
            )
        };
        if n < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}
