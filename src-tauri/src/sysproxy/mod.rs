//! Setting the operating system's proxy, and putting it back.
//!
//! **This runs in the GUI process, never in the engine.** `gsettings`,
//! `kioslaverc`, `networksetup` and `HKCU\...\Internet Settings` are all
//! per-user state. The engine is launched through `pkexec` and runs as
//! root; writing them from there sets *root's* proxy and leaves the user's
//! session untouched, so the program would report success while nothing
//! changed.

pub mod marker;

pub use marker::{Applied, Previous, ProxySettings};

/// Whether this machine can have its proxy set, and if not, why — in words
/// a card can show. A mode that silently does nothing is the failure this
/// module exists to end.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Support {
    Supported,
    Unsupported(String),
}
