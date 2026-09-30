//! The TUN kill switch: drop everything the tunnel does not carry, and keep
//! dropping it whether or not the tunnel is still there.
//!
//! Its lifetime is deliberately independent of the core's (design §4): it
//! goes up before sing-box starts and comes down after it has stopped, and a
//! crash of sing-box, of this engine or of the GUI leaves it in force. The
//! failure a user sees is "no internet", never "traffic went around the
//! tunnel".

use crate::proto::TunnelSpec;
use std::net::Ipv4Addr;

#[cfg(target_os = "linux")]
pub mod linux;

/// What may leave the machine other than through the TUN. Loopback, DHCP
/// and the core's own marked sockets are always allowed, so they are not
/// fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Allowlist {
    /// The SNI engine's upstream: the one legitimate escape.
    pub connect: (Ipv4Addr, u16),
    pub allow_lan: bool,
}

impl Allowlist {
    /// Parses only. Call `validate::validate_tun` first; this assumes it ran.
    pub fn from_spec(spec: &TunnelSpec) -> Result<Allowlist, String> {
        let tun = spec.tun.as_ref().ok_or("not a TUN spec")?;
        let ip = spec
            .connect_ip
            .parse()
            .map_err(|_| format!("CONNECT_IP '{}' is not an IPv4 address", spec.connect_ip))?;
        Ok(Allowlist { connect: (ip, spec.connect_port), allow_lan: tun.allow_lan })
    }

    /// The same list, permitting another upstream: a profile switch.
    pub fn retarget(&self, ip: Ipv4Addr, port: u16) -> Allowlist {
        Allowlist { connect: (ip, port), ..self.clone() }
    }
}

/// What `allow_lan` opens. IPv4 only: every IPv6 packet but loopback is
/// dropped (design §2), because the SNI engine is IPv4-only and any IPv6
/// that leaves has left outside the tunnel.
pub const LAN_V4: [&str; 6] = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "224.0.0.0/4",
    "255.255.255.255/32",
];

pub trait KillSwitch: Send {
    /// Drop-all plus the allowlist. Replaces whatever is there.
    fn install(&mut self, allow: &Allowlist) -> Result<(), String>;
    /// Called once the TUN exists. The name is a parameter, not assumed:
    /// on Windows the filter needs the adapter's LUID, known only now, and
    /// on macOS the name itself (`utunN`) is only known now (design §11).
    fn permit_interface(&mut self, name: &str) -> Result<(), String>;
    /// Swap the permitted upstream without lifting the drop.
    fn update(&mut self, allow: &Allowlist) -> Result<(), String>;
    fn remove(&mut self) -> Result<(), String>;
}

pub fn open() -> Result<Box<dyn KillSwitch>, String> {
    #[cfg(target_os = "linux")]
    return Ok(Box::new(linux::Nft::locate()?));
    #[cfg(not(target_os = "linux"))]
    Err("TUN is not available on this platform yet".into())
}

/// Removes anything a previous run left behind. Runs at every engine start,
/// before anything else, so a crash leaves the machine closed and the next
/// run opens it — the right order, not the reverse.
pub fn purge_leftovers() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return linux::purge();
    #[cfg(not(target_os = "linux"))]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::{ReadyProbe, TunSpec};

    fn spec(tun: Option<TunSpec>) -> TunnelSpec {
        TunnelSpec {
            config: serde_json::json!({}),
            core_path: "/x".into(),
            ready_probe: ReadyProbe::Interface { name: "snifake-tun0".into() },
            connect_ip: "104.18.4.130".into(),
            connect_port: 443,
            listen_host: "127.0.0.1".into(),
            tun,
        }
    }

    #[test]
    fn a_tun_spec_becomes_an_allowlist() {
        let a = Allowlist::from_spec(&spec(Some(TunSpec { allow_lan: false, kill_switch: true, passthrough: vec![] }))).unwrap();
        assert_eq!(a.connect, (Ipv4Addr::new(104, 18, 4, 130), 443));
        assert!(!a.allow_lan);
    }

    #[test]
    fn a_proxy_mode_spec_has_no_allowlist() {
        assert!(Allowlist::from_spec(&spec(None)).is_err());
    }

    #[test]
    fn retargeting_keeps_the_lan_choice() {
        let a = Allowlist { connect: (Ipv4Addr::new(1, 2, 3, 4), 443), allow_lan: false };
        let b = a.retarget(Ipv4Addr::new(5, 6, 7, 8), 8443);
        assert_eq!(b, Allowlist { connect: (Ipv4Addr::new(5, 6, 7, 8), 8443), allow_lan: false });
    }
}
