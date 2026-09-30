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
        if bits <= 1 {
            full = true;
            continue;
        }
        let table_ok = table == "main" || table.bytes().all(|b| b.is_ascii_digit());
        if table_ok {
            out.push(PassRoute { dst: dst.into(), table: table.into() });
        }
    }
    (out, full)
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
            "{name} sends all traffic through itself, so it cannot share the default route with TUN. Its own networks still pass."
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
}
