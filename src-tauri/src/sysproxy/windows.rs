//! Windows, through the per-user WinINET settings.
//!
//! Writing the registry is not enough on its own: running applications hold
//! the old values until they are told to re-read them, which is what the
//! `InternetSetOptionW` refresh below does. Without it the proxy appears in
//! the Settings app and nothing actually uses it.
//!
//! **Cross-compile-checked here, never executed here.** The two builders are
//! pure, and this file's tests run them on Linux; everything that touches
//! the registry is behind `cfg(windows)` with a no-op stub beside it, so the
//! module compiles on every target this project builds for.
#![cfg_attr(not(windows), allow(dead_code, unused_imports))]

use super::marker::{Previous, ProxySettings};
use super::Support;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

pub fn proxy_server_value(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

/// Loopback must stay direct. A proxy that routes 127.0.0.1 through itself
/// is a loop, and this application's own listener lives there.
pub fn proxy_override_value() -> String {
    "localhost;127.*;10.*;172.16.*;192.168.*;<local>".to_string()
}

#[cfg(windows)]
mod imp {
    use super::*;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    pub fn support() -> Support {
        match hkcu().create_subkey(KEY) {
            Ok(_) => Support::Supported,
            Err(e) => Support::Unsupported(format!(
                "The Internet Settings key could not be opened ({e}). Choose \
                 Manual and point your applications at the port yourself."
            )),
        }
    }

    pub fn read_current() -> Option<ProxySettings> {
        let key = hkcu().open_subkey(KEY).ok()?;
        let server: String = key.get_value("ProxyServer").unwrap_or_default();
        let (host, port) = server.split_once(':').unwrap_or((server.as_str(), "0"));
        let enable: u32 = key.get_value("ProxyEnable").unwrap_or(0);
        let over: String = key.get_value("ProxyOverride").unwrap_or_default();
        Some(ProxySettings {
            enabled: enable == 1,
            host: host.to_string(),
            port: port.parse().unwrap_or(0),
            ignore: over.split(';').filter(|s| !s.is_empty()).map(str::to_string).collect(),
        })
    }

    fn write(enabled: bool, server: &str, over: &str) -> Result<(), String> {
        let (key, _) = hkcu().create_subkey(KEY).map_err(|e| e.to_string())?;
        key.set_value("ProxyEnable", &u32::from(enabled)).map_err(|e| e.to_string())?;
        key.set_value("ProxyServer", &server.to_string()).map_err(|e| e.to_string())?;
        key.set_value("ProxyOverride", &over.to_string()).map_err(|e| e.to_string())?;
        refresh();
        Ok(())
    }

    /// Tell every running WinINET consumer to re-read. Without this the
    /// values are set and nothing honours them until it restarts.
    fn refresh() {
        use std::ptr::null;
        use windows_sys::Win32::Networking::WinInet::{
            InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
        };
        unsafe {
            InternetSetOptionW(null(), INTERNET_OPTION_SETTINGS_CHANGED, null(), 0);
            InternetSetOptionW(null(), INTERNET_OPTION_REFRESH, null(), 0);
        }
    }

    pub fn apply(host: &str, port: u16) -> Result<(), String> {
        write(true, &proxy_server_value(host, port), &proxy_override_value())
    }

    pub fn restore(previous: &Previous) -> Result<(), String> {
        let had = previous.windows.clone().unwrap_or_default();
        write(
            had.enabled,
            &proxy_server_value(&had.host, had.port),
            &had.ignore.join(";"),
        )
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn support() -> Support {
        Support::Unsupported("not Windows".into())
    }
    pub fn read_current() -> Option<ProxySettings> {
        None
    }
    pub fn apply(_host: &str, _port: u16) -> Result<(), String> {
        Ok(())
    }
    pub fn restore(_previous: &Previous) -> Result<(), String> {
        Ok(())
    }
}

/// Windows has one backend, so this is `read_current` in the shape the
/// dispatcher wants.
pub fn read_previous() -> Previous {
    Previous { windows: imp::read_current(), ..Default::default() }
}

pub use imp::{apply, read_current, restore, support};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_proxy_server_value_is_one_host_port_pair() {
        // WinINET takes a bare `host:port` to mean "all protocols". The
        // per-protocol form (`http=h:p;https=h:p`) does not cover SOCKS,
        // so the bare form is the one that captures the most.
        assert_eq!(proxy_server_value("127.0.0.1", 2080), "127.0.0.1:2080");
    }

    #[test]
    fn the_bypass_list_always_keeps_loopback_reachable() {
        let v = proxy_override_value();
        assert!(v.contains("localhost"), "{v}");
        assert!(v.contains("127.*"), "{v}");
        assert!(v.contains("<local>"), "{v}");
    }
}
