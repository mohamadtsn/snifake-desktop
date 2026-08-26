/// Cross-platform privilege escalation for launching the engine binary.
///
/// The engine is a real executable path with fixed arguments, never a shell
/// blob. That is what lets polkit pin
/// `org.freedesktop.policykit.exec.path` to exactly this binary and cache
/// the authorisation, and lets a sudoers NOPASSWD rule be scoped to exactly
/// this binary rather than to an arbitrary shell.
use tauri::AppHandle;

#[cfg(unix)]
fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}

#[cfg(windows)]
fn is_root() -> bool {
    false
}

/// True when `sudo -n <program>` currently runs without prompting.
#[cfg(target_os = "linux")]
pub fn has_passwordless_sudo(program: &str) -> bool {
    std::process::Command::new("sudo")
        .args(["-n", "-l", program])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Full argv to run `program args...` with administrator privileges.
///
/// Linux: prefers `sudo -n` against a NOPASSWD rule scoped to the engine,
/// installing that rule once via pkexec if it is missing, and falling back
/// to a plain pkexec run (which prompts every time) if that fails.
/// macOS: osascript.
/// Windows: empty — Phase 3 replaces this with a `runas` ShellExecute.
pub fn elevated_argv(app: &AppHandle, program: &str, args: &[String]) -> Vec<String> {
    if is_root() {
        let mut v = vec![program.to_string()];
        v.extend_from_slice(args);
        return v;
    }

    #[cfg(target_os = "linux")]
    {
        if !has_passwordless_sudo(program) {
            try_install_sudoers(app, program);
        }
        if has_passwordless_sudo(program) {
            let mut v = vec!["sudo".to_string(), "-n".to_string(), program.to_string()];
            v.extend_from_slice(args);
            return v;
        }
        let mut v = if which::which("pkexec").is_ok() {
            vec!["pkexec".to_string()]
        } else {
            return Vec::new();
        };
        v.push(program.to_string());
        v.extend_from_slice(args);
        v
    }

    #[cfg(target_os = "macos")]
    {
        let _ = app;
        let quoted: Vec<String> = std::iter::once(program.to_string())
            .chain(args.iter().cloned())
            .map(|s| format!("'{}'", s.replace('\'', "'\\''")))
            .collect();
        // The engine daemonises itself onto the socket, so osascript's
        // inability to stream a child's stdout does not matter here — all
        // traffic goes over the socket, not the pipe.
        let script = format!("{} &> /dev/null &", quoted.join(" "));
        let escaped = script.replace('\\', "\\\\").replace('"', "\\\"");
        vec![
            "osascript".to_string(),
            "-e".to_string(),
            format!("do shell script \"{escaped}\" with administrator privileges"),
        ]
    }

    #[cfg(target_os = "windows")]
    {
        let _ = (app, program, args);
        Vec::new()
    }
}

/// One-time pkexec-elevated install of a NOPASSWD sudoers rule scoped to
/// exactly `program`. Best effort: on any failure the caller falls back to
/// a re-prompting pkexec run.
#[cfg(target_os = "linux")]
fn try_install_sudoers(app: &AppHandle, program: &str) {
    let Ok(installer) = crate::config::install_sudoers_script_path(app) else {
        return;
    };
    if !installer.exists() {
        return;
    }
    let Ok(user) = std::env::var("USER").or_else(|_| std::env::var("LOGNAME")) else {
        return;
    };
    if user.is_empty() || which::which("pkexec").is_err() {
        return;
    }
    let _ = std::process::Command::new("pkexec")
        .arg(installer)
        .arg(user)
        .arg(program)
        .status();
}

#[cfg(test)]
mod tests {
    #[test]
    fn root_detection_matches_the_effective_uid() {
        #[cfg(unix)]
        assert_eq!(super::is_root(), unsafe { libc::geteuid() } == 0);
    }
}
