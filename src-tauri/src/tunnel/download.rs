//! Fetching the pinned core over HTTP.
//!
//! The only file in this module that touches the network. It streams to a
//! temporary file and hands that file to `core::install_from_archive`, so
//! a download and a hand-placed file go through exactly the same
//! verification — there is no "trusted because we fetched it" path.

use super::core;
use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Progress {
    pub downloaded: u64,
    pub total: Option<u64>,
    /// `None` means indeterminate — the server sent no usable
    /// `Content-Length`, and a meter that guesses is worse than one that
    /// admits it does not know.
    pub percent: Option<u8>,
}

impl Progress {
    pub fn new(total: Option<u64>, downloaded: u64) -> Self {
        let percent = match total {
            Some(t) if t > 0 => Some(((downloaded * 100 / t).min(100)) as u8),
            _ => None,
        };
        Progress {
            downloaded,
            total: total.filter(|t| *t > 0),
            percent,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct CoreStatus {
    pub installed: bool,
    pub version: String,
    /// Shown in the failure message so a blocked user knows what to fetch
    /// by hand and import.
    pub url: String,
    /// The managed location. Read-only in the interface: the user does not
    /// choose where the core lives, because the engine verifies a path it was
    /// handed by an unprivileged process, and a wandering path is the one
    /// thing that check cannot cover.
    pub path: String,
    /// The installed binary's digest, absent when nothing is installed.
    /// Displayed beside the pin in Preferences so a mismatch is visible
    /// rather than merely reported.
    pub sha256: Option<String>,
}

pub fn status() -> CoreStatus {
    let path = core::core_binary();
    let installed = core::is_installed();
    // Hashing a ~30MB binary is not free, and this is called on launch.
    // `core_status` is therefore `async`, so Tauri runs it on the async
    // runtime rather than blocking the main thread through the first paint.
    let sha256 = if installed {
        std::fs::read(&path).ok().map(|bytes| core::sha256_hex(&bytes))
    } else {
        None
    };
    CoreStatus {
        installed,
        version: core::SINGBOX_VERSION.to_string(),
        url: core::asset_url(),
        path: path.to_string_lossy().into_owned(),
        sha256,
    }
}

pub async fn download_core(app: AppHandle) -> Result<(), String> {
    let url = core::asset_url();
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Could not reach the download server: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The download server answered {}. You can fetch {} by hand and import it.",
            response.status(),
            core::asset_name()
        ));
    }

    let total = response.content_length();
    let tmp = std::env::temp_dir().join(core::asset_name());
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The download was interrupted: {e}"))?;
        use std::io::Write;
        file.write_all(&chunk).map_err(|e| format!("write: {e}"))?;
        downloaded += chunk.len() as u64;
        let _ = app.emit("core-download-progress", Progress::new(total, downloaded));
    }
    drop(file);

    let result = core::install_from_archive(&tmp);
    let _ = std::fs::remove_file(&tmp);
    result.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_is_a_fraction_when_the_total_is_known() {
        assert_eq!(Progress::new(Some(200), 50).percent, Some(25));
        assert_eq!(Progress::new(Some(200), 200).percent, Some(100));
    }

    #[test]
    fn progress_is_indeterminate_when_the_server_sends_no_length() {
        // Exactly the reason UpdateMeter has an indeterminate mode: the
        // alternative is dividing by zero and showing a confident lie.
        assert_eq!(Progress::new(None, 50).percent, None);
        assert_eq!(Progress::new(Some(0), 50).percent, None);
    }

    #[test]
    fn progress_never_exceeds_one_hundred_even_if_the_server_lies() {
        assert_eq!(Progress::new(Some(100), 250).percent, Some(100));
    }

    #[test]
    fn progress_carries_the_raw_byte_counts_for_the_readout() {
        let p = Progress::new(Some(1024), 512);
        assert_eq!(p.downloaded, 512);
        assert_eq!(p.total, Some(1024));
    }
}

#[cfg(test)]
mod status_tests {
    use super::*;

    /// The Core preferences tab shows this path whether or not anything is
    /// installed: "the core will live here" is useful, and an empty field is
    /// not.
    #[test]
    fn status_reports_the_managed_path_even_when_nothing_is_installed() {
        let s = status();
        assert_eq!(s.path, core::core_binary().to_string_lossy());
        assert!(!s.path.is_empty());
        if !s.installed {
            assert!(s.sha256.is_none(), "an absent binary has no digest to show");
        }
    }

    /// The version is compiled in, so it is known even with no binary on
    /// disk. That is exactly why `installed` has to be reported separately:
    /// the frontend must not read a known version as a present core.
    #[test]
    fn the_pinned_version_is_reported_independently_of_installation() {
        let s = status();
        assert_eq!(s.version, core::SINGBOX_VERSION);
        assert!(!s.url.is_empty());
    }
}
