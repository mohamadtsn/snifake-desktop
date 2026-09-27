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

use super::marker::{Previous, ProxySettings};
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

/// Restores the *recorded* mode, not a bool. GNOME's mode is three-state,
/// and collapsing `auto` to "not manual" meant a user on a PAC file had
/// their configuration replaced with `none` - a setting destroyed by an
/// application that only promised to put it back.
pub fn gnome_clear_argv(previous: &Previous) -> Vec<Vec<String>> {
    let s = |a: &str, b: &str, c: &str| {
        vec!["set".to_string(), a.to_string(), b.to_string(), c.to_string()]
    };
    let had = previous.gnome.clone().unwrap_or_default();
    let mode = previous
        .gnome_mode
        .clone()
        .unwrap_or_else(|| if had.enabled { "manual".into() } else { "none".into() });

    let mut out = vec![s(GNOME_ROOT, "mode", &mode)];
    if let Some(pac) = &previous.gnome_pac {
        out.push(s(GNOME_ROOT, "autoconfig-url", pac));
    }
    if mode == "manual" {
        for proto in ["http", "https", "socks"] {
            let schema = format!("{GNOME_ROOT}.{proto}");
            out.push(s(&schema, "host", &had.host));
            out.push(s(&schema, "port", &had.port.to_string()));
        }
    }
    out
}

/// `kioslaverc` stores a proxy as `<scheme>://<host> <port>`.
pub fn parse_kde_proxy(value: &str) -> Option<(String, u16)> {
    let rest = value.split_once("://").map(|(_, r)| r).unwrap_or(value);
    let (host, port) = rest.split_once(' ')?;
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), port.trim().parse().ok()?))
}

/// Separated from the probing so the rule is testable without a desktop.
/// A `gsettings` binary is not a `org.gnome.system.proxy` schema: minimal
/// installs ship glib's tools without the desktop schemas, and reporting
/// `Supported` there is the silent failure this module exists to end.
pub fn decide_support(has_gsettings: bool, has_schema: bool, has_kwrite: bool) -> Support {
    if (has_gsettings && has_schema) || has_kwrite {
        return Support::Supported;
    }
    if has_gsettings && !has_schema {
        return Support::Unsupported(
            "gsettings is installed but the org.gnome.system.proxy schema is \
             not, so this desktop's proxy setting cannot be written. Choose \
             Manual and point your applications at the port yourself."
                .into(),
        );
    }
    Support::Unsupported(
        "Neither gsettings nor kwriteconfig is installed, so this desktop's \
         proxy setting cannot be written. Choose Manual and point your \
         applications at the port yourself."
            .into(),
    )
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

fn kread_tool() -> Option<&'static str> {
    ["kreadconfig6", "kreadconfig5"].into_iter().find(|t| has(t))
}

fn gnome_schema_present() -> bool {
    Command::new("gsettings")
        .args(["list-keys", GNOME_ROOT])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Reports what is actually usable, in a sentence a card can show.
pub fn support() -> Support {
    let gsettings = has("gsettings");
    decide_support(
        gsettings,
        gsettings && gnome_schema_present(),
        kwrite_tool().is_some(),
    )
}

/// Reads *each* backend separately.
///
/// This used to be one `read_current()` copied into both `gnome` and `kde`,
/// which meant that on a Plasma machine with no gsettings the KDE record
/// was `Default` - and restoring it wrote `ProxyType=0` over a proxy the
/// user had configured themselves.
pub fn read_previous() -> Previous {
    let mode = gsettings_get(GNOME_ROOT, "mode");
    Previous {
        gnome: read_current(),
        gnome_pac: gsettings_get(GNOME_ROOT, "autoconfig-url").filter(|u| !u.is_empty()),
        gnome_mode: mode,
        kde: read_kde(),
        ..Default::default()
    }
}

fn kread(key: &str) -> Option<String> {
    let tool = kread_tool()?;
    let out = Command::new(tool)
        .args(["--file", "kioslaverc", "--group", "Proxy Settings", "--key", key])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn read_kde() -> Option<ProxySettings> {
    let proxy_type = kread("ProxyType")?;
    let (host, port) = kread("httpProxy")
        .as_deref()
        .and_then(parse_kde_proxy)
        .unwrap_or_default();
    Some(ProxySettings {
        enabled: proxy_type == "1",
        host,
        port,
        ignore: kread("NoProxyFor")
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
    })
}

pub fn read_current() -> Option<ProxySettings> {
    if !has("gsettings") {
        return None;
    }
    let mode = gsettings_get(GNOME_ROOT, "mode")?;
    let http = format!("{GNOME_ROOT}.http");
    Some(ProxySettings {
        enabled: mode == "manual",
        host: gsettings_get(&http, "host").unwrap_or_default(),
        port: gsettings_get(&http, "port").and_then(|p| p.parse().ok()).unwrap_or(0),
        ignore: Vec::new(),
    })
}

fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let out = Command::new("gsettings").args(["get", schema, key]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().trim_matches('\'').to_string())
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

pub fn restore(previous: &Previous) -> Result<(), String> {
    if has("gsettings") && previous.gnome_mode.is_some() {
        run_gsettings(&gnome_clear_argv(previous))?;
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
        let had = Previous {
            gnome: Some(ProxySettings {
                enabled: true, host: "10.0.0.9".into(), port: 8080, ignore: vec![],
            }),
            gnome_mode: Some("manual".into()),
            ..Default::default()
        };
        let flat: Vec<String> = gnome_clear_argv(&had).iter().map(|a| a.join(" ")).collect();
        assert!(flat.contains(&"set org.gnome.system.proxy mode manual".to_string()), "{flat:#?}");
        assert!(flat.contains(&"set org.gnome.system.proxy.http host 10.0.0.9".to_string()));

        let had_none = Previous { gnome_mode: Some("none".into()), ..Default::default() };
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


    #[test]
    fn gnome_restore_puts_an_auto_configuration_back_instead_of_turning_it_off() {
        // A user on a PAC file. Collapsing the three-state GNOME mode to a
        // bool made `clear()` write `mode none`, silently destroying their
        // setup with nothing to connect it to this application.
        let had = Previous {
            gnome: Some(ProxySettings::default()),
            gnome_mode: Some("auto".into()),
            gnome_pac: Some("http://wpad.example/wpad.dat".into()),
            ..Default::default()
        };
        let flat: Vec<String> = gnome_clear_argv(&had).iter().map(|a| a.join(" ")).collect();
        assert!(flat.contains(&"set org.gnome.system.proxy mode auto".to_string()), "{flat:#?}");
        assert!(
            flat.contains(
                &"set org.gnome.system.proxy autoconfig-url http://wpad.example/wpad.dat"
                    .to_string()
            ),
            "{flat:#?}"
        );
    }

    #[test]
    fn a_kde_proxy_value_parses_into_a_host_and_a_port() {
        // `kioslaverc` stores `httpProxy=http://host port` - scheme, space,
        // port. Reading KDE's own state is what stops us fabricating it
        // from GNOME's and writing `ProxyType=0` over a proxy the user set.
        assert_eq!(
            parse_kde_proxy("http://127.0.0.1 2080"),
            Some(("127.0.0.1".to_string(), 2080))
        );
        assert_eq!(
            parse_kde_proxy("socks://10.0.0.9 1080"),
            Some(("10.0.0.9".to_string(), 1080))
        );
        assert_eq!(parse_kde_proxy(""), None);
        assert_eq!(parse_kde_proxy("nonsense"), None);
    }

    #[test]
    fn a_desktop_with_the_binary_but_no_schema_is_reported_unsupported() {
        // `command -v gsettings` succeeding proves glib's tools are
        // installed, not that `org.gnome.system.proxy` exists. Without the
        // schema `apply` fails at the first call and the card would still
        // claim the mode works - the exact silent failure this module was
        // added to end.
        assert!(matches!(decide_support(true, false, false), Support::Unsupported(_)));
        assert!(matches!(decide_support(true, true, false), Support::Supported));
        // KDE alone is enough; it does not use the GNOME schema at all.
        assert!(matches!(decide_support(false, false, true), Support::Supported));
        assert!(matches!(decide_support(false, false, false), Support::Unsupported(_)));
    }
}
