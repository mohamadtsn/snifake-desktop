//! Owns the privileged engine process for the life of the app session.
//!
//! The GUI listens on a local endpoint (a `0600` unix socket, or a named
//! pipe on Windows), launches the engine elevated once, and then talks
//! NDJSON to it. Keeping one authenticated process
//! alive means the user sees at most one password/UAC prompt per session,
//! and switching profiles costs no prompt at all.
//!
//! Engine log lines go into the shared `LogBuffer`, never straight over IPC
//! — see `logbuf::LogBuffer` for why.

#[cfg(unix)]
use crate::auth::elevated_argv;
use crate::config::engine_path;
use crate::logbuf::LogBuffer;
use sni_fake_engine::proto::{Command, Event, LogLevel, Profile};
use sni_fake_engine::transport::{Listener, Stream};
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// How long to wait for the elevated engine to connect back. Generous: the
/// user may be typing a password into a polkit or UAC dialog.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(120);

/// 128 bits of hex from the OS. The endpoint's own access control is the
/// real barrier; this is defence in depth against a race on the socket path.
fn new_token() -> String {
    sni_fake_engine::sysrand::hex(16)
}

/// The engine process, however it got started.
///
/// On Unix it is an ordinary `Child` because pkexec/sudo/osascript are
/// spawned as ordinary programs. On Windows it is a bare process handle,
/// because `ShellExecuteExW` with the `runas` verb is the only way for a
/// non-elevated parent to launch an elevated child, and it hands back a
/// handle rather than a `Child`.
pub enum EngineProcess {
    /// On Windows this variant is only ever built by the tests — the enum
    /// keeps one shape on every platform so `EngineHost` stays platform-blind.
    #[cfg_attr(windows, allow(dead_code))]
    Child(std::process::Child),
    #[cfg(windows)]
    Handle(isize),
}

impl EngineProcess {
    /// `Some(code)` once the process has exited, `None` while it runs.
    pub fn try_wait(&mut self) -> Option<i32> {
        match self {
            EngineProcess::Child(c) => match c.try_wait() {
                Ok(Some(status)) => Some(status.code().unwrap_or(-1)),
                _ => None,
            },
            #[cfg(windows)]
            EngineProcess::Handle(h) => {
                use windows_sys::Win32::Foundation::HANDLE;
                use windows_sys::Win32::System::Threading::GetExitCodeProcess;
                /// `STILL_ACTIVE` (259) is what GetExitCodeProcess reports
                /// for a live process.
                const STILL_ACTIVE: u32 = 259;
                let mut code: u32 = 0;
                // SAFETY: a process handle we own; code is a valid out-param.
                let ok = unsafe { GetExitCodeProcess(*h as HANDLE, &mut code) };
                if ok == 0 || code == STILL_ACTIVE {
                    None
                } else {
                    Some(code as i32)
                }
            }
        }
    }

    pub fn kill(&mut self) {
        match self {
            EngineProcess::Child(c) => {
                let _ = c.kill();
                let _ = c.wait();
            }
            #[cfg(windows)]
            EngineProcess::Handle(h) => {
                use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
                use windows_sys::Win32::System::Threading::TerminateProcess;
                // SAFETY: a process handle we own.
                unsafe {
                    TerminateProcess(*h as HANDLE, 1);
                    CloseHandle(*h as HANDLE);
                }
            }
        }
    }
}

/// Folds one engine event into the log buffer. Returns a new proxy state
/// when the event carries one. Pure enough to test without a process.
fn apply_event(ev: &Event, logs: &Arc<LogBuffer>) -> Option<String> {
    match ev {
        Event::Ready { version } => {
            logs.push(format!("engine {version} ready"));
            None
        }
        Event::Log { level, msg } => {
            match level {
                LogLevel::Info | LogLevel::Debug => logs.push(msg.clone()),
                LogLevel::Warn => logs.push(format!("warning: {msg}")),
                LogLevel::Error => logs.push(format!("error: {msg}")),
            }
            None
        }
        Event::Error { code, msg } => {
            logs.push(format!("error [{code}]: {msg}"));
            None
        }
        Event::State { state } => Some(state.clone()),
    }
}

/// The tray label follows whichever profile is active. Read it from managed
/// state rather than passing it down every call — the reader thread has no
/// other route to it.
fn active_profile_name(app: &AppHandle) -> String {
    use tauri::Manager;
    app.try_state::<crate::AppState>()
        .and_then(|s| {
            let store = s.store.lock().ok()?;
            crate::profiles::active(&store).map(|p| p.name.clone())
        })
        .unwrap_or_default()
}

pub struct EngineHost {
    logs: Arc<LogBuffer>,
    state: String,
    child: Option<EngineProcess>,
    writer: Option<Arc<Mutex<Stream>>>,
}

impl EngineHost {
    pub fn new(logs: Arc<LogBuffer>) -> Self {
        EngineHost {
            logs,
            state: "stopped".into(),
            child: None,
            writer: None,
        }
    }

    pub fn state(&self) -> String {
        self.state.clone()
    }

    fn set_state(&mut self, app: &AppHandle, state: &str) {
        self.state = state.to_string();
        let _ = app.emit("state-changed", state);
        // Tray mutation must happen on the GTK main thread on Linux — doing it
        // from a command's worker thread intermittently blanks the menu labels.
        let handle = app.clone();
        let state = state.to_string();
        let _ = app.run_on_main_thread(move || {
            let name = active_profile_name(&handle);
            crate::tray::update_tray(&handle, &state, &name);
        });
    }

    fn send(&mut self, cmd: &Command) -> Result<(), String> {
        let writer = self.writer.clone().ok_or("engine is not running")?;
        let mut line = serde_json::to_string(cmd).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut guard = writer.lock().unwrap();
        guard.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        guard.flush().map_err(|e| e.to_string())
    }

    pub fn start(&mut self, app: &AppHandle, profile: &Profile) -> Result<(), String> {
        if self.writer.is_none() {
            self.set_state(app, "starting");
            if let Err(e) = self.spawn_engine(app) {
                self.set_state(app, "error");
                return Err(e);
            }
        }
        self.send(&Command::Start {
            profile: profile.clone(),
        })
    }

    pub fn stop(&mut self, app: &AppHandle) {
        if self.writer.is_none() {
            self.set_state(app, "stopped");
            return;
        }
        if let Err(e) = self.send(&Command::Stop) {
            self.logs
                .push(format!("error: could not reach the engine: {e}"));
            self.set_state(app, "error");
        }
    }

    pub fn set_verbose(&mut self, on: bool) {
        let _ = self.send(&Command::Verbose { on });
    }

    /// Best-effort teardown on quit: ask nicely, then kill.
    pub fn shutdown(&mut self) {
        let _ = self.send(&Command::Shutdown);
        self.writer = None;
        if let Some(mut child) = self.child.take() {
            for _ in 0..20 {
                if child.try_wait().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            child.kill();
        }
    }

    /// Waits for the engine to connect back, giving up early if it dies first.
    ///
    /// On Unix `accept_timeout` is a cheap non-blocking poll, so it is sliced
    /// to notice a cancelled pkexec/osascript prompt at once rather than
    /// waiting out the whole timeout. On Windows a declined UAC prompt is
    /// already reported synchronously by `ShellExecuteEx`, and every
    /// `accept_timeout` call costs a worker thread parked in
    /// `ConnectNamedPipe`, so it is called exactly once.
    fn accept_engine(&mut self, listener: &Listener) -> Result<Stream, String> {
        #[cfg(windows)]
        return listener
            .accept_timeout(CONNECT_TIMEOUT)
            .map_err(|e| format!("the engine never connected back ({e})"));

        #[cfg(unix)]
        {
            let deadline = std::time::Instant::now() + CONNECT_TIMEOUT;
            loop {
                match listener.accept_timeout(Duration::from_millis(50)) {
                    Ok(s) => return Ok(s),
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        if let Some(code) = self.child.as_mut().and_then(|c| c.try_wait()) {
                            return Err(format!("the engine exited before connecting ({code})"));
                        }
                        if std::time::Instant::now() > deadline {
                            return Err(
                                "the engine never connected back (authentication cancelled?)"
                                    .into(),
                            );
                        }
                    }
                    Err(e) => return Err(format!("accept: {e}")),
                }
            }
        }
    }

    /// Creates the endpoint, launches the engine elevated, waits for it to
    /// connect back and authenticate, then starts the reader thread.
    fn spawn_engine(&mut self, app: &AppHandle) -> Result<(), String> {
        let listener = Listener::bind().map_err(|e| format!("create local endpoint: {e}"))?;

        let token = new_token();
        let engine = engine_path(app)?;
        let engine_args = [listener.endpoint().as_str().to_string(), token.clone()];

        #[cfg(windows)]
        let child = {
            self.logs.push("launching engine (elevated)".to_string());
            crate::elevate_windows::spawn_elevated(&engine.to_string_lossy(), &engine_args)?
        };

        #[cfg(unix)]
        let child = {
            let argv = elevated_argv(app, &engine.to_string_lossy(), &engine_args);
            if argv.is_empty() {
                return Err("no way to obtain administrator privileges on this system".into());
            }
            self.logs
                .push(format!("launching engine: {}", argv.join(" ")));
            EngineProcess::Child(
                std::process::Command::new(&argv[0])
                    .args(&argv[1..])
                    .spawn()
                    .map_err(|e| format!("spawn {}: {e}", argv[0]))?,
            )
        };
        self.child = Some(child);

        let stream = self.accept_engine(&listener);
        listener.cleanup();
        let stream = stream?;

        let reader_stream = stream.try_clone().map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(reader_stream);
        let mut first = String::new();
        reader.read_line(&mut first).map_err(|e| e.to_string())?;
        if first.trim() != token {
            return Err("the process that connected did not present the expected token".into());
        }

        self.writer = Some(Arc::new(Mutex::new(stream)));

        let logs = self.logs.clone();
        let handle = app.clone();
        std::thread::spawn(move || {
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Event>(&line) {
                    Ok(ev) => {
                        if let Some(state) = apply_event(&ev, &logs) {
                            let _ = handle.emit("state-changed", &state);
                            let h = handle.clone();
                            // Tray mutation must happen on the GTK main thread.
                            let _ = handle.run_on_main_thread(move || {
                                let name = active_profile_name(&h);
                                crate::tray::update_tray(&h, &state, &name);
                            });
                        }
                    }
                    Err(e) => logs.push(format!("error: unparsable engine event: {e}")),
                }
            }
            logs.push("error: the engine connection closed".into());
            let _ = handle.emit("state-changed", "error");
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_finished_child_reports_its_exit_code() {
        let child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
            .args(if cfg!(windows) {
                vec!["/C", "exit", "0"]
            } else {
                vec![]
            })
            .spawn()
            .unwrap();
        let mut proc = EngineProcess::Child(child);
        // Poll rather than sleep-and-hope.
        for _ in 0..100 {
            if proc.try_wait().is_some() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("the child never reported an exit code");
    }

    #[test]
    fn a_running_child_reports_nothing_yet() {
        let child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sleep" })
            .args(if cfg!(windows) {
                vec!["/C", "timeout", "5"]
            } else {
                vec!["5"]
            })
            .spawn()
            .unwrap();
        let mut proc = EngineProcess::Child(child);
        assert!(proc.try_wait().is_none());
        proc.kill();
    }

    #[test]
    fn a_fresh_host_is_stopped() {
        let host = EngineHost::new(Arc::new(LogBuffer::new()));
        assert_eq!(host.state(), "stopped");
    }

    #[test]
    fn tokens_are_unique_and_long_enough_to_be_unguessable() {
        let a = new_token();
        let b = new_token();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn events_map_onto_log_lines_and_state() {
        let logs = Arc::new(LogBuffer::new());
        let ev: Event =
            serde_json::from_str(r#"{"ev":"log","level":"info","msg":"hello"}"#).unwrap();
        assert_eq!(apply_event(&ev, &logs), None);
        assert_eq!(logs.snapshot(), vec!["hello".to_string()]);

        let ev: Event = serde_json::from_str(r#"{"ev":"state","state":"running"}"#).unwrap();
        assert_eq!(apply_event(&ev, &logs), Some("running".to_string()));

        let ev: Event =
            serde_json::from_str(r#"{"ev":"error","code":"no_route","msg":"nope"}"#).unwrap();
        assert_eq!(apply_event(&ev, &logs), None);
        assert!(logs.snapshot().iter().any(|l| l.contains("no_route")));
    }
}
