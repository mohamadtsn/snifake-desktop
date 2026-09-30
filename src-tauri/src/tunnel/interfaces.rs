//! Which interfaces could be a coexisting VPN, for the picker. Read
//! unprivileged; the engine re-checks every name it is sent.

use serde::Serialize;
pub use snifake_engine::validate::validate_interface;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Candidate {
    pub name: String,
    pub kind: Option<String>,
    pub up: bool,
}

/// VPN-shaped: WireGuard, tun/tap, PPP. Not ours, not loopback, not a
/// bridge or a veth, which would only clutter a list of four things.
pub fn parse_candidates(json: &str) -> Vec<Candidate> {
    let Ok(serde_json::Value::Array(rows)) = serde_json::from_str(json) else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|r| {
            let name = r["ifname"].as_str()?.to_string();
            let kind = r["linkinfo"]["info_kind"].as_str().map(str::to_string);
            let vpn = matches!(kind.as_deref(), Some("wireguard" | "tun" | "tap")) || name.starts_with("ppp");
            (vpn && validate_interface(&name).is_ok()).then(|| Candidate {
                up: r["flags"].as_array().is_some_and(|f| f.iter().any(|x| x == "UP")),
                name,
                kind,
            })
        })
        .collect()
}

/// Linux only, like TUN itself; elsewhere the list is empty.
pub fn list() -> Vec<Candidate> {
    let Some(ip) = snifake_engine::sysbin::find("ip") else { return Vec::new() };
    std::process::Command::new(ip)
        .args(["-j", "-d", "link", "show"])
        .output()
        .ok()
        .map(|o| parse_candidates(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_agree_with_the_frontend_fixture() {
        let t: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/lib/passthrough.fixtures.json")).unwrap();
        for c in t["names"].as_array().unwrap() {
            let v = c["value"].as_str().unwrap();
            assert_eq!(validate_interface(v).is_ok(), c["ok"].as_bool().unwrap(), "{v:?}");
        }
    }

    #[test]
    fn only_vpn_shaped_interfaces_are_offered() {
        let j = r#"[
          {"ifname":"lo","flags":["LOOPBACK","UP"]},
          {"ifname":"wlp0s20f3","flags":["UP"]},
          {"ifname":"docker0","flags":["UP"],"linkinfo":{"info_kind":"bridge"}},
          {"ifname":"priv","flags":["UP"],"linkinfo":{"info_kind":"wireguard"}},
          {"ifname":"tun0","flags":["UP"],"linkinfo":{"info_kind":"tun"}},
          {"ifname":"ppp0","flags":["UP"]},
          {"ifname":"snifake-tun0","flags":["UP"],"linkinfo":{"info_kind":"tun"}}
        ]"#;
        let names: Vec<String> = parse_candidates(j).into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["priv", "tun0", "ppp0"]);
    }
}
