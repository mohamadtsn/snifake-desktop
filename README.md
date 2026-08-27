# Snifake

Cross-platform desktop app (Tauri + React) for a TLS SNI-spoofing forwarder.

Unlike earlier versions, Snifake 2.0 **contains its own engine**. There is no
external binary to download and drop next to the app: `snifake-engine` is built
from source in this repository (`src-tauri/engine`) and ships inside the
installer.

## Features

- One-switch start/stop, with a live condition readout and uptime clock
- Named connection profiles you can switch between while running
- System tray with status badge
- Activity log, streamed only while it is open
- Elevated engine launch — one password prompt per machine on Linux, one UAC
  prompt per session on Windows
- In-app updates from GitHub Releases

## Install

Grab the installer for your platform from
[Releases](https://github.com/mohamadtsn/snifake-desktop/releases):

| Platform | File |
| --- | --- |
| Windows 10/11 (x64) | `Snifake_<version>_x64-setup.exe` or the `.msi` |
| macOS (Apple silicon) | `Snifake_<version>_aarch64.dmg` |
| macOS (Intel) | `Snifake_<version>_x64.dmg` |
| Linux | `.AppImage` (portable), `.deb` or `.rpm` |

Snifake is not code-signed. Windows SmartScreen needs **More info → Run
anyway**; macOS needs a right-click → **Open** on the first launch.

Once installed, the app checks for updates on launch and offers to install
them in place. Nothing is downloaded until you accept.

### Coexisting with older versions

Snifake 2.x installs as `snifake` under the identifier
`io.github.mohamadtsn.snifake`, where 1.x installed as `sni-fake` under
`com.snifake.desktop`. They are separate packages: 2.x will not upgrade or
remove a 1.x install, and the two do not share profiles. Uninstall 1.x
yourself once you are happy with 2.x — and do not run both at once, since
they would fight over the same listen port.

## Configuration

A profile carries `LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`
and `FAKE_SNI`. Profiles live in `profiles.json` in the platform app-data dir
(`~/.config/snifake` on Linux) and are passed to the engine on start.

## Development

Frontend tooling runs on the host (Node.js 18+). The Rust/Tauri side runs
either on the host (with Rust installed) or entirely in Docker.

```bash
npm install
npm run tauri dev       # needs Rust on the host
npm run tauri build     # -> src-tauri/target/release/bundle/
npm test
```

### Docker

The image carries the whole Rust/Tauri toolchain — Linux bundles, Windows
cross-builds, macOS type-checks and the test suite. Run `npm run build` on the
host first.

```bash
docker compose run --rm doctor          # verify the toolchain
docker compose run --rm test            # cargo test --workspace
docker compose run --rm check           # type-check linux + windows + macos
docker compose run --rm build-linux     # -> target/release/bundle/{deb,rpm,appimage}
docker compose run --rm build-windows   # -> target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

macOS is check-only here: `cargo check` never links, so the macOS code is
type-checked, but a real `.app`/`.dmg` needs a Mac (which CI provides).

## Releasing

Versions follow [SemVer](https://semver.org). One version number lives in
`package.json`; `tauri.conf.json` reads it from there, and
`scripts/set-version.mjs` writes it into both Cargo manifests so they cannot
drift.

```bash
npm run version:set 2.1.0
git commit -am "chore: 🔖 v2.1.0"
git tag v2.1.0
git push --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`, which builds all four
bundles in parallel and uploads them to a **draft** release together with the
`latest.json` the in-app updater reads. Review the draft, then publish it —
publishing is what makes the update visible to everyone already running the
app.

Bump **patch** for fixes, **minor** for features that keep profiles working,
**major** for anything that changes the profile format or the install identity.

### One-time repository setup

The release workflow needs two secrets (Settings → Secrets and variables →
Actions):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/snifake.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key's password (empty if none) |

The matching public key is already in `src-tauri/tauri.conf.json`. **Keep the
private key.** Losing it means no existing install can ever be updated
in-app again — they would all have to reinstall by hand.

## License

MIT
