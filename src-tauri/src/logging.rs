//! Crash-resilient persistent structured logging and diagnostics.
//!
//! Captures application events, errors, and panics into a rotating log file
//! (`snifake.log` / `snifake.prev.log`) in `app_dir()/logs/`.
//!
//! Error and panic records are synchronously flushed to disk (`sync_all`) so
//! that critical diagnostic clues are preserved even upon unexpected crashes,
//! segfaults, or process termination.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// Maximum log file size before rotating to `snifake.prev.log` (5 MB).
pub const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024;

/// In-memory ring buffer capacity for recent structured entries.
pub const RECENT_LOG_CAPACITY: usize = 200;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DiagnosticReport {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub timestamp: String,
    pub log_file: String,
    pub log_size_bytes: u64,
    pub recent_logs: Vec<LogEntry>,
}

struct LoggerState {
    log_path: PathBuf,
    prev_log_path: PathBuf,
    file: File,
    current_size: u64,
}

static LOGGER: Mutex<Option<LoggerState>> = Mutex::new(None);
static RECENT_LOGS: Mutex<VecDeque<LogEntry>> = Mutex::new(VecDeque::new());

/// Generate standard ISO-8601 UTC timestamp string with millisecond precision
/// without external crates (e.g. `2026-10-02T15:04:05.123Z`).
pub fn iso8601_now() -> String {
    let now = SystemTime::now();
    let duration = now.duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();

    // Standard civil time conversion from epoch seconds (Howard Hinnant's algorithm)
    let days = (secs / 86400) as i64;
    let rem_secs = (secs % 86400) as i64;
    let hours = rem_secs / 3600;
    let minutes = (rem_secs % 3600) / 60;
    let seconds = rem_secs % 60;

    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1024 + doe / 1461 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, hours, minutes, seconds, millis
    )
}

/// Initialize persistent crash-resilient logging.
/// Must be called once at app startup before any plugins or threads are launched.
pub fn init() {
    let dir = crate::config::logs_dir();
    let _ = std::fs::create_dir_all(&dir);

    let log_path = dir.join("snifake.log");
    let prev_log_path = dir.join("snifake.prev.log");

    let (file, current_size) = match open_or_rotate(&log_path, &prev_log_path) {
        Ok(res) => res,
        Err(e) => {
            eprintln!("Failed to initialize log file at {}: {e}", log_path.display());
            return;
        }
    };

    let mut guard = LOGGER.lock().unwrap();
    *guard = Some(LoggerState {
        log_path,
        prev_log_path,
        file,
        current_size,
    });
    drop(guard);

    // Install panic hook to ensure crashes record panic details and flush to disk
    install_panic_hook();

    info(
        "app",
        &format!(
            "Snifake v{} started on {} ({})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );
}

fn open_or_rotate(log_path: &Path, prev_log_path: &Path) -> std::io::Result<(File, u64)> {
    let metadata = std::fs::metadata(log_path);
    if let Ok(meta) = metadata {
        if meta.len() >= MAX_LOG_SIZE {
            let _ = std::fs::remove_file(prev_log_path);
            let _ = std::fs::rename(log_path, prev_log_path);
        }
    }

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    Ok((file, size))
}

fn install_panic_hook() {
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };

        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let backtrace = format!("{:?}", std::backtrace::Backtrace::capture());
        log_with_sync(
            "PANIC",
            "panic",
            &format!("Panic at {location}: {msg}"),
            Some(&backtrace),
            true,
        );

        prev_hook(info);
    }));
}

/// Core logging function. Thread-safe, appends to `snifake.log`, updates the
/// in-memory ring buffer, and on error/panic forces an OS disk flush (`sync_all`).
pub fn log(level: &str, target: &str, message: &str, details: Option<&str>) {
    let is_critical = level == "ERROR" || level == "PANIC" || level == "FATAL";
    log_with_sync(level, target, message, details, is_critical);
}

fn log_with_sync(
    level: &str,
    target: &str,
    message: &str,
    details: Option<&str>,
    sync_disk: bool,
) {
    let timestamp = iso8601_now();
    let entry = LogEntry {
        timestamp: timestamp.clone(),
        level: level.to_uppercase(),
        target: target.to_string(),
        message: message.to_string(),
        details: details.map(|s| s.to_string()),
    };

    // 1. In-memory ring update
    {
        let mut ring = RECENT_LOGS.lock().unwrap();
        if ring.len() >= RECENT_LOG_CAPACITY {
            ring.pop_front();
        }
        ring.push_back(entry);
    }

    // 2. Persistent file append
    let mut guard = match LOGGER.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Some(state) = guard.as_mut() {
        // Rotate if needed
        if state.current_size >= MAX_LOG_SIZE {
            drop(state.file.flush());
            let _ = std::fs::remove_file(&state.prev_log_path);
            let _ = std::fs::rename(&state.log_path, &state.prev_log_path);
            if let Ok(new_file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&state.log_path)
            {
                state.file = new_file;
                state.current_size = 0;
            }
        }

        let mut line = format!("{} [{}] [{}] {}\n", timestamp, level.to_uppercase(), target, message);
        if let Some(d) = details {
            for subline in d.lines() {
                line.push_str("    ");
                line.push_str(subline);
                line.push('\n');
            }
        }

        let bytes = line.as_bytes();
        if let Ok(()) = state.file.write_all(bytes) {
            state.current_size += bytes.len() as u64;
            if sync_disk {
                let _ = state.file.flush();
                let _ = state.file.sync_all();
            }
        }
    }
}

pub fn info(target: &str, message: &str) {
    log("INFO", target, message, None);
}

pub fn warn(target: &str, message: &str) {
    log("WARN", target, message, None);
}

pub fn error(target: &str, message: &str) {
    log("ERROR", target, message, None);
}

pub fn error_with_details(target: &str, message: &str, details: &str) {
    log("ERROR", target, message, Some(details));
}

/// Generates a diagnostic report containing system environment info, log location,
/// log file size, and the latest structured log entries.
pub fn generate_report() -> DiagnosticReport {
    let recent = RECENT_LOGS.lock().unwrap().iter().cloned().collect();
    let guard = LOGGER.lock().unwrap();

    let (path_str, size) = if let Some(state) = guard.as_ref() {
        (state.log_path.to_string_lossy().to_string(), state.current_size)
    } else {
        (
            crate::config::logs_dir()
                .join("snifake.log")
                .to_string_lossy()
                .to_string(),
            0,
        )
    };

    DiagnosticReport {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        timestamp: iso8601_now(),
        log_file: path_str,
        log_size_bytes: size,
        recent_logs: recent,
    }
}

/// Exports the diagnostic report as a pretty-printed JSON file to `dest_path`.
pub fn export_bundle(dest_path: &Path) -> Result<(), String> {
    let report = generate_report();
    let json = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    if let Some(parent) = dest_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(dest_path, json).map_err(|e| format!("write {}: {e}", dest_path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_has_expected_format() {
        let ts = iso8601_now();
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), 24); // e.g. "2026-10-02T15:04:05.123Z"
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], "T");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
        assert_eq!(&ts[19..20], ".");
    }

    #[test]
    fn log_entry_serializes_and_deserializes() {
        let entry = LogEntry {
            timestamp: "2026-10-02T12:00:00.000Z".to_string(),
            level: "ERROR".to_string(),
            target: "engine".to_string(),
            message: "process terminated".to_string(),
            details: Some("exit code 1".to_string()),
        };
        let serialized = serde_json::to_string(&entry).unwrap();
        let deserialized: LogEntry = serde_json::from_str(&serialized).unwrap();
        assert_eq!(entry, deserialized);
    }

    #[test]
    fn recent_logs_ring_evicts_at_capacity() {
        let mut ring: VecDeque<LogEntry> = VecDeque::new();
        for i in 0..(RECENT_LOG_CAPACITY + 10) {
            if ring.len() >= RECENT_LOG_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(LogEntry {
                timestamp: iso8601_now(),
                level: "INFO".to_string(),
                target: "test".to_string(),
                message: format!("msg {i}"),
                details: None,
            });
        }
        assert_eq!(ring.len(), RECENT_LOG_CAPACITY);
        assert_eq!(ring[0].message, "msg 10");
    }
}
