//! Shared crate for the privileged sni-fake engine.
//!
//! The GUI depends on this crate for `proto` only. Everything else is
//! compiled into the `sni-fake-engine` binary, which is the process that
//! actually runs as root.

pub mod capture;
pub mod forward;
pub mod hello;
pub mod netpkt;
pub mod proto;
pub mod sniffer;
pub mod sysrand;
pub mod transport;
pub mod validate;

#[cfg(test)]
mod tests {
    use super::proto::*;

    #[test]
    fn command_round_trips_as_ndjson() {
        let cmd = Command::Start {
            profile: Profile {
                id: "p1".into(),
                name: "Vercel".into(),
                listen_host: "0.0.0.0".into(),
                listen_port: 40443,
                connect_ip: "104.18.4.130".into(),
                connect_port: 443,
                fake_sni: "security.vercel.com".into(),
            },
        };
        let line = serde_json::to_string(&cmd).unwrap();
        assert!(!line.contains('\n'), "NDJSON lines must be single-line");
        assert!(line.contains("\"cmd\":\"start\""));
        assert!(line.contains("\"LISTEN_PORT\":40443"));
        match serde_json::from_str::<Command>(&line).unwrap() {
            Command::Start { profile } => assert_eq!(profile.fake_sni, "security.vercel.com"),
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn event_round_trips_as_ndjson() {
        let ev = Event::State {
            state: "running".into(),
        };
        let line = serde_json::to_string(&ev).unwrap();
        assert_eq!(line, r#"{"ev":"state","state":"running"}"#);
        assert!(matches!(
            serde_json::from_str::<Event>(&line).unwrap(),
            Event::State { .. }
        ));
    }
}
