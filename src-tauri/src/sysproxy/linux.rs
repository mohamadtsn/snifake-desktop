//! Linux takes two backends, not one.
//!
//! `gsettings` writes `org.gnome.system.proxy`, which GNOME and every GTK
//! application read. **KDE Plasma does not read it** - it reads
//! `kioslaverc`. Shipping only `gsettings` would mean System Proxy works on
//! Ubuntu and silently fails on Kubuntu, which is exactly the failure this
//! module was added to end. Both are written when both tools are present.
//!
//! The argv builders are separate from the spawning so the interesting half
//! - which keys, in which order, with which values - is testable without a
//! desktop session, which this project's CI does not have.

use super::marker::ProxySettings;
use super::Support;
use std::process::Command;

const GNOME_ROOT: &str = "org.gnome.system.proxy";

pub fn gnome_apply_argv(host: &str, port: u16) -> Vec<Vec<String>> {
    let s = |a: &str, b: &str, c: &str| {
        vec!["set".to_string(), a.to_string(), b.to_string(), c.to_string()]
    };
    let mut out = vec![s(GNOME_ROOT, "mode", "manual")];
    for proto in ["http", "https", "socks"] {
        let schema = format!("{GNOME_ROOT}.{proto}");
        out.push(s(&schema, "host", host));
        out.push(s(&schema, "port", &port.to_string()));
    }
    out
}

pub fn gnome_clear_argv(previous: &ProxySettings) -> Vec<Vec<String>> {
    let s = |a: &str, b: &str, c: &str| {
        vec!["set".to_string(), a.to_string(), b.to_string(), c.to_string()]
    };
    if !previous.enabled {
        return vec![s(GNOME_ROOT, "mode", "none")];
    }
    let mut out = vec![s(GNOME_ROOT, "mode", "manual")];
    for proto in ["http", "https", "socks"] {
        let schema = format!("{GNOME_ROOT}.{proto}");
        out.push(s(&schema, "host", &previous.host));
        out.push(s(&schema, "port", &previous.port.to_string()));
    }
    out
}

pub fn kde_apply_entries(host: &str, port: u16) -> Vec<(String, String)> {
    vec![
        ("ProxyType".to_string(), "1".to_string()),
        ("httpProxy".to_string(), format!("http://{host} {port}")),
        ("httpsProxy".to_string(), format!("http://{host} {port}")),
        ("socksProxy".to_string(), format!("socks://{host} {port}")),
    ]
}

pub fn kde_clear_entries(previous: &ProxySettings) -> Vec<(String, String)> {
    if !previous.enabled {
        return vec![("ProxyType".to_string(), "0".to_string())];
    }
    let mut out = kde_apply_entries(&previous.host, previous.port);
    out[0] = ("ProxyType".to_string(), "1".to_string());
    out
}

fn has(tool: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {tool}"))
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn kwrite_tool() -> Option<&'static str> {
    for t in ["kwriteconfig6", "kwriteconfig5"] {
        if has(t) {
            return Some(t);
        }
    }
    None
}

/// Reports what is actually installed, in a sentence a card can show.
pub fn support() -> Support {
    if has("gsettings") || kwrite_tool().is_some() {
        return Support::Supported;
    }
    Support::Unsupported(
        "Neither gsettings nor kwriteconfig is installed, so this desktop's \
         proxy setting cannot be written. Choose Manual and point your \
         applications at the port yourself."
            .into(),
    )
}

pub fn read_current() -> Option<ProxySettings> {
    if !has("gsettings") {
        return None;
    }
    let get = |schema: &str, key: &str| -> Option<String> {
        let out = Command::new("gsettings").args(["get", schema, key]).output().ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().trim_matches('\'').to_string())
    };
    let mode = get(GNOME_ROOT, "mode")?;
    let http = format!("{GNOME_ROOT}.http");
    Some(ProxySettings {
        enabled: mode == "manual",
        host: get(&http, "host").unwrap_or_default(),
        port: get(&http, "port").and_then(|p| p.parse().ok()).unwrap_or(0),
        ignore: Vec::new(),
    })
}

fn run_gsettings(argv: &[Vec<String>]) -> Result<(), String> {
    for args in argv {
        let out = Command::new("gsettings").args(args).output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!(
                "gsettings {}: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    Ok(())
}

fn run_kwrite(entries: &[(String, String)]) -> Result<(), String> {
    let Some(tool) = kwrite_tool() else { return Ok(()) };
    for (key, value) in entries {
        let out = Command::new(tool)
            .args(["--file", "kioslaverc", "--group", "Proxy Settings", "--key", key, value])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!(
                "{tool} {key}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    Ok(())
}

pub fn apply(host: &str, port: u16) -> Result<(), String> {
    // Both, when both are present: one machine can run GTK and Qt
    // applications side by side and each reads only its own store.
    if has("gsettings") {
        run_gsettings(&gnome_apply_argv(host, port))?;
    }
    run_kwrite(&kde_apply_entries(host, port))
}

pub fn restore(previous: &super::marker::Previous) -> Result<(), String> {
    if has("gsettings") {
        if let Some(g) = &previous.gnome {
            run_gsettings(&gnome_clear_argv(g))?;
        }
    }
    if let Some(k) = &previous.kde {
        run_kwrite(&kde_clear_entries(k))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gnome_sets_mode_and_all_three_protocols() {
        let argv = gnome_apply_argv("127.0.0.1", 2080);
        let flat: Vec<String> = argv.iter().map(|a| a.join(" ")).collect();

        assert!(flat.contains(&"set org.gnome.system.proxy mode manual".to_string()), "{flat:#?}");
        // http, https and socks all have to be set: a browser honours the
        // first, curl the second, and everything else the third. Setting one
        // is what "system proxy" failing to work usually looks like.
        assert!(flat.contains(&"set org.gnome.system.proxy.http host 127.0.0.1".to_string()));
        assert!(flat.contains(&"set org.gnome.system.proxy.http port 2080".to_string()));
        assert!(flat.contains(&"set org.gnome.system.proxy.https host 127.0.0.1".to_string()));
        assert!(flat.contains(&"set org.gnome.system.proxy.socks host 127.0.0.1".to_string()));
        assert!(flat.contains(&"set org.gnome.system.proxy.socks port 2080".to_string()));
    }

    #[test]
    fn gnome_restore_puts_the_mode_back_rather_than_setting_none() {
        // A user who already had a manual proxy keeps it. Clearing to 'none'
        // would be us deciding their configuration for them.
        let had = ProxySettings {
            enabled: true, host: "10.0.0.9".into(), port: 8080, ignore: vec![],
        };
        let flat: Vec<String> = gnome_clear_argv(&had).iter().map(|a| a.join(" ")).collect();
        assert!(flat.contains(&"set org.gnome.system.proxy mode manual".to_string()), "{flat:#?}");
        assert!(flat.contains(&"set org.gnome.system.proxy.http host 10.0.0.9".to_string()));

        let had_none = ProxySettings { enabled: false, ..Default::default() };
        let flat: Vec<String> = gnome_clear_argv(&had_none).iter().map(|a| a.join(" ")).collect();
        assert!(flat.contains(&"set org.gnome.system.proxy mode none".to_string()), "{flat:#?}");
    }

    #[test]
    fn kde_writes_the_proxy_type_and_every_protocol_entry() {
        let entries = kde_apply_entries("127.0.0.1", 2080);
        let map: std::collections::HashMap<_, _> = entries.into_iter().collect();
        // ProxyType=1 is "manually specified". Without it KDE ignores the
        // addresses entirely, which is the silent-failure case.
        assert_eq!(map.get("ProxyType").map(String::as_str), Some("1"));
        assert_eq!(map.get("httpProxy").map(String::as_str), Some("http://127.0.0.1 2080"));
        assert_eq!(map.get("httpsProxy").map(String::as_str), Some("http://127.0.0.1 2080"));
        assert_eq!(map.get("socksProxy").map(String::as_str), Some("socks://127.0.0.1 2080"));
    }
}
