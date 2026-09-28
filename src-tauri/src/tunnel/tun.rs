//! TUN mode's unprivileged half: whether it can run on this machine, and
//! the marker that makes a crash survivable.
//!
//! The marker is the counterpart of `sysproxy/marker.rs`. It is written and
//! synced *before* a TUN start is sent, and deleted when the engine reports
//! the kill switch down (`blocking == false`, spec §12.7). If the GUI or
//! the engine dies with TUN up, the kill switch stays in force — by design —
//! and the marker is what lets the next launch tell the user why nothing
//! can reach the internet and offer to open it.

use crate::config::app_dir;
use snifake_engine::sysbin;
use std::fs;
use std::io::Write;
use std::path::Path;

const MARKER: &str = "tun.marker";

/// `None` when TUN can run here; otherwise the sentence the mode card shows.
pub fn support() -> Option<String> {
    support_with(cfg!(target_os = "linux"), cfg!(windows), |n| sysbin::find(n).is_some())
}

pub fn support_with(linux: bool, windows: bool, has: impl Fn(&str) -> bool) -> Option<String> {
    if windows {
        return Some("TUN on Windows arrives in the next release.".into());
    }
    if !linux {
        return Some("TUN is not available on macOS yet.".into());
    }
    if !has("nft") {
        return Some("Install the nftables package to use TUN.".into());
    }
    if !has("ip") {
        return Some("Install the iproute2 package to use TUN.".into());
    }
    None
}

pub fn write_marker() -> Result<(), String> {
    write_marker_in(&app_dir())
}
pub fn marker_present() -> bool {
    marker_present_in(&app_dir())
}
pub fn remove_marker() {
    remove_marker_in(&app_dir())
}

pub fn write_marker_in(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut f = fs::File::create(dir.join(MARKER)).map_err(|e| e.to_string())?;
    f.write_all(b"a TUN kill switch may be in force\n")
        .map_err(|e| e.to_string())?;
    // Synced, because the one case this file exists for is the process
    // dying right after writing it.
    f.sync_all().map_err(|e| e.to_string())
}

pub fn marker_present_in(dir: &Path) -> bool {
    dir.join(MARKER).is_file()
}

pub fn remove_marker_in(dir: &Path) {
    // Best effort: a marker that outlives its guard shows the banner once
    // more, and Restore network then clears it — harmless.
    let _ = fs::remove_file(dir.join(MARKER));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("snifake-tunmarker-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn linux_with_both_tools_supports_tun() {
        assert_eq!(support_with(true, false, |_| true), None);
    }

    #[test]
    fn a_missing_tool_is_named_in_the_users_words() {
        assert_eq!(
            support_with(true, false, |n| n != "nft").as_deref(),
            Some("Install the nftables package to use TUN.")
        );
        assert_eq!(
            support_with(true, false, |n| n != "ip").as_deref(),
            Some("Install the iproute2 package to use TUN.")
        );
    }

    #[test]
    fn windows_and_macos_say_why_not() {
        assert_eq!(
            support_with(false, true, |_| true).as_deref(),
            Some("TUN on Windows arrives in the next release.")
        );
        assert_eq!(
            support_with(false, false, |_| true).as_deref(),
            Some("TUN is not available on macOS yet.")
        );
    }

    #[test]
    fn the_marker_is_written_found_and_removed() {
        let dir = tempdir("cycle");
        assert!(!marker_present_in(&dir));
        write_marker_in(&dir).unwrap();
        assert!(marker_present_in(&dir));
        remove_marker_in(&dir);
        assert!(!marker_present_in(&dir));
    }

    #[test]
    fn removing_an_absent_marker_is_harmless() {
        remove_marker_in(&tempdir("absent"));
    }
}
