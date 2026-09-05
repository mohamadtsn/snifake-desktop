/// Cross-platform privilege escalation for launching the engine binary.
///
/// The engine is a real executable path with fixed arguments, never a shell
/// blob. That is what lets polkit pin
/// `org.freedesktop.policykit.exec.path` to exactly this binary and cache
/// the authorisation, and lets a sudoers NOPASSWD rule be scoped to exactly
/// this binary rather than to an arbitrary shell.
#[cfg(unix)]
use tauri::AppHandle;

#[cfg(unix)]
fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}

/// True when `sudo -n <program>` currently runs without prompting.
///
/// `sudo -n -l <program>` answers a different question — "may this user run
/// it at all" — so a desktop admin's plain `(ALL : ALL) ALL` entry makes it
/// exit 0 while the real run still stops for a password, which no `-n` launch
/// can ever supply. Only a NOPASSWD rule covering the program means no
/// prompt, so read the listing and look for one.
#[cfg(target_os = "linux")]
pub fn has_passwordless_sudo(program: &str) -> bool {
    let Ok(out) = std::process::Command::new("sudo")
        .args(["-n", "-l"])
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|line| nopasswd_covers(line, program))
}

/// Whether one `sudo -l` listing line grants `program` without a password.
#[cfg(target_os = "linux")]
fn nopasswd_covers(line: &str, program: &str) -> bool {
    let Some((_, commands)) = line.split_once("NOPASSWD:") else {
        return false;
    };
    commands.split(',').any(|entry| {
        // Drop any further tags (`SETENV:` and friends) before the command.
        let command = entry
            .split_whitespace()
            .find(|token| !token.ends_with(':'))
            .unwrap_or("");
        command == "ALL" || command == program
    })
}

/// Full argv to run `program args...` with administrator privileges.
///
/// Linux: prefers `sudo -n` against a NOPASSWD rule scoped to the engine,
/// installing that rule once via pkexec if it is missing, and falling back
/// to a plain pkexec run (which prompts every time) if that fails.
/// macOS: osascript.
/// Windows has no branch here at all: a non-elevated parent can only raise a
/// child through `ShellExecuteExW`, which is `elevate_windows::spawn_elevated`.
#[cfg(unix)]
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
    #[cfg(target_os = "linux")]
    #[test]
    fn only_a_nopasswd_entry_counts_as_passwordless() {
        let engine = "/usr/lib/Snifake/snifake-engine";
        // The entry every desktop admin account has: allowed, but prompts.
        assert!(!super::nopasswd_covers("    (ALL : ALL) ALL", engine));
        // A NOPASSWD rule for some other binary is not ours.
        assert!(!super::nopasswd_covers(
            "    (root) NOPASSWD: /usr/lib/sni-fake/run-proxy.sh",
            engine
        ));
        assert!(super::nopasswd_covers(
            &format!("    (root) NOPASSWD: {engine}"),
            engine
        ));
        assert!(super::nopasswd_covers(
            &format!("    (root) NOPASSWD: SETENV: {engine}"),
            engine
        ));
        assert!(super::nopasswd_covers(
            &format!("    (root) NOPASSWD: /bin/ls, {engine}"),
            engine
        ));
        assert!(super::nopasswd_covers("    (ALL) NOPASSWD: ALL", engine));
    }

    #[test]
    fn root_detection_matches_the_effective_uid() {
        #[cfg(unix)]
        assert_eq!(super::is_root(), unsafe { libc::geteuid() } == 0);
    }
}
