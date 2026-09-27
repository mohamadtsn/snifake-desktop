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

## The V2Ray tunnel

An optional second stage that runs *in front of* the SNI forwarder. The SNI
stage stands up a local listener; the tunnel's outbound dials that listener,
so traffic goes application → tunnel → SNI stage → upstream. The tunnel
cannot start unless the SNI stage is running, and the interface says so
before you press the switch rather than after.

Configurations are `vless` or `trojan` over WebSocket with TLS, imported from
a share link, pasted as an Xray JSON outbound, or typed in. The address and
port are deliberately not stored: they come from whichever SNI profile is
active, because a stored copy of a read-only field eventually disagrees with
reality. Tunnels live in `tunnels.json` beside `profiles.json`.

**The core is not bundled.** The tunnel runs on
[sing-box](https://github.com/SagerNet/sing-box), which is GPL-3.0 while this
project is MIT, so it is fetched at first use into the app-data directory and
pinned to one exact version verified by checksum. If you cannot reach GitHub —
which is a fair description of why you might want this application — download
the release archive by any other route and use **Import a file**; it goes
through the same verification.

Three modes, and their guarantees are stated plainly because they differ:

| Mode | Captures | Leak guarantee |
| --- | --- | --- |
| Manual | only what you point at the local port | not applicable; nothing is captured that you did not aim |
| System proxy | applications that read the OS proxy setting | none — an application that ignores the setting goes direct |
| TUN | all system traffic | full: a firewall kill switch, failing closed |

Manual and System proxy are available today. System proxy sets the operating
system's proxy while the tunnel runs (GNOME and KDE on Linux, macOS, Windows)
and puts your previous setting back when it stops — including on the next
launch after a crash. TUN arrives in a later release; until then it is shown
greyed rather than hidden, so the list does not change shape under you at
upgrade time.

Routing is three lists — block, bypass, proxy — one rule per line, with typed
prefixes (`domain:`, `suffix:`, `keyword:`, `regex:`, `ip:`, `port:`,
`process:`, `path:`, `ruleset:`, `network:`) or bare domains, plus a raw JSON
escape hatch. Four generated guard rules cannot be overridden by any of them:
they are what stops the tunnel swallowing the SNI stage's own connection.

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

The release workflow signs the update bundles, which needs the private half of
the updater keypair. It lives in a GitHub **environment** rather than in
repository secrets, so it is reachable from one job on one kind of ref
instead of from every workflow on every branch.

Settings → Environments → **New environment**, named `release` (the name the
`build` job declares). Inside it:

| | |
| --- | --- |
| Secret `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/snifake.key` |
| Deployment branches and tags | *Selected* → ref type **Tag**, pattern `v*` |

There is deliberately no `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret. The key
has no password, and GitHub refuses to store an empty secret value — so do not
invent one (a single space is still a wrong password, and the build fails with
*incorrect updater private key password*). With the secret absent the
workflow's env var resolves to the empty string, which is what the key wants.

The matching public key is already in `src-tauri/tauri.conf.json`.

**Keep the private key.** The public half is baked into every copy users have
already installed, and `pubkey` holds exactly one key — there is no way to
rotate gracefully. Generate a new one and every existing install is stranded
on its current version, silently, forever. Back `~/.tauri/snifake.key` up
somewhere off this machine: GitHub secrets are write-only, so a copy that
only exists there cannot be read back out.

Note that the tag restriction also means `workflow_dispatch` on a branch gets
no secrets — a manual run builds unsigned bundles. That is intentional: only
a real tag produces a release anyone can update to.

## License

MIT
