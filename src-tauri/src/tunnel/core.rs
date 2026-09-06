//! Acquiring the sing-box core.
//!
//! The version is pinned in code and the archive's SHA-256 is pinned
//! alongside it, so a download and a hand-placed file are verified by
//! exactly the same check. The core is never bundled with the application:
//! sing-box is GPL-3.0 and this project is MIT, and shipping it as a
//! separately-acquired executable keeps that boundary clean.
//!
//! Installation is never in place. Everything lands in a staging directory
//! and is renamed over the target only once it has been verified, so a
//! failed install cannot leave a half-written core behind.

use crate::config::cores_dir;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

// The pins themselves live in the shared engine crate (see Step 3a), not
// here, because the *privileged* half must be able to check the binary it
// is about to execute against a constant an unprivileged process cannot
// influence.
pub use snifake_engine::corepin::{
    archive_sha256 as expected_sha256, binary_sha256, target, SINGBOX_VERSION,
};

fn archive_extension() -> &'static str {
    if cfg!(windows) {
        "zip"
    } else {
        "tar.gz"
    }
}

pub fn asset_name() -> String {
    format!(
        "sing-box-{SINGBOX_VERSION}-{}.{}",
        target(),
        archive_extension()
    )
}

pub fn asset_url() -> String {
    format!(
        "https://github.com/SagerNet/sing-box/releases/download/v{SINGBOX_VERSION}/{}",
        asset_name()
    )
}

pub fn core_dir() -> PathBuf {
    cores_dir().join(format!("sing-box-{SINGBOX_VERSION}"))
}

pub fn core_binary() -> PathBuf {
    core_dir().join(if cfg!(windows) { "sing-box.exe" } else { "sing-box" })
}

pub fn is_installed() -> bool {
    core_binary().exists()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Unpacks `archive` into `dest` and returns the path of the sing-box
/// binary inside it. Release archives nest the binary in a versioned
/// directory, so the search walks the tree rather than assuming a layout.
pub fn extract_and_locate(archive: &Path, dest: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    unpack(archive, dest)?;

    let wanted = if cfg!(windows) { "sing-box.exe" } else { "sing-box" };
    let found = find(dest, wanted)
        .ok_or_else(|| format!("This archive contains no {wanted}. Is it a sing-box release?"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&found)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&found, perms).map_err(|e| e.to_string())?;
    }

    Ok(found)
}

#[cfg(unix)]
fn unpack(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("open archive: {e}"))?;
    let gz = flate2::read::GzDecoder::new(file);
    tar::Archive::new(gz)
        .unpack(dest)
        .map_err(|e| format!("This file is not a readable .tar.gz archive: {e}"))
}

#[cfg(windows)]
fn unpack(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("open archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("This file is not a readable .zip archive: {e}"))?;
    zip.extract(dest)
        .map_err(|e| format!("extract archive: {e}"))
}

fn find(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
        } else if path.file_name().map(|f| f == name).unwrap_or(false) {
            return Some(path);
        }
    }
    dirs.into_iter().find_map(|d| find(&d, name))
}

/// Verify, stage, probe, then swap. The probe is what makes an archive
/// that hashes correctly but is not the core we expect fail here rather
/// than at the user's first Start.
pub fn install_from_archive(archive: &Path) -> Result<PathBuf, String> {
    let bytes = std::fs::read(archive).map_err(|e| format!("read {}: {e}", archive.display()))?;
    let expected = expected_sha256().ok_or_else(|| {
        format!("No pinned checksum for this platform ({}).", target())
    })?;
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "Checksum mismatch. This file is not sing-box {SINGBOX_VERSION} for {}.",
            target()
        ));
    }

    let staging = cores_dir().join(format!(".staging-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    let binary = extract_and_locate(archive, &staging).inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&staging);
    })?;

    if let Err(e) = probe_version(&binary) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }

    // Swap: the binary may sit inside a nested directory, so the parent of
    // the binary — not the staging root — becomes the versioned core dir.
    //
    // That parent holds three files, not one: `sing-box`, `libcronet.*` and
    // `LICENSE` (Task 1 findings). Moving the whole directory is deliberate.
    // `libcronet` backs `with_naive_outbound`, which this project's closed
    // protocol set never reaches, and the spike confirmed the binary runs
    // with no `libcronet` beside it — but `LICENSE` must stay next to a
    // GPL-3.0 binary, and stripping one member while keeping the other buys
    // 7 MB of disk at the cost of a bespoke rule. What the *binary* is, is
    // guaranteed separately: `engine/src/corepin.rs` verifies its own digest
    // before exec, so nothing in this directory is trusted by position.
    let source = binary.parent().unwrap().to_path_buf();
    let target_dir = core_dir();
    let _ = std::fs::remove_dir_all(&target_dir);
    std::fs::create_dir_all(target_dir.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::rename(&source, &target_dir)
        .map_err(|e| format!("install into {}: {e}", target_dir.display()))?;
    let _ = std::fs::remove_dir_all(&staging);

    Ok(core_binary())
}

fn probe_version(binary: &Path) -> Result<(), String> {
    let out = std::process::Command::new(binary)
        .arg("version")
        .output()
        .map_err(|e| format!("run {}: {e}", binary.display()))?;
    let text = String::from_utf8_lossy(&out.stdout);
    if !text.contains(SINGBOX_VERSION) {
        return Err(format!(
            "This core does not report version {SINGBOX_VERSION}."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_the_known_empty_string_digest() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn the_asset_name_and_url_carry_the_pinned_version_and_the_target() {
        let name = asset_name();
        assert!(name.contains(SINGBOX_VERSION), "{name}");
        assert!(name.contains(target()), "{name}");
        assert!(asset_url().ends_with(&name), "{}", asset_url());
        assert!(asset_url().contains(SINGBOX_VERSION));
    }

    #[test]
    fn the_install_directory_is_versioned_so_two_versions_never_collide() {
        assert!(core_dir().ends_with(format!("sing-box-{SINGBOX_VERSION}")));
        assert!(core_dir().starts_with(crate::config::cores_dir()));
    }

    #[test]
    fn the_binary_name_matches_the_platform() {
        let name = core_binary().file_name().unwrap().to_string_lossy().to_string();
        if cfg!(windows) {
            assert_eq!(name, "sing-box.exe");
        } else {
            assert_eq!(name, "sing-box");
        }
    }

    #[test]
    fn both_pinned_hashes_exist_for_every_target_we_build_for() {
        assert!(expected_sha256().is_some(), "no archive pin for {}", target());
        assert!(binary_sha256().is_some(), "no binary pin for {}", target());
        assert_eq!(expected_sha256().unwrap().len(), 64);
        assert_eq!(binary_sha256().unwrap().len(), 64);
        assert_ne!(
            expected_sha256().unwrap(),
            binary_sha256().unwrap(),
            "the archive and the binary inside it cannot hash the same"
        );
    }

    #[cfg(unix)]
    #[test]
    fn extraction_finds_the_binary_however_deeply_the_archive_nests_it() {
        let tmp = tempdir();
        let archive = tmp.join("fake.tar.gz");
        write_tar_gz(&archive, "sing-box-1.2.3-linux-amd64/sing-box", b"#!/bin/sh\nexit 0\n");

        let dest = tmp.join("out");
        let found = extract_and_locate(&archive, &dest).unwrap();
        assert_eq!(found.file_name().unwrap(), "sing-box");
        assert!(found.exists());
    }

    #[cfg(unix)]
    #[test]
    fn extraction_marks_the_binary_executable() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempdir();
        let archive = tmp.join("fake.tar.gz");
        write_tar_gz(&archive, "nested/sing-box", b"x");
        let found = extract_and_locate(&archive, &tmp.join("out")).unwrap();
        let mode = std::fs::metadata(&found).unwrap().permissions().mode();
        assert_eq!(mode & 0o111, 0o111, "mode was {mode:o}");
    }

    #[cfg(unix)]
    #[test]
    fn an_archive_without_the_binary_is_rejected_by_name() {
        let tmp = tempdir();
        let archive = tmp.join("wrong.tar.gz");
        write_tar_gz(&archive, "readme.txt", b"nothing here");
        let err = extract_and_locate(&archive, &tmp.join("out")).unwrap_err();
        assert!(err.contains("sing-box"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn a_file_that_is_not_an_archive_is_rejected_before_anything_is_written() {
        let tmp = tempdir();
        let bogus = tmp.join("not-an-archive.tar.gz");
        std::fs::write(&bogus, b"this is just text").unwrap();
        assert!(extract_and_locate(&bogus, &tmp.join("out")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn install_refuses_an_archive_whose_hash_does_not_match_the_pin() {
        let tmp = tempdir();
        let archive = tmp.join("tampered.tar.gz");
        write_tar_gz(&archive, "sing-box", b"not the real core");
        let err = install_from_archive(&archive).unwrap_err();
        assert!(err.to_lowercase().contains("checksum"), "{err}");
        // and nothing was installed
        assert!(!core_dir().exists() || core_dir().read_dir().unwrap().next().is_none());
    }

    // ---- helpers -------------------------------------------------------

    fn tempdir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "snifake-core-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    fn write_tar_gz(path: &std::path::Path, entry: &str, body: &[u8]) {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        let file = std::fs::File::create(path).unwrap();
        let enc = GzEncoder::new(file, Compression::fast());
        let mut builder = tar::Builder::new(enc);
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append_data(&mut header, entry, body).unwrap();
        builder.into_inner().unwrap().finish().unwrap();
    }

    /// The end-to-end check the plan's Task 6 Step 8 asks for, kept as a
    /// runnable test rather than a shell recipe nobody re-runs. Ignored by
    /// default because it needs a 24 MB archive that is not in the repo:
    ///
    /// ```text
    /// SINGBOX_ARCHIVE=/path/to/sing-box-1.13.21-linux-amd64.tar.gz \
    ///   cargo test --lib -- --ignored install_a_real_archive
    /// ```
    ///
    /// It is the only thing that proves the two pinned digests belong to the
    /// same file: a wrong archive pin fails at the checksum, and a wrong
    /// binary pin fails later, in the engine, at a point no unit test reaches.
    #[test]
    #[ignore]
    fn install_a_real_archive_end_to_end() {
        let Ok(archive) = std::env::var("SINGBOX_ARCHIVE") else {
            panic!("set SINGBOX_ARCHIVE to a pinned sing-box release archive");
        };
        let installed = install_from_archive(Path::new(&archive)).expect("install");
        assert!(installed.exists(), "{}", installed.display());

        // The digest the *engine* will check before it execs this file.
        let bytes = std::fs::read(&installed).unwrap();
        assert_eq!(
            sha256_hex(&bytes),
            binary_sha256().unwrap(),
            "the installed binary does not match the pinned binary digest"
        );

        // And it really is the core, not merely a file of the right size.
        let out = std::process::Command::new(&installed)
            .arg("version")
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains(SINGBOX_VERSION), "{text}");
        assert!(
            text.contains("with_clash_api"),
            "the Clash API is what Plan 2's statistics read: {text}"
        );
    }

}
