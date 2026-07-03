use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Config {
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

impl Default for Config {
    fn default() -> Self {
        Config {
            listen_host: "127.0.0.1".into(),
            listen_port: 40443,
            connect_ip: "103.160.204.34".into(),
            connect_port: 443,
            fake_sni: "chatgpt.com".into(),
        }
    }
}

/// Where config.json (and the proxy's working directory) live. The
/// sni-spoof binary reads config.json from its current working directory,
/// so this must stay writable by the unprivileged app process — it can't
/// be the (root-owned, read-only after install) resource dir the binary
/// itself ships in.
pub fn app_dir() -> PathBuf {
    let base = if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs::home_dir().unwrap().join("AppData").join("Roaming"))
    } else if cfg!(target_os = "macos") {
        dirs::home_dir()
            .unwrap()
            .join("Library")
            .join("Application Support")
    } else {
        dirs::config_dir().unwrap_or_else(|| dirs::home_dir().unwrap().join(".config"))
    };
    base.join("sni-fake")
}

pub fn config_path() -> PathBuf {
    app_dir().join("config.json")
}

pub fn load_config() -> Config {
    let path = config_path();
    if let Ok(contents) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<Config>(&contents) {
            return cfg;
        }
    }
    Config::default()
}

pub fn save_config(config: &Config) -> Result<(), String> {
    let dir = app_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let contents = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path(), contents).map_err(|e| e.to_string())
}

fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "sni-spoof-windows-amd64.exe"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "sni-spoof-darwin-arm64"
        } else {
            "sni-spoof-darwin-x86_64"
        }
    } else {
        "sni-spoof-linux-amd64"
    }
}

pub fn get_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(resource_dir.join(binary_name()))
}

/// Path to the bundled `run-proxy.sh` elevation wrapper (Linux only — see
/// `proxy::ProxyManager::start`). Lives alongside the proxy binary so its
/// install location is deterministic and matches the polkit policy.
#[cfg(target_os = "linux")]
pub fn get_run_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(resource_dir.join("run-proxy.sh"))
}

/// Path to the bundled `install-sudoers.sh` one-time setup wrapper (Linux
/// only). See `proxy::ProxyManager::start`.
#[cfg(target_os = "linux")]
pub fn get_install_sudoers_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(resource_dir.join("install-sudoers.sh"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_json_fills_missing_fields_from_default() {
        let partial = r#"{"FAKE_SNI": "example.com"}"#;
        let cfg: Config = serde_json::from_str(partial).unwrap();
        assert_eq!(cfg.fake_sni, "example.com");
        assert_eq!(cfg.listen_host, "127.0.0.1");
        assert_eq!(cfg.listen_port, 40443);
    }

    #[test]
    fn binary_name_matches_current_platform_convention() {
        let name = binary_name();
        assert!(name.starts_with("sni-spoof-"));
    }
}