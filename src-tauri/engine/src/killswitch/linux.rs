//! The Linux kill switch: one nftables table, applied by running `nft`.
//!
//! Executed, not linked. The two netlink crates that could do this in
//! process are GPL (`rustables`) or wrap a GPL library (`nftnl` over
//! `libnftnl`), and this engine ships inside an MIT bundle — the same reason
//! sing-box is downloaded rather than bundled (spec §12.1). Running `nft` as
//! a separate program keeps the licences apart and loses nothing: `nft -f`
//! applies a whole file as one transaction.
//!
//! A table of our own, not rules in someone else's: removal is one atomic
//! delete that cannot disturb anything else on the system, and in nftables
//! a drop in any table beats an accept in another (SPIKE-1, measured), so
//! another tool's permissive ruleset cannot punch a hole in this one.

use super::{Allowlist, KillSwitch, LAN_V4};
use crate::{sysbin, tunpin};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const TABLE: &str = "snifake";

/// Everything the kill switch is, as one script. Pure, so the policy is
/// tested as text.
pub fn ruleset(allow: &Allowlist) -> String {
    let (ip, port) = allow.connect;
    let mut s = teardown_script();
    s += &format!("table inet {TABLE} {{\n");
    s += "  chain output {\n";
    s += "    type filter hook output priority filter; policy drop;\n";
    s += "    oifname \"lo\" accept\n";
    s += &format!("    oifname \"{}\" accept\n", tunpin::INTERFACE_NAME);
    s += &format!("    meta mark {:#x} accept\n", tunpin::ROUTING_MARK);
    s += &format!("    ip daddr {ip} tcp dport {port} accept\n");
    // The lease has to renew, or the machine drops off the network entirely.
    s += "    udp sport 68 udp dport 67 accept\n";
    if allow.allow_lan {
        s += &format!("    ip daddr {{ {} }} accept\n", LAN_V4.join(", "));
    }
    s += "  }\n}\n";
    s
}

/// Deletes the table, and succeeds when there is none: declaring it first
/// makes the delete valid either way.
pub fn teardown_script() -> String {
    format!("table inet {TABLE} {{}}\ndelete table inet {TABLE}\n")
}

pub struct Nft {
    bin: PathBuf,
}

impl Nft {
    pub fn locate() -> Result<Nft, String> {
        sysbin::find("nft")
            .map(|bin| Nft { bin })
            .ok_or_else(|| "Install the nftables package to use TUN.".into())
    }
}

impl KillSwitch for Nft {
    fn install(&mut self, allow: &Allowlist) -> Result<(), String> {
        run(&self.bin, &ruleset(allow))
    }

    /// Nothing to do: on Linux the interface is named in advance
    /// (`tunpin::INTERFACE_NAME`) and `ruleset` already accepts it. The rule
    /// matches by name, so it holds before the interface exists.
    fn permit_interface(&mut self, _name: &str) -> Result<(), String> {
        Ok(())
    }

    fn update(&mut self, allow: &Allowlist) -> Result<(), String> {
        // `ruleset` is itself an atomic replace.
        run(&self.bin, &ruleset(allow))
    }

    fn remove(&mut self) -> Result<(), String> {
        run(&self.bin, &teardown_script())
    }
}

/// With no `nft` on the machine, nothing of ours can be in the kernel.
pub fn purge() -> Result<(), String> {
    match sysbin::find("nft") {
        Some(bin) => run(&bin, &teardown_script()),
        None => Ok(()),
    }
}

fn run(bin: &Path, script: &str) -> Result<(), String> {
    let mut child = Command::new(bin)
        .args(["-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run nft: {e}"))?;
    // Dropped at the end of the statement, which closes stdin so nft can
    // finish reading.
    child
        .stdin
        .take()
        .expect("stdin was piped")
        .write_all(script.as_bytes())
        .map_err(|e| format!("could not write to nft: {e}"))?;
    let out = child.wait_with_output().map_err(|e| format!("nft: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "nft refused the rules: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn allow(lan: bool) -> Allowlist {
        Allowlist { connect: (Ipv4Addr::new(104, 18, 4, 130), 443), allow_lan: lan }
    }

    #[test]
    fn the_output_chain_drops_by_default() {
        assert!(ruleset(&allow(true))
            .contains("type filter hook output priority filter; policy drop;"));
    }

    #[test]
    fn it_opens_exactly_the_always_allowed_paths() {
        let s = ruleset(&allow(false));
        assert!(s.contains("    oifname \"lo\" accept\n"));
        assert!(s.contains("    oifname \"snifake-tun0\" accept\n"));
        assert!(s.contains("    meta mark 0x534e accept\n"));
        assert!(s.contains("    ip daddr 104.18.4.130 tcp dport 443 accept\n"));
        assert!(s.contains("    udp sport 68 udp dport 67 accept\n"));
    }

    #[test]
    fn the_lan_line_follows_its_toggle() {
        let lan = "ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 224.0.0.0/4, 255.255.255.255/32 } accept";
        assert!(ruleset(&allow(true)).contains(lan));
        assert!(!ruleset(&allow(false)).contains("10.0.0.0/8"));
    }

    #[test]
    fn nothing_opens_ipv6() {
        // The inet family sees both; the only IPv6 that may leave is
        // loopback, which `oifname "lo"` already covers.
        assert!(!ruleset(&allow(true)).contains("ip6"));
    }

    #[test]
    fn a_replace_is_one_atomic_script() {
        // Declaring the table makes the delete valid when it does not exist
        // yet; `nft -f` applies the file as one transaction, so there is no
        // instant with neither the old rules nor the new.
        let s = ruleset(&allow(true));
        assert!(s.starts_with("table inet snifake {}\ndelete table inet snifake\ntable inet snifake {\n"));
    }

    #[test]
    fn teardown_succeeds_whether_or_not_the_table_exists() {
        assert_eq!(teardown_script(), "table inet snifake {}\ndelete table inet snifake\n");
    }
}
