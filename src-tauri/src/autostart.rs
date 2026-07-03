use std::fs;
use std::path::PathBuf;

const APP_NAME: &str = "sni-fake";
const APP_DISPLAY: &str = "SNI Spoof";

#[cfg(target_os = "linux")]
fn desktop_file_path() -> PathBuf {
    dirs::home_dir()
        .unwrap()
        .join(".config")
        .join("autostart")
        .join(format!("{APP_NAME}.desktop"))
}

#[cfg(target_os = "macos")]
fn plist_path() -> PathBuf {
    dirs::home_dir()
        .unwrap()
        .join("Library")
        .join("LaunchAgents")
        .join(format!("com.{APP_NAME}.plist"))
}

pub fn is_autostart_enabled() -> bool {
    #[cfg(target_os = "linux")]
    {
        desktop_file_path().exists()
    }
    #[cfg(target_os = "macos")]
    {
        plist_path().exists()
    }
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        match hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") {
            Ok(key) => key.get_value::<String, _>(APP_NAME).is_ok(),
            Err(_) => false,
        }
    }
}

pub fn toggle_autostart(enable: bool, exe_path: &str) -> Result<(), String> {
    if enable {
        enable_autostart(exe_path)
    } else {
        disable_autostart()
    }
}

#[cfg(target_os = "linux")]
fn enable_autostart(exe_path: &str) -> Result<(), String> {
    let path = desktop_file_path();
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let contents = format!(
        "[Desktop Entry]\nType=Application\nName={APP_DISPLAY}\nExec={exe_path}\nHidden=false\nX-GNOME-Autostart-enabled=true\n"
    );
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn disable_autostart() -> Result<(), String> {
    let path = desktop_file_path();
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn enable_autostart(exe_path: &str) -> Result<(), String> {
    let path = plist_path();
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let contents = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.{APP_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#
    );
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn disable_autostart() -> Result<(), String> {
    let path = plist_path();
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn enable_autostart(exe_path: &str) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map_err(|e| e.to_string())?;
    key.set_value(APP_NAME, &format!("\"{exe_path}\""))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn disable_autostart() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    ) {
        let _ = key.delete_value(APP_NAME);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_autostart_enabled_does_not_panic() {
        let _ = is_autostart_enabled();
    }
}