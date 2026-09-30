//! The pinned sing-box build.
//!
//! Lives in the shared crate rather than in the GUI because the privileged
//! half checks the binary it is about to execute against `binary_sha256`,
//! and a constant compiled into the engine is the only value an
//! unprivileged process cannot influence.

/// Upgrading means a new constant and new digests in an application
/// release — never a silent fetch of "latest", because a core that changes
/// under a generated config is a config that breaks in the field.
pub const SINGBOX_VERSION: &str = "1.13.21";

/// `(target, sha256 of the release archive, sha256 of the extracted binary)`
const PINS: &[(&str, &str, &str)] = &[
    (
        "linux-amd64",
        "24f9ef8e7234e13e71e74c3598a4164c5fe07b7b67ccc6e96cf68b54789f72cd",
        "ddf3a5c6f7594b18992c1b374e1694d12fe0e3e37accef7b97c6f987dd7b7479",
    ),
    (
        "windows-amd64",
        "a03291793d3a3c6e266447a58140657ac099ff278abf3b8ff678932356a62ced",
        "ccb2fad603c89efcbc14358ab40b2c7000a5bb4e3bffa170d5c355cda90757ba",
    ),
];

pub fn target() -> &'static str {
    if cfg!(windows) {
        "windows-amd64"
    } else {
        "linux-amd64"
    }
}

pub fn archive_sha256() -> Option<&'static str> {
    PINS.iter().find(|(t, _, _)| *t == target()).map(|(_, a, _)| *a)
}

pub fn binary_sha256() -> Option<&'static str> {
    PINS.iter().find(|(t, _, _)| *t == target()).map(|(_, _, b)| *b)
}

/// Where the core keeps its cache (downloaded rule sets). Writable by the
/// elevated core, outside every user's home, and the same constant on both
/// sides of the privilege boundary.
pub fn cache_file() -> std::path::PathBuf {
    #[cfg(target_os = "linux")]
    return "/var/cache/snifake/sing-box.db".into();
    #[cfg(target_os = "macos")]
    return "/Library/Caches/io.github.mohamadtsn.snifake/sing-box.db".into();
    #[cfg(windows)]
    return std::path::PathBuf::from(
        std::env::var_os("ProgramData").unwrap_or_else(|| "C:\\ProgramData".into()),
    )
    .join("snifake")
    .join("sing-box.db");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cache_lives_outside_any_users_home() {
        let p = cache_file();
        assert!(p.is_absolute());
        assert!(!p.to_string_lossy().contains("/home/"));
        assert!(p.file_name().is_some());
    }
}
