//! Setting the operating system's proxy, and putting it back.
//!
//! **This runs in the GUI process, never in the engine.** `gsettings`,
//! `kioslaverc`, `networksetup` and `HKCU\...\Internet Settings` are all
//! per-user state. The engine is launched through `pkexec` and runs as
//! root; writing them from there sets *root's* proxy and leaves the user's
//! session untouched, so the program would report success while nothing
//! changed.

pub mod marker;

#[cfg(target_os = "linux")]
mod linux;
// `macos` and `windows` are declared unconditionally, not behind their own
// `cfg`. Every line in both is portable Rust - `std::process::Command` and,
// on Windows, a `cfg`-split inner module with a no-op stub - so declaring
// them here means their pure builders and their tests compile and *run* on
// this project's Linux CI. Behind a `cfg` they would be checked only for a
// target nobody here can execute, which for macOS is no check at all: the
// `check` service type-checks only the engine crate for Darwin.
mod macos;
mod windows;

pub use marker::ProxySettings;

/// Whether this machine can have its proxy set, and if not, why — in words
/// a card can show. A mode that silently does nothing is the failure this
/// module exists to end.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Support {
    Supported,
    Unsupported(String),
}

#[cfg(target_os = "linux")]
use linux as plat;
#[cfg(target_os = "macos")]
use macos as plat;
#[cfg(windows)]
use windows as plat;

pub fn support() -> Support {
    plat::support()
}

pub fn read_current() -> Option<ProxySettings> {
    plat::read_current()
}

/// Records what was there, then sets ours. The record is written *first*:
/// a crash between the write and the apply costs one redundant restore on
/// the next launch, while a crash the other way around costs the user
/// their internet with no way for us to know.
pub fn apply(host: &str, port: u16) -> Result<(), String> {
    if let Support::Unsupported(why) = support() {
        return Err(why);
    }
    // Idempotent: a marker that already exists holds the *user's* settings,
    // and a second `apply` would otherwise read back our own proxy and
    // record that as the thing to restore.
    let previous = marker::previous_to_record(marker::read().as_ref(), plat::read_previous());
    let applied = ProxySettings {
        enabled: true,
        host: host.to_string(),
        port,
        ignore: Vec::new(),
    };
    marker::write(&marker::Applied { previous, applied })?;
    plat::apply(host, port)
}

/// Puts the user's settings back, unless they have changed them by hand
/// since we applied ours - in which case theirs is the newer choice and
/// restoring would silently undo it. Either way the marker goes.
pub fn clear() -> Result<(), String> {
    let Some(record) = marker::read() else { return Ok(()) };
    let live = read_current();
    let result = if record.should_restore(live.as_ref()) {
        plat::restore(&record.previous)
    } else {
        Ok(())
    };
    // Only on success. The marker is the *only* record of what the user had
    // and the only thing that makes the next launch try again; throwing it
    // away after a failed restore turns a transient error into a permanent
    // one.
    if result.is_ok() {
        marker::remove();
    }
    result
}

/// Called once at startup. A marker here means the last run did not get to
/// clear - a crash, a kill, a power cut - and the user is still pointed at
/// a proxy that is not listening.
pub fn recover_after_crash() -> Option<Result<(), String>> {
    marker::read()?;
    Some(clear())
}
