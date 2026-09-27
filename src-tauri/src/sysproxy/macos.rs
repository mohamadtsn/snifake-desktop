//! macOS, through `networksetup`.
//!
//! Proxy settings on macOS are per *network service*, not global: Wi-Fi and
//! Ethernet each hold their own. Setting only the active one leaves the
//! proxy behind the moment the user docks their laptop, so every enabled
//! service is set, and every enabled service is cleared.
//!
//! **The spawning half is never executed here.** The container has no Mac.
//! The builders are pure and are exercised by this file's own tests on
//! Linux, which is the only verification of them this project can get: the
//! `check` service type-checks Darwin for the engine crate only.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::marker::{Previous, ProxySettings};
use super::Support;
use std::process::Command;

pub fn apply_argv(service: &str, host: &str, port: u16) -> Vec<Vec<String>> {
    ["-setwebproxy", "-setsecurewebproxy", "-setsocksfirewallproxy"]
        .iter()
        .map(|flag| {
            vec![flag.to_string(), service.to_string(), host.to_string(), port.to_string()]
        })
        .collect()
}

pub fn clear_argv(service: &str) -> Vec<Vec<String>> {
    ["-setwebproxystate", "-setsecurewebproxystate", "-setsocksfirewallproxystate"]
        .iter()
        .map(|flag| vec![flag.to_string(), service.to_string(), "off".to_string()])
        .collect()
}

/// The first line is a human-readable note, and a leading `*` marks a
/// disabled service. Both would be passed to `networksetup` as a service
/// name if taken literally.
pub fn parse_services(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .skip_while(|l| l.starts_with("An asterisk"))
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('*'))
        .map(str::to_string)
        .collect()
}

fn services() -> Vec<String> {
    Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()
        .ok()
        .map(|o| parse_services(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

pub fn support() -> Support {
    if services().is_empty() {
        return Support::Unsupported(
            "No enabled network service was found, so there is nothing to set \
             the proxy on. Choose Manual and point your applications at the \
             port yourself."
                .into(),
        );
    }
    Support::Supported
}

pub fn read_current() -> Option<ProxySettings> {
    let service = services().into_iter().next()?;
    let out = Command::new("networksetup").args(["-getwebproxy", &service]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let field = |name: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(name)?.strip_prefix(": ").map(str::trim))
            .map(str::to_string)
    };
    Some(ProxySettings {
        enabled: field("Enabled").as_deref() == Some("Yes"),
        host: field("Server").unwrap_or_default(),
        port: field("Port").and_then(|p| p.parse().ok()).unwrap_or(0),
        ignore: Vec::new(),
    })
}

fn run(argv: &[Vec<String>]) -> Result<(), String> {
    for args in argv {
        let out = Command::new("networksetup").args(args).output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!(
                "networksetup {}: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    Ok(())
}

pub fn apply(host: &str, port: u16) -> Result<(), String> {
    for service in services() {
        run(&apply_argv(&service, host, port))?;
    }
    Ok(())
}

pub fn restore(previous: &Previous) -> Result<(), String> {
    let had = previous.macos.clone().unwrap_or_default();
    for service in services() {
        if had.enabled {
            run(&apply_argv(&service, &had.host, had.port))?;
        } else {
            run(&clear_argv(&service))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_protocol_is_set_for_the_named_service() {
        let argv = apply_argv("Wi-Fi", "127.0.0.1", 2080);
        let flat: Vec<String> = argv.iter().map(|a| a.join(" ")).collect();
        assert!(flat.contains(&"-setwebproxy Wi-Fi 127.0.0.1 2080".to_string()), "{flat:#?}");
        assert!(flat.contains(&"-setsecurewebproxy Wi-Fi 127.0.0.1 2080".to_string()));
        assert!(flat.contains(&"-setsocksfirewallproxy Wi-Fi 127.0.0.1 2080".to_string()));
    }

    #[test]
    fn clearing_turns_all_three_states_off() {
        let flat: Vec<String> = clear_argv("Wi-Fi").iter().map(|a| a.join(" ")).collect();
        assert!(flat.contains(&"-setwebproxystate Wi-Fi off".to_string()), "{flat:#?}");
        assert!(flat.contains(&"-setsecurewebproxystate Wi-Fi off".to_string()));
        assert!(flat.contains(&"-setsocksfirewallproxystate Wi-Fi off".to_string()));
    }

    #[test]
    fn the_service_list_skips_the_asterisk_that_marks_a_disabled_service() {
        let out = "An asterisk (*) denotes that a network service is disabled.\n\
                   Wi-Fi\n*Bluetooth PAN\nThunderbolt Bridge\n";
        assert_eq!(parse_services(out), vec!["Wi-Fi", "Thunderbolt Bridge"]);
    }
}
