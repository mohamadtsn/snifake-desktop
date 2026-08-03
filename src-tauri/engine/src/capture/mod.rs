//! Platform packet capture and injection, abstracted at the **IP layer**.
//!
//! Linux (AF_PACKET) and macOS (BPF) both deliver Ethernet frames, so their
//! backends strip the 14-byte header on receive and put it back on send.
//! Windows (WinDivert, Phase 3) works at the network layer and never sees
//! one. Everything above this module only ever touches `Captured.ip`.

use std::io;

#[derive(Default)]
pub struct Captured {
    /// The link-layer header to re-attach on transmit, if the backend uses one.
    pub l2: Option<[u8; 14]>,
    /// The IPv4 packet, header onward.
    pub ip: Vec<u8>,
}

impl Captured {
    /// Empties the packet without releasing the buffer — the sniff loop
    /// reuses a single `Captured` for the life of the process.
    pub fn clear(&mut self) {
        self.l2 = None;
        self.ip.clear();
    }
}

/// How long a backend may block in `recv` before it must report a timeout.
///
/// The sniff loop has no other way to notice `Command::Stop`, so this is also
/// the worst-case latency between a stop request and the thread exiting.
pub const RECV_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

pub trait Capture: Send {
    /// Waits up to [`RECV_TIMEOUT`] for the next frame.
    ///
    /// Returns `Ok(true)` with `out` filled, or `Ok(false)` if the interval
    /// elapsed with no packet — a timeout is a normal outcome, never an error.
    /// Every backend must honour it (Linux/macOS via `SO_RCVTIMEO`, Windows
    /// via `WinDivertShutdown`): it is the only cancellation point the sniff
    /// thread has, so a backend that blocks indefinitely leaks that thread and
    /// its socket on every stop.
    fn recv(&mut self, out: &mut Captured) -> io::Result<bool>;
    /// Transmits a packet built by `netpkt::build_fake_packet`.
    fn send(&mut self, pkt: &Captured) -> io::Result<()>;
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Opens the platform capture handle bound to the egress interface.
pub fn open(
    iface_name: &str,
    iface_index: u32,
    connect_ip: [u8; 4],
    connect_port: u16,
) -> io::Result<Box<dyn Capture>> {
    let _ = (iface_name, iface_index, connect_ip, connect_port);
    #[cfg(target_os = "linux")]
    return Ok(Box::new(linux::AfPacket::open(iface_index)?));
    #[cfg(target_os = "macos")]
    return Ok(Box::new(macos::Bpf::open(iface_name)?));
    #[cfg(target_os = "windows")]
    return Ok(Box::new(windows::WinDivert::open(connect_ip, connect_port)?));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captured_defaults_to_no_link_header_and_an_empty_packet() {
        let c = Captured::default();
        assert!(c.l2.is_none());
        assert!(c.ip.is_empty());
    }

    #[test]
    fn captured_reuses_its_buffer_across_receives() {
        // The sniff loop reuses one Captured for the whole process lifetime;
        // clearing must not drop the allocation.
        let mut c = Captured::default();
        c.ip.extend_from_slice(&[1, 2, 3, 4]);
        let cap = c.ip.capacity();
        c.clear();
        assert!(c.ip.is_empty());
        assert!(c.l2.is_none());
        assert_eq!(c.ip.capacity(), cap, "clear() must keep the allocation");
    }
}
