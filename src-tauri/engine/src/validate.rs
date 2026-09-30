//! Trust boundary. This process runs as root; the GUI's validation is a
//! convenience for the user, this one is the actual guarantee.

use crate::proto::Profile;
use crate::proto::TunnelSpec;
use crate::tunpin;
use std::net::Ipv4Addr;

const MAX_SNI: usize = 219;

pub fn validate(p: &Profile) -> Result<(), String> {
    p.listen_host
        .parse::<Ipv4Addr>()
        .map_err(|_| format!("LISTEN_HOST '{}' is not an IPv4 address", p.listen_host))?;
    p.connect_ip
        .parse::<Ipv4Addr>()
        .map_err(|_| format!("CONNECT_IP '{}' is not an IPv4 address", p.connect_ip))?;
    if p.listen_port == 0 {
        return Err("LISTEN_PORT must be between 1 and 65535".into());
    }
    if p.connect_port == 0 {
        return Err("CONNECT_PORT must be between 1 and 65535".into());
    }
    validate_sni(&p.fake_sni)
}

fn validate_sni(sni: &str) -> Result<(), String> {
    if sni.is_empty() {
        return Err("FAKE_SNI cannot be empty".into());
    }
    if sni.len() > MAX_SNI {
        return Err(format!(
            "FAKE_SNI is {} bytes, maximum is {MAX_SNI}",
            sni.len()
        ));
    }
    for label in sni.split('.') {
        if label.is_empty() || label.len() > 63 {
            return Err(format!("FAKE_SNI '{sni}' has an empty or over-long label"));
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Err(format!(
                "FAKE_SNI '{sni}' has a label starting or ending with '-'"
            ));
        }
        if !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return Err(format!(
                "FAKE_SNI '{sni}' contains characters not valid in a hostname"
            ));
        }
    }
    Ok(())
}

/// The upstream a TUN kill switch will permit. It is the only value from
/// the unprivileged side the firewall trusts, so it is held to "one real,
/// routable IPv4 host and a port".
pub fn validate_tun(s: &TunnelSpec) -> Result<(), String> {
    validate_upstream(&s.connect_ip, s.connect_port)?;
    if let Some(t) = &s.tun {
        if t.passthrough.len() > MAX_PASSTHROUGH {
            return Err(format!("At most {MAX_PASSTHROUGH} VPNs can run beside the tunnel."));
        }
        for name in &t.passthrough {
            validate_interface(name)?;
        }
    }
    Ok(())
}

/// How many coexisting VPNs a spec may name. A bound, not a policy.
pub const MAX_PASSTHROUGH: usize = 8;

/// A name is written into an nft script and an `ip` argument verbatim, so
/// this is the line between a name and an injected rule. IFNAMSIZ is 16
/// including the NUL.
pub fn validate_interface(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 15
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b));
    if !ok {
        return Err(format!("\"{name}\" is not an interface name."));
    }
    if name == tunpin::INTERFACE_NAME || name == "lo" {
        return Err(format!("\"{name}\" cannot be a coexisting VPN."));
    }
    Ok(())
}

/// `validate_tun`'s rule for a bare address, for the link's own Start: a
/// profile switch moves the kill switch's one hole, and that value has to
/// meet the same bar as the one a `TunnelStart` carried.
pub fn validate_upstream(ip: &str, port: u16) -> Result<Ipv4Addr, String> {
    let ip: Ipv4Addr = ip
        .parse()
        .map_err(|_| format!("CONNECT_IP '{ip}' is not an IPv4 address"))?;
    if ip.is_loopback() || ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast() {
        return Err(format!("CONNECT_IP {ip} cannot be the tunnel's permitted upstream"));
    }
    if port == 0 {
        return Err("CONNECT_PORT must be between 1 and 65535".into());
    }
    Ok(ip)
}

/// A tunnel spec is built by the GUI from its *active* profile, and a save
/// can change that without restarting the link. The engine knows which
/// profile the link is actually running, so it refuses a spec that
/// disagrees: the kill switch would permit the wrong upstream, and the
/// generated loop guards would exclude the wrong address.
pub fn spec_matches_link(s: &TunnelSpec, link: &Profile) -> Result<(), String> {
    if s.connect_ip != link.connect_ip || s.connect_port != link.connect_port {
        return Err(
            "The SNI profile changed since the link started. Restart the link, then the tunnel.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::Profile;

    fn good() -> Profile {
        Profile {
            id: "p1".into(),
            name: "Vercel".into(),
            listen_host: "127.0.0.1".into(),
            listen_port: 40443,
            connect_ip: "104.18.4.130".into(),
            connect_port: 443,
            fake_sni: "security.vercel.com".into(),
        }
    }

    #[test]
    fn accepts_a_well_formed_profile() {
        assert!(validate(&good()).is_ok());
    }

    #[test]
    fn rejects_a_non_ipv4_upstream() {
        for bad in ["", "example.com", "999.1.1.1", "::1", "104.18.4"] {
            let mut p = good();
            p.connect_ip = bad.into();
            assert!(validate(&p).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn rejects_port_zero() {
        let mut p = good();
        p.listen_port = 0;
        assert!(validate(&p).is_err());
        let mut p = good();
        p.connect_port = 0;
        assert!(validate(&p).is_err());
    }

    #[test]
    fn rejects_a_listen_host_that_is_not_an_ipv4_address() {
        for bad in ["", "localhost", "0.0.0.0.0", "$(whoami)"] {
            let mut p = good();
            p.listen_host = bad.into();
            assert!(validate(&p).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn rejects_a_malformed_or_oversized_sni() {
        for bad in ["", "not a hostname", "-leading.dash.com", &"x".repeat(220)] {
            let mut p = good();
            p.fake_sni = bad.into();
            assert!(validate(&p).is_err(), "{bad:?} must be rejected");
        }
    }

    #[test]
    fn accepts_the_wildcard_listen_host() {
        let mut p = good();
        p.listen_host = "0.0.0.0".into();
        assert!(validate(&p).is_ok());
    }

    /// `hello.rs` writes the SNI into a `host_name` whose length field is one
    /// byte short of the record it lives in; a name the validator lets through
    /// must therefore always fit. 219 is that ceiling.
    #[test]
    fn accepts_an_sni_of_exactly_the_maximum_length() {
        let mut p = good();
        let l = "x".repeat(63);
        p.fake_sni = format!("{l}.{l}.{l}.{}", "x".repeat(27));
        assert_eq!(p.fake_sni.len(), MAX_SNI);
        assert!(validate(&p).is_ok(), "{:?}", validate(&p));
        assert!(crate::hello::build_client_hello(&p.fake_sni).is_ok());
    }

    fn tun_spec(ip: &str, port: u16) -> crate::proto::TunnelSpec {
        crate::proto::TunnelSpec {
            config: serde_json::json!({}),
            core_path: "/x".into(),
            ready_probe: crate::proto::ReadyProbe::Interface { name: "snifake-tun0".into() },
            connect_ip: ip.into(),
            connect_port: port,
            listen_host: "127.0.0.1".into(),
            tun: Some(crate::proto::TunSpec { allow_lan: true, kill_switch: true, passthrough: vec![] }),
        }
    }

    #[test]
    fn a_tun_spec_with_a_real_upstream_is_accepted() {
        assert!(validate_tun(&tun_spec("104.18.4.130", 443)).is_ok());
    }

    #[test]
    fn a_tun_spec_whose_upstream_the_firewall_cannot_mean_is_refused() {
        // Each of these would turn the one permitted escape into a hole or
        // into nothing: loopback is already open, and the rest are not a
        // single host.
        for bad in ["127.0.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1", "example.com", "::1"] {
            assert!(validate_tun(&tun_spec(bad, 443)).is_err(), "{bad} must be refused");
        }
        assert!(validate_tun(&tun_spec("104.18.4.130", 0)).is_err());
    }

    fn link(ip: &str, port: u16) -> Profile {
        Profile {
            id: "p".into(),
            name: "n".into(),
            listen_host: "127.0.0.1".into(),
            listen_port: 40443,
            connect_ip: ip.into(),
            connect_port: port,
            fake_sni: "x.com".into(),
        }
    }

    #[test]
    fn a_spec_for_the_running_link_is_accepted() {
        assert!(spec_matches_link(&tun_spec("104.18.4.130", 443), &link("104.18.4.130", 443)).is_ok());
    }

    #[test]
    fn a_spec_built_for_another_profile_is_refused() {
        // The GUI builds the spec from the *active* profile, which a save
        // can change without restarting the link. Permitting that upstream
        // would drop the one the link is really dialling.
        assert!(spec_matches_link(&tun_spec("5.6.7.8", 443), &link("104.18.4.130", 443)).is_err());
        assert!(spec_matches_link(&tun_spec("104.18.4.130", 8443), &link("104.18.4.130", 443)).is_err());
    }

    #[test]
    fn a_real_interface_name_is_accepted() {
        for n in ["wg0", "priv", "tun-home.1", "a_b", "throne-tun"] {
            assert!(validate_interface(n).is_ok(), "{n}");
        }
    }

    #[test]
    fn an_interface_name_cannot_smuggle_nft_syntax() {
        for n in ["wg0\" accept", "wg0\naccept", "wg*", "", "a-name-longer-than-15", "wg 0"] {
            assert!(validate_interface(n).is_err(), "{n:?}");
        }
    }

    #[test]
    fn our_own_interface_and_loopback_are_not_passthrough() {
        assert!(validate_interface(crate::tunpin::INTERFACE_NAME).is_err());
        assert!(validate_interface("lo").is_err());
    }

    #[test]
    fn a_tun_spec_with_a_bad_or_oversized_passthrough_is_refused() {
        let mut s = tun_spec("104.18.4.130", 443);
        s.tun.as_mut().unwrap().passthrough = vec!["wg0\"".into()];
        assert!(validate_tun(&s).is_err());
        s.tun.as_mut().unwrap().passthrough = vec!["wg0".into(); MAX_PASSTHROUGH + 1];
        assert!(validate_tun(&s).is_err());
    }
}
