//! The tunnel store: V2Ray connection profiles plus one global routing
//! policy and mode. A sibling of `profiles.rs`, deliberately shaped the
//! same way, with one difference — an empty store is a valid, expected
//! state, because the tunnel is optional.

use crate::config::app_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Vless,
    Trojan,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelMode {
    Tun,
    SystemProxy,
    Manual,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DefaultRoute {
    Proxy,
    Direct,
}

/// One V2Ray connection. `address` and `port` are deliberately absent:
/// they are read from the running SNI profile at generation time, because
/// a stored read-only field eventually disagrees with reality.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct TunnelProfile {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    /// UUID for VLESS, password for Trojan.
    pub credential: String,
    /// The real destination. Becomes the WebSocket `Host` header.
    pub remote_host: String,
    pub path: String,
    pub sni: String,
    pub alpn: Vec<String>,
    pub fingerprint: String,
    pub allow_insecure: bool,
}

impl Default for TunnelProfile {
    fn default() -> Self {
        TunnelProfile {
            id: String::new(),
            name: String::new(),
            protocol: Protocol::Vless,
            credential: String::new(),
            remote_host: String::new(),
            path: "/".into(),
            sni: String::new(),
            alpn: vec!["h3".into(), "h2".into(), "http/1.1".into()],
            fingerprint: "chrome".into(),
            allow_insecure: false,
        }
    }
}

impl TunnelProfile {
    pub fn new(name: &str, protocol: Protocol) -> Self {
        TunnelProfile {
            id: new_id(),
            name: name.to_string(),
            protocol,
            ..Default::default()
        }
    }
}

/// Routing policy. Global rather than per-tunnel: users change servers
/// often and policy rarely, so binding them means every server switch
/// silently changes the rules.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Routing {
    /// One rule per line, in the prefixed syntax `rules.rs` parses.
    pub block: Vec<String>,
    pub bypass: Vec<String>,
    pub proxy: Vec<String>,
    /// Merged into `route.rules` verbatim, after the guards.
    pub raw: Option<serde_json::Value>,
    pub default_route: DefaultRoute,
    /// UDP/443. On by default: our path is a TCP relay, so QUIC would
    /// otherwise escape rather than fall back.
    pub block_quic: bool,
    /// Allow LAN/link-local straight out. On by default so the home
    /// router and the printer keep working.
    pub allow_lan: bool,
    /// TUN only. Off: nothing is dropped, so traffic the TUN does not carry
    /// leaves directly and a failed tunnel can leak.
    pub kill_switch: bool,
    /// TUN only. Interfaces of VPNs that must keep working beside it. The
    /// engine discovers their routes and servers.
    pub passthrough: Vec<String>,
}

impl Default for Routing {
    fn default() -> Self {
        Routing {
            block: Vec::new(),
            bypass: Vec::new(),
            proxy: Vec::new(),
            raw: None,
            default_route: DefaultRoute::Proxy,
            block_quic: true,
            allow_lan: true,
            kill_switch: true,
            passthrough: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct TunnelStore {
    pub tunnels: Vec<TunnelProfile>,
    pub active_id: Option<String>,
    pub mode: TunnelMode,
    pub proxy_host: String,
    pub proxy_port: u16,
    pub routing: Routing,
}

impl Default for TunnelStore {
    fn default() -> Self {
        TunnelStore {
            tunnels: Vec::new(),
            active_id: None,
            // SystemProxy, not Manual: a first-time user who turns the
            // tunnel on expects their browser to go through it. Manual
            // opens a port nothing is pointed at, which is indistinguishable
            // from "it did not work". `sysproxy` restores whatever was there
            // on the way out, including after a crash.
            mode: TunnelMode::SystemProxy,
            proxy_host: "127.0.0.1".into(),
            proxy_port: 2080,
            routing: Routing::default(),
        }
    }
}

pub fn tunnels_path() -> PathBuf {
    app_dir().join("tunnels.json")
}

/// Monotonic-enough unique id, on the same reasoning as `profiles.rs`:
/// tunnels are created by hand at human speed.
fn new_id() -> String {
    format!(
        "t{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

pub fn load() -> TunnelStore {
    fs::read_to_string(tunnels_path())
        .ok()
        .and_then(|body| serde_json::from_str(&body).ok())
        .unwrap_or_default()
}

pub fn save(store: &TunnelStore) -> Result<(), String> {
    fs::create_dir_all(app_dir()).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(tunnels_path(), body).map_err(|e| e.to_string())
}

pub fn upsert(store: &mut TunnelStore, tunnel: TunnelProfile) {
    match store.tunnels.iter_mut().find(|t| t.id == tunnel.id) {
        Some(existing) => *existing = tunnel,
        None => store.tunnels.push(tunnel),
    }
}

/// Unlike `profiles::delete`, removing the last one is allowed: "no
/// tunnel configured" is the state the application ships in.
pub fn delete(store: &mut TunnelStore, id: &str) {
    store.tunnels.retain(|t| t.id != id);
    if store.active_id.as_deref() == Some(id) {
        store.active_id = store.tunnels.first().map(|t| t.id.clone());
    }
}

pub fn active(store: &TunnelStore) -> Option<&TunnelProfile> {
    let id = store.active_id.as_deref()?;
    store.tunnels.iter().find(|t| t.id == id)
}

pub fn set_active(store: &mut TunnelStore, id: &str) -> Result<(), String> {
    if !store.tunnels.iter().any(|t| t.id == id) {
        return Err(format!("no tunnel with id '{id}'"));
    }
    store.active_id = Some(id.to_string());
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_store_sets_the_system_proxy_by_default() {
        // The mode a first-time user gets. Manual opens a port that nothing is
        // pointed at, which reads as "it did not work".
        assert_eq!(TunnelStore::default().mode, TunnelMode::SystemProxy);
    }

    #[test]
    fn a_stored_mode_survives_the_default_change() {
        let stored = r#"{"mode":"manual","proxy_port":2080}"#;
        let store: TunnelStore = serde_json::from_str(stored).unwrap();
        assert_eq!(store.mode, TunnelMode::Manual, "an existing choice must not be overwritten");
    }

    #[test]
    fn an_old_tunnels_json_keeps_the_kill_switch_on() {
        let s: TunnelStore = serde_json::from_str(r#"{"routing":{"allow_lan":true}}"#).unwrap();
        assert!(s.routing.kill_switch);
        assert!(s.routing.passthrough.is_empty());
    }}
