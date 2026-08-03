//! The NDJSON wire protocol spoken over the local socket between the
//! unprivileged GUI and the privileged engine.
//!
//! One JSON object per line, `\n` terminated, in both directions.

use serde::{Deserialize, Serialize};

/// A named connection preset. The uppercase JSON keys are the historical
/// config.json names and are part of the on-disk format.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(rename = "LISTEN_HOST")]
    pub listen_host: String,
    #[serde(rename = "LISTEN_PORT")]
    pub listen_port: u16,
    #[serde(rename = "CONNECT_IP")]
    pub connect_ip: String,
    #[serde(rename = "CONNECT_PORT")]
    pub connect_port: u16,
    #[serde(rename = "FAKE_SNI")]
    pub fake_sni: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    /// Stop whatever is running, then start this profile.
    Start { profile: Profile },
    Stop,
    /// Turn per-packet logging on or off.
    Verbose { on: bool },
    /// Stop and exit the process.
    Shutdown,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
    Debug,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Event {
    /// First line the engine sends after the auth token.
    Ready { version: String },
    /// One of: stopped | starting | running | error
    State { state: String },
    Log { level: LogLevel, msg: String },
    /// A machine-readable failure. `code` is stable; `msg` is for humans.
    Error { code: String, msg: String },
}
