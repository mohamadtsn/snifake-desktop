//! WinDivert capture backend.
//!
//! Opened in SNIFF mode at the network layer: WinDivert copies matching
//! packets to us and still delivers them normally, which is what we want —
//! we are watching our own handshake, not intercepting it. Injection goes
//! back out through the same handle, reusing the WINDIVERT_ADDRESS captured
//! from the third-handshake ACK so the packet takes the same route.
//!
//! No Ethernet header exists at this layer, which is why `Captured.l2` is
//! `None` here and why `netpkt::build_fake_packet` works on the IP layer.

mod ffi;

use super::{Capture, Captured, RECV_TIMEOUT};
use ffi::{WinDivertApi, ADDRESS_LEN, FLAG_SNIFF, LAYER_NETWORK};
use std::ffi::CString;
use std::io;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ACCESS_DENIED, ERROR_IO_PENDING, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
    WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows_sys::Win32::System::IO::{CancelIo, GetOverlappedResult, OVERLAPPED};

/// WinDivert's own error for "a security product or virtualisation layer
/// refused to let the driver load".
const ERROR_DRIVER_BLOCKED: i32 = 1275;

/// Both directions of exactly the flow we care about, so the kernel does the
/// first pass of filtering and userspace never sees unrelated traffic.
fn filter_for(ip: [u8; 4], port: u16) -> String {
    let a = format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]);
    format!(
        "tcp and ((ip.DstAddr == {a} and tcp.DstPort == {port}) or \
         (ip.SrcAddr == {a} and tcp.SrcPort == {port}))"
    )
}

pub struct WinDivert {
    api: WinDivertApi,
    handle: HANDLE,
    /// Manual-reset event backing the overlapped receive. Created once and
    /// reused: `recv` is called in a tight loop for the life of the run.
    event: HANDLE,
    buf: Vec<u8>,
}

// The handles are owned by this struct and only touched through &mut self.
unsafe impl Send for WinDivert {}

impl WinDivert {
    pub fn open(connect_ip: [u8; 4], connect_port: u16) -> io::Result<Self> {
        let api = WinDivertApi::load()?;
        let filter = CString::new(filter_for(connect_ip, connect_port))
            .map_err(|e| io::Error::other(format!("filter contains a NUL byte: {e}")))?;

        // SAFETY: filter is a valid NUL-terminated C string; the other
        // arguments are the documented constants.
        let handle = unsafe { (api.open)(filter.as_ptr(), LAYER_NETWORK, 0, FLAG_SNIFF) };
        if handle == INVALID_HANDLE_VALUE {
            let err = io::Error::last_os_error();
            return Err(match err.raw_os_error() {
                Some(ERROR_DRIVER_BLOCKED) => io::Error::other(
                    "the WinDivert driver was blocked from loading. This usually means a security \
                     product, a virtual machine, or Windows memory integrity is preventing it.",
                ),
                Some(code) if code == ERROR_ACCESS_DENIED as i32 => {
                    io::Error::other("administrator privileges are required to capture packets")
                }
                _ => io::Error::other(format!("WinDivertOpen failed: {err}")),
            });
        }

        // SAFETY: documented CreateEventW call; a null name is valid.
        let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
        if event.is_null() {
            let err = io::Error::last_os_error();
            // SAFETY: a handle we just opened.
            unsafe { (api.close)(handle) };
            return Err(io::Error::other(format!("CreateEvent failed: {err}")));
        }

        Ok(WinDivert {
            api,
            handle,
            event,
            buf: vec![0u8; 65536],
        })
    }
}

impl Drop for WinDivert {
    fn drop(&mut self) {
        // SAFETY: handles we opened and have not closed.
        unsafe {
            (self.api.close)(self.handle);
            CloseHandle(self.event);
        }
    }
}

impl Capture for WinDivert {
    /// Overlapped receive with a deadline. WinDivert has no equivalent of
    /// `SO_RCVTIMEO`, and a blocking `WinDivertRecv` on an idle flow would
    /// park this thread forever — which is the sniff loop's only
    /// cancellation point. So the read is issued asynchronously and waited
    /// on for at most [`RECV_TIMEOUT`], then cancelled.
    fn recv(&mut self, out: &mut Captured) -> io::Result<bool> {
        let mut addr = [0u8; ADDRESS_LEN];
        let mut addr_len = ADDRESS_LEN as u32;
        let mut len: u32 = 0;
        // SAFETY: OVERLAPPED is a plain C struct; an all-zero value with a
        // valid hEvent is exactly what the API expects.
        let mut ov: OVERLAPPED = unsafe { std::mem::zeroed() };
        ov.hEvent = self.event;

        // SAFETY: buf and addr are owned buffers of the declared sizes, and
        // both outlive the wait below — the call cannot return while the
        // kernel still holds them.
        let ok = unsafe {
            (self.api.recv_ex)(
                self.handle,
                self.buf.as_mut_ptr(),
                self.buf.len() as u32,
                &mut len,
                0,
                addr.as_mut_ptr(),
                &mut addr_len,
                &mut ov as *mut OVERLAPPED as *mut std::ffi::c_void,
            )
        };

        if ok == 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
                return Err(err);
            }
            let ms = RECV_TIMEOUT.as_millis() as u32;
            // SAFETY: a manual-reset event we own.
            let wait = unsafe { WaitForSingleObject(self.event, ms) };
            if wait == WAIT_TIMEOUT {
                // SAFETY: cancels only this thread's pending I/O on our handle.
                unsafe { CancelIo(self.handle) };
                return Ok(false);
            }
            if wait != WAIT_OBJECT_0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: ov and len are valid; the operation has completed.
            let done = unsafe { GetOverlappedResult(self.handle, &ov, &mut len, 0) };
            if done == 0 {
                return Err(io::Error::last_os_error());
            }
        }

        if len == 0 {
            return Ok(false);
        }
        out.clear();
        out.addr = addr;
        out.ip.extend_from_slice(&self.buf[..len as usize]);
        Ok(true)
    }

    fn send(&mut self, pkt: &Captured) -> io::Result<()> {
        let mut packet = pkt.ip.clone();
        // build_fake_packet already computes both checksums, but the driver
        // also reads the address's checksum-valid flags. Recomputing through
        // the helper keeps the two in agreement for free.
        // SAFETY: packet and pkt.addr are owned buffers of the declared sizes.
        unsafe {
            (self.api.calc_checksums)(
                packet.as_mut_ptr(),
                packet.len() as u32,
                pkt.addr.as_ptr(),
                0,
            );
        }
        let mut sent: u32 = 0;
        // SAFETY: as above.
        let ok = unsafe {
            (self.api.send)(
                self.handle,
                packet.as_ptr(),
                packet.len() as u32,
                &mut sent,
                pkt.addr.as_ptr(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_filter_pins_both_directions_of_the_upstream_flow() {
        let f = filter_for([104, 18, 4, 130], 443);
        assert_eq!(
            f,
            "tcp and ((ip.DstAddr == 104.18.4.130 and tcp.DstPort == 443) or \
             (ip.SrcAddr == 104.18.4.130 and tcp.SrcPort == 443))"
        );
    }

    #[test]
    fn a_missing_dll_is_reported_as_a_sentence_not_a_crash() {
        // Loading a name that cannot exist must return Err, never panic or
        // abort — this is the path a user with a broken install takes.
        let Err(err) = WinDivertApi::load_from("definitely-not-windivert.dll") else {
            panic!("loading a DLL that cannot exist must fail");
        };
        assert!(err.to_string().contains("definitely-not-windivert.dll"));
    }
}
