//! Trust boundary. This process runs as root; the GUI's validation is a
//! convenience for the user, this one is the actual guarantee.

use crate::proto::Profile;
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
}
