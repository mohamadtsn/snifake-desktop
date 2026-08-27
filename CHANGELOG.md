# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[SemVer](https://semver.org).

## [2.0.0] — 2026-08-27

The app now contains its own engine, and is a different package from 1.x.

### Added
- **Built-in engine.** `snifake-engine` is built from source in this
  repository and ships inside the installer. Windows additionally bundles the
  signed `WinDivert.dll` / `WinDivert64.sys` driver.
- **In-app updates.** Snifake checks GitHub Releases on launch and offers to
  download, install and restart. Nothing happens without your consent, and a
  failed check is silent.
- **Release pipeline.** Pushing a `v*` tag builds Windows, macOS (Apple
  silicon and Intel) and Linux bundles and uploads them to a draft release.
- Named connection profiles, switchable while the engine is running without a
  second password prompt.

### Changed
- **Breaking — new package identity.** `productName` is now `Snifake`
  (Linux package `snifake`) and the identifier is
  `io.github.mohamadtsn.snifake`, where 1.x used `sni-fake` and
  `com.snifake.desktop`. 2.x installs alongside 1.x rather than upgrading it;
  uninstall 1.x yourself.
- **Breaking — config location and format.** Settings moved from a single
  `config.json` to `profiles.json` under `snifake` in the platform app-data
  dir. 1.x settings are not migrated.
- Log traffic only crosses IPC while the Activity panel is open. Previously
  one Tauri event per stdout line pegged a core during a download, even
  minimized.
- Complete UI rewrite around the Console design language — see `DESIGN.md`.

### Removed
- **The external `sni-spoof-{platform}-{arch}` binary.** It is no longer
  downloaded, bundled, or looked for; the built-in engine replaces it
  entirely.
- The Python-era leftovers (`src/__pycache__`, root `config.json`).
