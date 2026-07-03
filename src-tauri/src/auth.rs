/// Cross-platform privilege escalation for running the proxy binary.
///
/// The proxy launch is a small shell script (copy config.json next to the
/// binary in its read-only install dir, then exec the binary) rather than
/// a bare path, so elevation always wraps a `sh -c <script>` invocation.

#[cfg(unix)]
fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}

#[cfg(windows)]
fn is_root() -> bool {
    false
}

/// Return the full argv needed to run `script` (a POSIX shell one-liner)
/// with elevated privileges.
///
/// Linux:   Uses pkexec (polkit GUI dialog), falls back to `sudo -n`.
/// macOS:   Uses osascript with administrator privileges.
/// Windows: Returns [] — elevation is handled by the proxy binary's own
///          UAC manifest when Windows spawns it, so there's no wrapper to
///          build here; the caller falls back to a direct, unwrapped spawn.
pub fn get_elevated_command(script: &str) -> Vec<String> {
    if is_root() {
        return vec!["sh".to_string(), "-c".to_string(), script.to_string()];
    }

    if cfg!(target_os = "linux") {
        if which::which("pkexec").is_ok() {
            return vec![
                "pkexec".to_string(),
                "sh".to_string(),
                "-c".to_string(),
                script.to_string(),
            ];
        }
        if which::which("sudo").is_ok() {
            return vec![
                "sudo".to_string(),
                "-n".to_string(),
                "sh".to_string(),
                "-c".to_string(),
                script.to_string(),
            ];
        }
        vec!["sh".to_string(), "-c".to_string(), script.to_string()]
    } else if cfg!(target_os = "macos") {
        let escaped = script.replace('\\', "\\\\").replace('"', "\\\"");
        vec![
            "osascript".to_string(),
            "-e".to_string(),
            format!("do shell script \"{escaped}\" with administrator privileges"),
        ]
    } else {
        vec![]
    }
}

/// Return the full argv needed to run `program` (a real executable path,
/// not a shell script blob) with `args`, elevated.
///
/// This is what makes pkexec's policy caching (`auth_admin_keep`) work: a
/// polkit action can pin `org.freedesktop.policykit.exec.path` to exactly
/// `program` and grant repeat, non-reprompting runs of it — which isn't
/// possible for an inline `sh -c "..."` blob, since polkit would then see
/// the program as `/bin/sh` and have to authorize arbitrary shell one-liners
/// forever, not just this app's proxy launch.
pub fn get_elevated_program(program: &str, args: &[String]) -> Vec<String> {
    if is_root() {
        let mut v = vec![program.to_string()];
        v.extend_from_slice(args);
        return v;
    }

    if cfg!(target_os = "linux") {
        let mut v = if which::which("pkexec").is_ok() {
            vec!["pkexec".to_string()]
        } else if which::which("sudo").is_ok() {
            vec!["sudo".to_string(), "-n".to_string()]
        } else {
            vec![]
        };
        v.push(program.to_string());
        v.extend_from_slice(args);
        v
    } else {
        vec![]
    }
}

/// True if `sudo -n <program>` can currently run without prompting for a
/// password — either because a NOPASSWD sudoers rule for it was already
/// installed (see `ensure_passwordless_sudo` in proxy.rs), or an unrelated
/// sudo timestamp happens to still be cached.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_wraps_script_in_sh_c() {
        if is_root() {
            assert_eq!(
                get_elevated_command("echo hi"),
                vec!["sh".to_string(), "-c".to_string(), "echo hi".to_string()]
            );
        }
    }

    #[test]
    fn windows_returns_empty_no_wrapper() {
        if cfg!(target_os = "windows") && !is_root() {
            assert!(get_elevated_command("echo hi").is_empty());
        }
    }
}