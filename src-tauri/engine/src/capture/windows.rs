//! Windows capture backend — implemented in Phase 3 with WinDivert.

use super::{Capture, Captured};
use std::io;

pub struct WinDivert;

impl WinDivert {
    pub fn open(_connect_ip: [u8; 4], _connect_port: u16) -> io::Result<Self> {
        Err(io::Error::other(
            "Windows support is not implemented yet (Phase 3, WinDivert)",
        ))
    }
}

impl Capture for WinDivert {
    fn recv(&mut self, _out: &mut Captured) -> io::Result<bool> {
        unreachable!("WinDivert::open always fails in Phase 1")
    }
    fn send(&mut self, _pkt: &Captured) -> io::Result<()> {
        unreachable!("WinDivert::open always fails in Phase 1")
    }
}
