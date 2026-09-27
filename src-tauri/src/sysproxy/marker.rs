//! The record that makes a set proxy survivable.
//!
//! Written *before* `apply`, holding what the user had. If the process is
//! killed between apply and clear — a crash, a SIGKILL, a power cut — the
//! next launch finds this file and puts their settings back. Without it,
//! one crash silently takes the user's internet away and nothing on the
//! machine connects that to this application.

use crate::config::app_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// One platform's proxy configuration, as it was before we touched it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ProxySettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub ignore: Vec<String>,
}

/// Every backend records separately: a machine can run GNOME and KDE
/// applications side by side, and we write both.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(default)]
pub struct Previous {
    pub gnome: Option<ProxySettings>,
    pub kde: Option<ProxySettings>,
    pub macos: Option<ProxySettings>,
    pub windows: Option<ProxySettings>,
}

/// What we wrote, alongside what was there before.
///
/// `applied` is not bookkeeping: it is how `clear` tells "still ours" from
/// "the user has since changed it by hand". Restoring over a newer choice
/// of theirs would be the same class of mistake as never restoring at all.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(default)]
pub struct Applied {
    pub previous: Previous,
    pub applied: ProxySettings,
}

impl Default for ProxySettings {
    fn default() -> Self {
        ProxySettings { enabled: false, host: String::new(), port: 0, ignore: Vec::new() }
    }
}

impl Applied {
    /// `live` is what the platform reports right now, or `None` when it
    /// could not be read.
    pub fn should_restore(&self, live: Option<&ProxySettings>) -> bool {
        match live {
            // Unreadable: restore anyway. Leaving our proxy in place is the
            // worse of the two failures - it is the one that takes the
            // user's internet with it.
            None => true,
            Some(now) => now == &self.applied,
        }
    }
}

pub fn path() -> PathBuf {
    app_dir().join("sysproxy.applied.json")
}

pub fn write(record: &Applied) -> Result<(), String> {
    fs::create_dir_all(app_dir()).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    fs::write(path(), body).map_err(|e| e.to_string())
}

pub fn read() -> Option<Applied> {
    let body = fs::read_to_string(path()).ok()?;
    serde_json::from_str(&body).ok()
}

pub fn remove() {
    // Best effort. A marker that outlives its restore causes one redundant
    // restore on the next launch, which is harmless; a failed remove that
    // aborted the caller would not be.
    let _ = fs::remove_file(path());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Previous {
        Previous {
            gnome: Some(ProxySettings {
                enabled: true,
                host: "10.0.0.9".into(),
                port: 8080,
                ignore: vec!["localhost".into(), "127.0.0.0/8".into()],
            }),
            kde: None,
            macos: None,
            windows: None,
        }
    }

    #[test]
    fn a_previous_record_round_trips_through_json() {
        let json = serde_json::to_string(&sample()).unwrap();
        let back: Previous = serde_json::from_str(&json).unwrap();
        let g = back.gnome.unwrap();
        assert!(g.enabled);
        assert_eq!(g.host, "10.0.0.9");
        assert_eq!(g.port, 8080);
        assert_eq!(g.ignore, vec!["localhost", "127.0.0.0/8"]);
        assert!(back.kde.is_none());
    }

    #[test]
    fn a_record_written_by_an_older_version_still_loads() {
        // Only the field that version knew about. The rest default to None,
        // so an upgrade never fails to restore what it *can* restore.
        let back: Previous = serde_json::from_str(r#"{"gnome":null}"#).unwrap();
        assert!(back.gnome.is_none());
        assert!(back.windows.is_none());
    }

    #[test]
    fn a_record_knows_what_we_applied_so_a_hand_edit_can_be_detected() {
        let applied = ProxySettings {
            enabled: true,
            host: "127.0.0.1".into(),
            port: 2080,
            ignore: vec![],
        };
        let rec = Applied { previous: sample(), applied: applied.clone() };
        let json = serde_json::to_string(&rec).unwrap();
        let back: Applied = serde_json::from_str(&json).unwrap();
        assert_eq!(back.applied, applied);
    }

    #[test]
    fn restoring_is_refused_when_the_live_settings_are_not_the_ones_we_set() {
        let ours = ProxySettings { enabled: true, host: "127.0.0.1".into(), port: 2080, ignore: vec![] };
        let rec = Applied { previous: sample(), applied: ours.clone() };

        // Unchanged since we set it: restore.
        assert!(rec.should_restore(Some(&ours)));

        // The user pointed it somewhere else by hand. Their choice is newer
        // than our record, and putting our record back would silently undo it.
        let theirs = ProxySettings { enabled: true, host: "10.1.1.1".into(), port: 3128, ignore: vec![] };
        assert!(!rec.should_restore(Some(&theirs)));

        // Nothing readable: restore, because leaving ours applied is worse.
        assert!(rec.should_restore(None));
    }
}
