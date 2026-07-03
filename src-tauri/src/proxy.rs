use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::auth::get_elevated_command;
#[cfg(target_os = "linux")]
use crate::auth::{get_elevated_program, has_passwordless_sudo};
use crate::config::{config_path, get_binary_path, save_config, Config};
#[cfg(target_os = "linux")]
use crate::config::{get_install_sudoers_script_path, get_run_script_path};

pub struct ProxyManager {
    child: Option<Child>,
    state: String,
}

impl ProxyManager {
    pub fn new() -> Self {
        ProxyManager {
            child: None,
            state: "stopped".to_string(),
        }
    }

    pub fn state(&self) -> String {
        self.state.clone()
    }

    fn set_state(&mut self, app: &AppHandle, state: &str) {
        self.state = state.to_string();
        let _ = app.emit("state-changed", state);
    }

    fn log(&self, app: &AppHandle, msg: &str) {
        let _ = app.emit("log-message", msg);
    }

    pub fn is_running(&self) -> bool {
        self.state == "running"
    }

    pub fn start(&mut self, app: &AppHandle, config: &Config) {
        if self.is_running() {
            return;
        }

        let binary = match get_binary_path(app) {
            Ok(p) => p,
            Err(e) => {
                self.set_state(app, "error");
                self.log(app, &format!("Binary path error: {e}"));
                return;
            }
        };
        if !binary.exists() {
            self.set_state(app, "error");
            self.log(app, &format!("Binary not found: {}", binary.display()));
            return;
        }
        let Some(binary_dir) = binary.parent() else {
            self.set_state(app, "error");
            self.log(app, "Binary path has no parent directory");
            return;
        };

        // The proxy binary reads config.json from its own directory, which
        // is read-only (root-owned) once installed — so the GUI's writable
        // copy in app_dir() is the source of truth, and gets copied next to
        // the binary as part of the same elevated launch that runs it.
        if let Err(e) = save_config(config) {
            self.set_state(app, "error");
            self.log(app, &format!("Failed to write config.json: {e}"));
            return;
        }

        self.set_state(app, "starting");

        let mut cmd_parts = self.build_launch_command(app, &binary, binary_dir);
        if cmd_parts.is_empty() {
            // Windows: no elevation wrapper (the binary's own UAC manifest
            // handles that when spawned) and no reliable POSIX shell to run
            // the copy script, so best-effort copy directly and spawn plain.
            let _ = std::fs::copy(config_path(), binary_dir.join("config.json"));
            cmd_parts = vec![binary.to_string_lossy().to_string()];
        }

        let mut command = Command::new(&cmd_parts[0]);
        command.args(&cmd_parts[1..]);
        command.current_dir(binary_dir);
        command.env("LISTEN_HOST", &config.listen_host);
        command.env("LISTEN_PORT", config.listen_port.to_string());
        command.env("CONNECT_IP", &config.connect_ip);
        command.env("CONNECT_PORT", config.connect_port.to_string());
        command.env("FAKE_SNI", &config.fake_sni);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // New process group so stop() can signal the whole tree: elevation
            // wrappers (pkexec/sudo) fork the real binary as a child, and
            // signaling just the wrapper's PID can leave that child running
            // as an orphaned root process.
            command.process_group(0);
        }

        match command.spawn() {
            Ok(mut child) => {
                let pid = child.id();
                if let Some(stdout) = child.stdout.take() {
                    spawn_log_reader(app.clone(), stdout);
                }
                if let Some(stderr) = child.stderr.take() {
                    spawn_log_reader(app.clone(), stderr);
                }
                self.child = Some(child);
                self.set_state(app, "running");
                self.log(app, &format!("Proxy started (PID {pid})"));
            }
            Err(e) => {
                self.set_state(app, "error");
                self.log(app, &format!("Failed to start: {e}"));
            }
        }
    }

    /// Builds the elevated argv that copies config.json next to the binary
    /// and execs it.
    ///
    /// Linux prefers `sudo -n` against a NOPASSWD sudoers rule scoped to
    /// the bundled `run-proxy.sh` wrapper, so repeat starts — even across
    /// app/OS restarts — never re-prompt. If that rule isn't installed
    /// yet, it runs a one-time pkexec-elevated setup step to install it
    /// (the only password prompt the user should ever see), then retries.
    /// If setup itself fails or is declined, it falls back to a plain
    /// pkexec run of the wrapper (prompts every time, same as before this
    /// feature existed — never worse than the old behavior).
    ///
    /// A dev build without the bundled resources, or any non-Linux
    /// platform, falls back further to a one-off inline `sh -c` script.
    fn build_launch_command(
        &self,
        app: &AppHandle,
        binary: &std::path::Path,
        binary_dir: &std::path::Path,
    ) -> Vec<String> {
        #[cfg(target_os = "linux")]
        {
            if let Ok(script) = get_run_script_path(app) {
                if script.exists() {
                    let script_str = script.to_string_lossy().to_string();
                    let config_arg = config_path().to_string_lossy().to_string();

                    if !has_passwordless_sudo(&script_str) {
                        self.try_setup_passwordless_sudo(app, &script_str);
                    }

                    if has_passwordless_sudo(&script_str) {
                        return vec!["sudo".to_string(), "-n".to_string(), script_str, config_arg];
                    }

                    return get_elevated_program(&script_str, &[config_arg]);
                }
            }
        }
        let _ = app;
        let inline_script = format!(
            "cp -f {} {} && exec {}",
            shell_quote(&config_path()),
            shell_quote(&binary_dir.join("config.json")),
            shell_quote(binary),
        );
        get_elevated_command(&inline_script)
    }

    /// One-time, pkexec-elevated install of a NOPASSWD sudoers rule scoped
    /// to exactly `run_script`. Best-effort: any failure just leaves the
    /// caller to fall back to a normal (re-prompting) pkexec run.
    #[cfg(target_os = "linux")]
    fn try_setup_passwordless_sudo(&self, app: &AppHandle, run_script: &str) {
        let Ok(installer) = get_install_sudoers_script_path(app) else {
            return;
        };
        if !installer.exists() {
            return;
        }
        let username = std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .unwrap_or_default();
        if username.is_empty() {
            return;
        }
        let argv = get_elevated_program(
            &installer.to_string_lossy(),
            &[username, run_script.to_string()],
        );
        if argv.is_empty() {
            return;
        }
        let _ = Command::new(&argv[0]).args(&argv[1..]).status();
    }

    pub fn stop(&mut self, app: &AppHandle) {
        let Some(mut child) = self.child.take() else {
            self.set_state(app, "stopped");
            return;
        };

        let pid = child.id();
        terminate(pid, &mut child);
        if !wait_with_timeout(&mut child, Duration::from_secs(5)) {
            kill(pid, &mut child);
            let _ = child.wait();
        }

        self.set_state(app, "stopped");
        self.log(app, "Proxy stopped");
    }
}

/// Single-quote a path for interpolation into a `sh -c` script, escaping
/// any literal single quotes. Paths here are our own fixed app/install
/// directories, not arbitrary user input.
fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "'\\''"))
}

/// Streams a child's stdout/stderr into the activity log line-by-line so
/// the proxy binary's own output is visible in the UI, not just our
/// start/stop/error messages.
fn spawn_log_reader<R: std::io::Read + Send + 'static>(app: AppHandle, stream: R) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let _ = app.emit("log-message", line);
        }
    });
}

#[cfg(unix)]
fn terminate(pid: u32, _child: &mut Child) {
    unsafe {
        libc::killpg(pid as i32, libc::SIGTERM);
    }
}

#[cfg(windows)]
fn terminate(_pid: u32, child: &mut Child) {
    let _ = child.kill();
}

#[cfg(unix)]
fn kill(pid: u32, _child: &mut Child) {
    unsafe {
        libc::killpg(pid as i32, libc::SIGKILL);
    }
}

#[cfg(windows)]
fn kill(_pid: u32, child: &mut Child) {
    let _ = child.kill();
}

fn wait_with_timeout(child: &mut Child, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_starts_stopped() {
        let manager = ProxyManager::new();
        assert_eq!(manager.state(), "stopped");
        assert!(!manager.is_running());
    }
}