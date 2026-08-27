//! Filesystem locations. Everything config-shaped now lives in `profiles.rs`.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Where profiles.json lives. Must stay writable by the unprivileged app
/// process, so it can't be the (root-owned, read-only after install)
/// resource dir the binaries themselves ship in.
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
    base.join("snifake")
}

fn engine_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "snifake-engine.exe"
    } else {
        "snifake-engine"
    }
}

/// The engine binary lives beside the GUI in the bundle's resource dir. In a
/// `cargo tauri dev` run there is no resource dir worth speaking of, so fall
/// back to the directory holding the GUI executable — cargo puts both
/// workspace binaries there.
pub fn engine_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join(engine_name());
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("executable has no parent directory")?;
    let candidate = dir.join(engine_name());
    if candidate.exists() {
        return Ok(candidate);
    }
    Err(format!("engine binary '{}' not found", engine_name()))
}

/// Path to the bundled `install-sudoers.sh` one-time setup wrapper (Linux
/// only). See `engine_host::spawn_engine`.
#[cfg(target_os = "linux")]
pub fn install_sudoers_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("install-sudoers.sh"))
}
