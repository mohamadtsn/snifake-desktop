//! What a coexisting VPN needs to keep working beside the TUN, found by
//! looking rather than asked of the user.
//!
//! Two flows per VPN. The inner one leaves by the VPN's interface, and its
//! routes say where. The outer one is the VPN's transport to its server,
//! and it leaves by the physical link: nothing about the interface
//! identifies it, so for WireGuard it is read from `wg`. Userspace VPNs
//! (OpenVPN, wireguard-go) send their transport from an ordinary process,
//! which the TUN carries like any other; their Bypass entry is the
//! user's `process:` rule, not this module.
//!
//! Programs, not netlink, for the licence reason `killswitch/linux.rs`
//! gives. Every parser is pure and tested on captured output.

use crate::proto::{Endpoint, PassRoute, PassthroughStatus};
use crate::sysbin;
use std::net::Ipv4Addr;
use std::process::Command;

#[cfg(not(windows))]
use std::path::{Path, PathBuf};
use crate::tunpin::{PASS_ENDPOINT_RULE, PASS_ROUTE_RULE};
#[cfg(windows)]
use crate::tunpin::ROUTE_PROTO;

pub fn parse_kind(link_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(link_json).ok()?;
    v.get(0)?["linkinfo"]["info_kind"].as_str().map(str::to_string)
}

/// IPv4 unicast routes, with a flag for "this VPN wants everything". A
/// full-tunnel VPN and the TUN both claim the default route; there is no
/// honest way to give it to both, so it is reported instead of excluded.
pub fn parse_routes(route_json: &str) -> (Vec<PassRoute>, bool) {
    let Ok(serde_json::Value::Array(rows)) = serde_json::from_str(route_json) else {
        return (Vec::new(), false);
    };
    let mut out = Vec::new();
    let mut full = false;
    // Addresses claimed, summed. A VPN routing half of IPv4 or more is a
    // full tunnel however it spells it: `0.0.0.0/0`, two `/1`s, or the
    // AllowedIPs calculator's thirty prefixes for "everything but the LAN".
    // ponytail: overlapping routes are counted twice, which only errs
    // towards calling a VPN full-tunnel.
    let mut covered: u64 = 0;
    for r in rows {
        let kind = r["type"].as_str().unwrap_or("unicast");
        let table = r["table"].as_str().unwrap_or("main");
        let Some(dst) = r["dst"].as_str() else { continue };
        if kind != "unicast" || table == "local" {
            continue;
        }
        if dst == "default" {
            full = true;
            continue;
        }
        let (addr, bits) = dst.split_once('/').unwrap_or((dst, "32"));
        let (Ok(_), Ok(bits)) = (addr.parse::<Ipv4Addr>(), bits.parse::<u8>()) else {
            continue; // IPv6, or something we do not understand
        };
        if bits > 32 {
            continue;
        }
        covered += 1u64 << (32 - bits);
        let table_ok = table == "main" || table.bytes().all(|b| b.is_ascii_digit());
        if table_ok {
            out.push(PassRoute { dst: dst.into(), table: table.into() });
        }
    }
    if full || covered >= 1 << 31 {
        // None of it may bypass the TUN: that would hand the VPN everything.
        return (Vec::new(), true);
    }
    (out, false)
}

/// `wg show <if> endpoints`: `<public key>\t<ip:port | (none)>` per peer.
pub fn parse_wg_endpoints(text: &str) -> Vec<Endpoint> {
    text.lines()
        .filter_map(|l| l.split('\t').nth(1))
        .filter_map(|ep| {
            let (ip, port) = ep.trim().rsplit_once(':')?;
            let ip: Ipv4Addr = ip.parse().ok()?;
            Some(Endpoint { ip: ip.to_string(), port: port.parse().ok()? })
        })
        .collect()
}

fn output(bin: &std::path::Path, args: &[&str]) -> Option<String> {
    let out = Command::new(bin).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(not(windows))]
/// Call with a name `validate_interface` accepted.
pub fn discover(name: &str) -> PassthroughStatus {
    let mut s = PassthroughStatus {
        name: name.into(), present: false, kind: None,
        endpoints: vec![], routes: vec![], problem: None,
    };
    let Some(ip) = sysbin::find("ip") else {
        s.problem = Some("Install the iproute2 package.".into());
        return s;
    };
    let Some(link) = output(&ip, &["-j", "-d", "link", "show", "dev", name]) else {
        return s; // not up yet; the next tick looks again
    };
    s.present = true;
    s.kind = parse_kind(&link);
    let routes = output(&ip, &["-j", "-4", "route", "show", "table", "all", "dev", name]).unwrap_or_default();
    let (found, full) = parse_routes(&routes);
    s.routes = found;
    if full {
        s.problem = Some(format!(
            "{name} sends all traffic through itself, so it cannot run beside TUN. Its routes are left to the tunnel."
        ));
    }
    if s.kind.as_deref() == Some("wireguard") {
        match sysbin::find("wg") {
            Some(wg) => s.endpoints = parse_wg_endpoints(&output(&wg, &["show", name, "endpoints"]).unwrap_or_default()),
            None => s.problem = Some(format!("Install wireguard-tools so the server of {name} can be found.")),
        }
    }
    s
}

#[cfg(windows)]
use windows_sys::Win32::Foundation::NO_ERROR;
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::IpHelper::{
    CreateIpForwardEntry2, DeleteIpForwardEntry2, FreeMibTable, GetBestRoute2, GetIfTable2,
    GetIpForwardTable2, MIB_IF_TABLE2, MIB_IPFORWARD_ROW2, MIB_IPFORWARD_TABLE2,
};
#[cfg(windows)]
use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_INET};

#[cfg(windows)]
pub fn discover(name: &str) -> PassthroughStatus {
    let mut s = PassthroughStatus {
        name: name.into(), present: false, kind: None,
        endpoints: vec![], routes: vec![], problem: None,
    };

    let mut if_table_ptr: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    let status = unsafe { GetIfTable2(&mut if_table_ptr) };
    if status != NO_ERROR || if_table_ptr.is_null() {
        s.problem = Some("Failed to query network interfaces.".into());
        return s;
    }

    let mut matched_luid = None;
    unsafe {
        let table = &*if_table_ptr;
        let entries = std::slice::from_raw_parts(table.Table.as_ptr(), table.NumEntries as usize);
        for row in entries {
            let alias_len = row.Alias.iter().position(|&c| c == 0).unwrap_or(row.Alias.len());
            let alias = String::from_utf16_lossy(&row.Alias[..alias_len]);
            if alias.eq_ignore_ascii_case(name) {
                s.present = true;
                matched_luid = Some(row.InterfaceLuid);
                s.kind = Some("vpn".into());
                break;
            }
        }
        FreeMibTable(if_table_ptr as *const _);
    }

    let Some(luid) = matched_luid else {
        return s; // not up yet
    };

    let mut fwd_table_ptr: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    let status = unsafe { GetIpForwardTable2(AF_INET as u16, &mut fwd_table_ptr) };
    if status == NO_ERROR && !fwd_table_ptr.is_null() {
        unsafe {
            let table = &*fwd_table_ptr;
            let entries = std::slice::from_raw_parts(table.Table.as_ptr(), table.NumEntries as usize);
            let mut covered: u64 = 0;
            let mut full = false;

            for row in entries {
                if row.InterfaceLuid.Value == luid.Value {
                    let prefix_len = row.DestinationPrefix.PrefixLength;
                    let ip = Ipv4Addr::from(u32::from_be(row.DestinationPrefix.Prefix.Ipv4.sin_addr.S_un.S_addr));
                    if prefix_len <= 1 {
                        full = true;
                    }
                    if prefix_len <= 32 {
                        covered += 1u64 << (32 - prefix_len);
                        s.routes.push(PassRoute {
                            dst: format!("{ip}/{prefix_len}"),
                            table: "main".into(),
                        });
                    }
                }
            }
            if full || covered >= (1 << 31) {
                s.routes.clear();
                s.problem = Some(format!(
                    "{name} sends all traffic through itself, so it cannot run beside TUN. Its routes are left to the tunnel."
                ));
            }
            FreeMibTable(fwd_table_ptr as *const _);
        }
    }

    if let Some(wg) = sysbin::find("wg") {
        if let Some(out) = output(&wg, &["show", name, "endpoints"]) {
            s.endpoints = parse_wg_endpoints(&out);
        }
    }

    s
}


/// Servers resolve in `main`, which holds the physical default route;
/// routes resolve in the table the VPN put them in, exactly as they would
/// without the TUN. Both ahead of sing-box's own rules.
pub fn rule_args(found: &[PassthroughStatus]) -> Vec<Vec<String>> {
    let rule = |to: String, table: &str, prio: u32| {
        ["-4", "rule", "add", "to", &to, "lookup", table, "priority", &prio.to_string()]
            .iter().map(|s| s.to_string()).collect::<Vec<_>>()
    };
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut push = |args: Vec<String>| {
        // `ip rule add` refuses an identical rule: two VPNs sharing a
        // server, or one destination routed twice.
        if !out.contains(&args) {
            out.push(args);
        }
    };
    for s in found {
        for e in &s.endpoints {
            push(rule(format!("{}/32", e.ip), "main", PASS_ENDPOINT_RULE));
        }
    }
    for s in found {
        for r in &s.routes {
            push(rule(r.dst.clone(), &r.table, PASS_ROUTE_RULE));
        }
    }
    out
}

#[cfg(not(windows))]
pub struct PassRules {
    bin: PathBuf,
}

#[cfg(not(windows))]
impl PassRules {
    pub fn locate() -> Result<PassRules, String> {
        sysbin::find("ip")
            .map(|bin| PassRules { bin })
            .ok_or_else(|| "Install the iproute2 package to use TUN.".into())
    }

    /// Clear then add. A change leaves a sub-second gap in which that VPN's
    /// traffic reaches the TUN instead. ponytail: acceptable because it only
    /// happens when the VPN itself changed; per-rule diffing if it matters.
    /// Every rule is attempted: one refusal must not leave the rest of a
    /// VPN's routes to the TUN. The refusals come back together.
    pub fn replace(&self, found: &[PassthroughStatus]) -> Result<(), String> {
        clear_rules(&self.bin);
        let mut failed = Vec::new();
        for args in rule_args(found) {
            match Command::new(&self.bin).args(&args).output() {
                Ok(out) if out.status.success() => {}
                Ok(out) => {
                    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                    if !err.contains("File exists") {
                        failed.push(format!("ip {}: {err}", args.join(" ")));
                    }
                }
                Err(e) => failed.push(e.to_string()),
            }
        }
        if failed.is_empty() { Ok(()) } else { Err(failed.join("; ")) }
    }

    pub fn clear(&self) {
        clear_rules(&self.bin);
    }
}

#[cfg(not(windows))]
/// More rules than any routing table a VPN installs; the delete loop's
/// bound, so it outlasts whatever `replace` added.
const MAX_RULES: usize = 65536;

#[cfg(not(windows))]
/// One `rule del` removes one rule; stop at the first failure (none left).
pub fn clear_rules(bin: &Path) {
    for prio in [PASS_ENDPOINT_RULE, PASS_ROUTE_RULE] {
        let p = prio.to_string();
        for _ in 0..MAX_RULES {
            let ok = Command::new(bin)
                .args(["-4", "rule", "del", "priority", p.as_str()])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if !ok {
                break;
            }
        }
    }
}

#[cfg(windows)]
pub struct PassRules;

#[cfg(windows)]
impl PassRules {
    pub fn locate() -> Result<PassRules, String> {
        Ok(PassRules)
    }

    pub fn replace(&self, found: &[PassthroughStatus]) -> Result<(), String> {
        self.clear();
        for s in found {
            for e in &s.endpoints {
                if let Ok(ip) = e.ip.parse::<Ipv4Addr>() {
                    let mut dest: SOCKADDR_INET = unsafe { std::mem::zeroed() };
                    dest.Ipv4.sin_family = AF_INET as u16;
                    dest.Ipv4.sin_addr.S_un.S_addr = u32::from_ne_bytes(ip.octets());
                    let mut best_route: MIB_IPFORWARD_ROW2 = unsafe { std::mem::zeroed() };
                    let mut best_source: SOCKADDR_INET = unsafe { std::mem::zeroed() };
                    if unsafe {
                        GetBestRoute2(
                            std::ptr::null(),
                            0,
                            std::ptr::null(),
                            &dest,
                            0,
                            &mut best_route,
                            &mut best_source,
                        )
                    } == NO_ERROR
                    {
                        let mut row: MIB_IPFORWARD_ROW2 = unsafe { std::mem::zeroed() };
                        row.DestinationPrefix.Prefix.Ipv4.sin_family = AF_INET as u16;
                        row.DestinationPrefix.Prefix.Ipv4.sin_addr.S_un.S_addr =
                            u32::from_ne_bytes(ip.octets());
                        row.DestinationPrefix.PrefixLength = 32;
                        row.NextHop = best_route.NextHop;
                        row.InterfaceLuid = best_route.InterfaceLuid;
                        row.InterfaceIndex = best_route.InterfaceIndex;
                        row.Metric = 1;
                        row.Protocol = ROUTE_PROTO as i32;
                        unsafe {
                            let _ = CreateIpForwardEntry2(&row);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn clear(&self) {
        clear_rules();
    }
}

#[cfg(windows)]
pub fn clear_rules() {
    let mut table_ptr: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    let status = unsafe { GetIpForwardTable2(AF_INET as u16, &mut table_ptr) };
    if status == NO_ERROR && !table_ptr.is_null() {
        let table = unsafe { &*table_ptr };
        let num_entries = table.NumEntries as usize;
        let entries = unsafe {
            std::slice::from_raw_parts(table.Table.as_ptr(), num_entries)
        };
        for entry in entries {
            if entry.Protocol == ROUTE_PROTO as i32 {
                unsafe {
                    let _ = DeleteIpForwardEntry2(entry);
                }
            }
        }
        unsafe {
            FreeMibTable(table_ptr as *const _);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_kind_comes_from_linkinfo() {
        let j = r#"[{"ifname":"priv","linkinfo":{"info_kind":"wireguard"}}]"#;
        assert_eq!(parse_kind(j).as_deref(), Some("wireguard"));
        assert_eq!(parse_kind(r#"[{"ifname":"eno1"}]"#), None);
    }

    #[test]
    fn routes_are_read_with_their_tables() {
        // The owner's own split tunnel: both routes live in table 51820.
        let j = r#"[{"dst":"10.200.0.0/16","dev":"priv","table":"51820","scope":"link","flags":[]},
                    {"dst":"37.191.85.82","dev":"priv","table":"51820","scope":"link","flags":[]},
                    {"type":"local","dst":"10.200.1.63","dev":"priv","table":"local","flags":[]}]"#;
        let (routes, full) = parse_routes(j);
        assert!(!full);
        assert_eq!(routes, [
            PassRoute { dst: "10.200.0.0/16".into(), table: "51820".into() },
            PassRoute { dst: "37.191.85.82".into(), table: "51820".into() },
        ]);
    }

    #[test]
    fn a_route_without_a_table_is_in_main() {
        let (routes, _) = parse_routes(r#"[{"dst":"10.8.0.0/24","dev":"tun0","flags":[]}]"#);
        assert_eq!(routes[0].table, "main");
    }

    #[test]
    fn a_default_route_marks_the_vpn_full_tunnel_and_is_not_excluded() {
        for dst in ["default", "0.0.0.0/1", "128.0.0.0/1", "0.0.0.0/0"] {
            let j = format!(r#"[{{"dst":"{dst}","dev":"wg0","table":"51820","flags":[]}}]"#);
            let (routes, full) = parse_routes(&j);
            assert!(full, "{dst}");
            assert!(routes.is_empty(), "{dst}");
        }
    }

    #[test]
    fn ipv6_routes_are_ignored() {
        let (routes, full) = parse_routes(r#"[{"dst":"fd00::/8","dev":"wg0","flags":[]}]"#);
        assert!(routes.is_empty() && !full);
    }

    #[test]
    fn wg_endpoints_are_parsed_ipv4_only() {
        let t = "keyA=\t37.191.85.82:51820\nkeyB=\t(none)\nkeyC=\t[2001:db8::1]:51820\n";
        assert_eq!(parse_wg_endpoints(t), [Endpoint { ip: "37.191.85.82".into(), port: 51820 }]);
    }
    fn priv_status() -> PassthroughStatus {
        PassthroughStatus {
            name: "priv".into(), present: true, kind: Some("wireguard".into()),
            endpoints: vec![Endpoint { ip: "37.191.85.82".into(), port: 51820 }],
            routes: vec![
                PassRoute { dst: "10.200.0.0/16".into(), table: "51820".into() },
                PassRoute { dst: "37.191.85.82".into(), table: "51820".into() },
            ],
            problem: None,
        }
    }

    #[test]
    fn endpoint_rules_come_before_route_rules() {
        // The server is also a route of the VPN. Its outer packets must
        // resolve in main (the physical link), so its rule wins on priority.
        let a = rule_args(&[priv_status()]);
        let s: Vec<String> = a.iter().map(|v| v.join(" ")).collect();
        assert_eq!(s, [
            "-4 rule add to 37.191.85.82/32 lookup main priority 5340",
            "-4 rule add to 10.200.0.0/16 lookup 51820 priority 5341",
            "-4 rule add to 37.191.85.82 lookup 51820 priority 5341",
        ]);
    }

    #[test]
    fn an_absent_vpn_adds_no_rules() {
        let mut s = priv_status();
        s.present = false;
        s.endpoints.clear();
        s.routes.clear();
        assert!(rule_args(&[s]).is_empty());
    }

    #[test]
    fn a_full_tunnel_written_as_many_prefixes_is_still_full_tunnel() {
        // The WireGuard AllowedIPs calculator's "0.0.0.0/0 minus the LAN
        // ranges": no route shorter than /2, yet it claims nearly all of IPv4.
        let dsts = [
            "0.0.0.0/5", "8.0.0.0/7", "11.0.0.0/8", "12.0.0.0/6", "16.0.0.0/4", "32.0.0.0/3",
            "64.0.0.0/2", "128.0.0.0/3", "160.0.0.0/5", "168.0.0.0/6", "172.0.0.0/12",
            "172.32.0.0/11", "172.64.0.0/10", "172.128.0.0/9", "173.0.0.0/8", "174.0.0.0/7",
            "176.0.0.0/4", "192.0.0.0/9", "192.128.0.0/11", "192.160.0.0/13", "192.169.0.0/16",
            "192.170.0.0/15", "192.172.0.0/14", "192.176.0.0/12", "192.192.0.0/10",
            "193.0.0.0/8", "194.0.0.0/7", "196.0.0.0/6", "200.0.0.0/5", "208.0.0.0/4", "224.0.0.0/3",
        ];
        let rows: Vec<String> = dsts
            .iter()
            .map(|d| format!(r#"{{"dst":"{d}","dev":"wg0","flags":[]}}"#))
            .collect();
        let (routes, full) = parse_routes(&format!("[{}]", rows.join(",")));
        assert!(full);
        assert!(routes.is_empty(), "none of it may bypass the TUN");
    }

    #[test]
    fn a_shared_server_or_a_repeated_route_becomes_one_rule() {
        // `ip rule add` refuses an identical rule, and one refusal must not
        // cost the rules after it.
        let mut other = priv_status();
        other.name = "priv2".into();
        other.routes.push(PassRoute { dst: "10.200.0.0/16".into(), table: "51820".into() });
        let a = rule_args(&[priv_status(), other]);
        assert_eq!(a.len(), 3, "{a:?}");
    }
}

