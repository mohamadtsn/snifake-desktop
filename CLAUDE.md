# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cross-platform Tauri (Rust backend) + React (TypeScript) desktop app for a TLS SNI-spoofing forwarder. The engine (`snifake-engine`) is **built from source in this repo** (`src-tauri/engine`) and ships inside the bundle — there is no external binary. The GUI configures it, launches it with elevated privileges, monitors it and stops it.

Product identity, all of which must move together: `productName` **Snifake**, `mainBinaryName` **snifake**, identifier **io.github.mohamadtsn.snifake**, repo **mohamadtsn/snifake-desktop**. Note that the Linux deb package name is `heck::to_kebab_case(productName)`, which is why the display name is `Snifake` and not `SNIFake` — the latter kebabs back into `sni-fake`, the 1.x package name we deliberately moved off. Resources install to `/usr/lib/<productName>/`, so the polkit policy's `exec.path` is `/usr/lib/Snifake/…` and changing `productName` breaks it. Verify with `dpkg -c` after any rename.

## Commands

Frontend tooling runs on the host (Node.js required); the Rust/Tauri side can run either on the host (with Rust installed) or via Docker.

```bash
npm install                        # install frontend deps
npm run tauri dev                  # dev loop (needs Rust on host)
npm run tauri build                # production build (needs Rust on host)
```

Docker carries the whole Rust/Tauri toolchain — Linux bundles, Windows
cross-builds, macOS type-checks and the test suite. Frontend tooling stays on
the host, so run `npm run build` (or `npm run dev`) there first.

```bash
docker compose run --rm doctor          # verify the toolchain (cargo, tauri, xwin, nsis, targets)
# All services share one pinned image, `snifake-toolchain`. Do not let them
# fall back to compose's default per-service names: an unrelated leftover
# image called e.g. `snifake-test` gets reused instead of built, and the
# container then reports `sh: 1: cargo: not found`.
docker compose run --rm test            # cargo test --workspace
docker compose run --rm check           # type-check linux + windows + macos
npm run build && docker compose run --rm build-linux    # -> target/release/bundle/{deb,rpm,appimage}
npm run build && docker compose run --rm build-windows  # -> target/x86_64-pc-windows-msvc/release/bundle/nsis/
npm run dev                             # in one terminal (leave running)
docker compose run --rm dev             # in another, X11 passthrough for cargo tauri dev
```

Windows cross-builds go through `cargo-xwin` and bundle **NSIS only** — the
MSI/WiX bundler needs a real Windows host. macOS is **check-only**: `cargo
check` never links, so the macOS code is type-checked here, but a real
`.app`/`.dmg` needs `cargo tauri build` on a Mac.

`bundle.resources` is a fixed path map, but cargo puts a cross-compiled binary
in `target/<triple>/release/` and a native one in `target/release/`. So
`src-tauri/scripts/stage-resources.sh <triple?>` collects the engine (and, for
a Windows target, the WinDivert binaries) into `src-tauri/resources/`, and the
resource map only ever points there. Every build path runs it: the host build
through `beforeBuildCommand`, the Docker builds explicitly.

## Architecture

- `DESIGN.md` — the design system of record: tokens, type scale, motion, component inventory and the decision log. **Read it before changing anything visual**, and update it in the same commit when a design decision changes.
- `src-tauri/src/lib.rs` — Tauri app entry (`run()`), `AppState` (`engine: Mutex<EngineHost>` + `store: Mutex<Store>` + the shared `Arc<LogBuffer>`), and the invokable commands: `list_profiles`, `save_profile`, `delete_profile`, `set_active_profile`, `start_proxy`, `stop_proxy`, `set_log_streaming`, `set_verbose`, `get_log_buffer`, `shutdown_engine`, plus the tunnel's twelve: `core_status`, `download_core`, `import_core`, `list_tunnels`, `save_tunnel`, `delete_tunnel`, `set_active_tunnel`, `save_routing`, `import_tunnel`, `export_tunnel_uri`, `start_tunnel`, `stop_tunnel`. Registers `tauri-plugin-single-instance` **first, before every other plugin** (a second launch unminimizes/shows/focuses the existing `main` window instead of spawning a duplicate — and a duplicate would spawn a second *elevated* proxy on the same port). Wires the system tray, and redirects the window's native close button and tray "Exit"/"Start"/"Stop" clicks into `frontend-*-requested` events so the confirm/validate logic lives once, in the frontend.
- `src-tauri/src/config.rs` — filesystem locations only: `app_dir()` (`snifake` under the platform app-data dir, where `profiles.json` lives), `engine_path()` (resolves `snifake-engine[.exe]` from the bundle's resource dir, falling back to the GUI's own directory for `cargo tauri dev`), and `install_sudoers_script_path()`. Everything config-shaped lives in `profiles.rs`.
- `src-tauri/src/auth.rs` — `elevated_argv()`: `pkexec` (fallback `sudo -n` when `has_passwordless_sudo()` says a NOPASSWD line already covers the engine) on Linux, `osascript ... with administrator privileges` on macOS, no-op on Windows (UAC handled via the bundle manifest at packaging time). `try_install_sudoers` runs the bundled one-time `install-sudoers.sh`.
- `src-tauri/src/logbuf.rs` — `LogBuffer`: a 500-line `VecDeque` ring for backfill, a `pending` batch, and an `AtomicBool` streaming gate, plus `spawn_flusher()` which emits a `log-batch` (`Vec<String>`) event every 200 ms **only while the frontend has Activity open**. Sole owner of log fan-out. With Activity closed, the whole cost of a proxy log line is one `push_back` — no IPC, no React render. (Before this, one Tauri event per stdout line pegged the CPU during downloads, even minimized: WebKitGTK keeps running JS and layout for hidden windows.)
- `src-tauri/src/engine_host.rs` — `EngineHost`: owns the privileged engine process for the whole app session. The GUI listens on a local endpoint, launches the engine **elevated once**, and then speaks NDJSON to it, so the user sees at most one password/UAC prompt per session and switching profiles costs no prompt at all. Emits the `state-changed` Tauri event; every engine message goes into the shared `LogBuffer`, never straight over IPC. `EngineProcess` hides the platform split (an ordinary `Child` on Unix, a bare process handle on Windows, because `ShellExecuteExW`+`runas` is the only way a non-elevated parent can start an elevated child and it hands back a handle, not a `Child`). `apply_event` is pure enough to test without a process.
- `src-tauri/src/profiles.rs` — the profile `Store` (`profiles` + `active_id`) as one JSON document in `app_dir()`, with `upsert`/`delete`/`active`/`set_active` and a one-way migration from the pre-profiles `config.json`. Refuses to delete the last profile; deleting the active one moves `active_id` to the first survivor.
- `src-tauri/src/tunnel/` — the tunnel's **unprivileged** half, and all of it is config-shaped: `model` (the `tunnels.json` store), `rules` (the prefixed line grammar for the three routing lists), `import` (share-link and Xray-JSON ingest, plus URI export), `generate` (the entire sing-box config, including the non-overridable loop guards, with golden snapshots under `src/tunnel/testdata/` that are checked against the real core), `core` (pinned version, checksum, extract, install), `download` (the only network I/O in the crate). The engine receives finished JSON and never interprets it, which is what keeps generation unit-testable outside the privileged process.
- `src-tauri/src/elevate_windows.rs` — `spawn_elevated()` via `ShellExecuteExW` with the `runas` verb.
- `src-tauri/src/tray.rs` — system tray menu and the runtime-composited status-badge tray icon (colored dot over the app icon, mirroring the state).

**The engine crate (`src-tauri/engine/`)** — the privileged half, a separate binary and a
library the GUI also links (it shares `proto` and `transport`).

- `engine/src/main.rs` — `snifake-engine <endpoint> <token>`. Connects *back* to the socket the GUI is listening on, sends the token as its first line, then speaks NDJSON. Stays alive for the whole GUI session. A `Running` bundles the forwarder and the sniff thread, and stopping **joins** the thread — dropping the handle would leak a thread and a raw packet socket on every start/stop cycle.
- `engine/src/proto.rs` — the wire types: `Profile`, `Command` (`start`/`stop`/`verbose`/`shutdown`), `Event` (`ready`/`state`/`log`/`error`). One JSON object per line, both directions.
- `engine/src/transport.rs` — a unix domain socket on Unix, a named pipe on Windows. Not stdio, because `ShellExecuteEx` cannot redirect standard handles and `osascript ... with administrator privileges` buffers a child's output until it exits (which would mean no live logs at all).
- `engine/src/corepin.rs` — the pinned sing-box version and **two** digests per target. In the shared crate rather than the GUI because the privileged half checks the binary against `binary_sha256` before executing it: the path it is handed comes from an unprivileged process and points into a user-writable directory, so a constant compiled into the engine is the only value it can trust. The GUI checks the *archive* digest before unpacking; nothing checks the binary but the engine.
- `engine/src/tunnel.rs` — `TunnelSupervisor`: verify the core, write the config at 0600 (it carries a credential and this process is root), spawn sing-box in its own process group, probe readiness on an address it was told explicitly, and stop by group with SIGTERM then SIGKILL. Readiness is never matched against a log string — a core upgrade that rewords its startup message must not silently break detection.
- `engine/src/validate.rs` — the trust boundary. This process runs as root, so the GUI's validation is a convenience and **this** one is the guarantee.
- `engine/src/forward.rs` — `Forwarder`: binds the listener synchronously (a port clash is reported here, not swallowed on a background thread), dials upstream from the discovered egress address, waits for the sniffer's confirmation, then relays. `discover_egress()` resolves the route with a `connect()` on a UDP socket, which sends nothing. No fallback if the confirmation never arrives — relaying anyway would expose the real SNI to DPI.
- `engine/src/sniffer.rs` — watches every TCP packet to the upstream, injects the fake ClientHello the instant our own third-handshake ACK goes out, and releases the forwarder once the server proves it ignored the fake. `classify` is deliberately pure, so the interesting logic is testable without a raw socket or root.
- `engine/src/hello.rs` — the 517-byte fake ClientHello. The SNI's length change is absorbed in the trailing padding extension so the frame length never varies. DPI must be able to parse it; the server never sees it, because it arrives before the receive window.
- `engine/src/netpkt.rs` — IPv4/TCP parsing, RFC 1071 checksums, and the out-of-window fake packet. Works at the **IP layer onward**, never on Ethernet frames.
- `engine/src/capture/` — packet capture and injection abstracted at the IP layer: `linux.rs` (AF_PACKET), `macos.rs`/`bpf.rs` (BPF), `windivert/` (WinDivert). Linux and macOS deliver Ethernet frames and so strip/replace the 14-byte header; Windows never sees one.
- `src/types.ts` — shared `ProxyState`/`Profile`/`Store` types, the `STATE_TEXT`/`STATE_ACTION`/`STATE_COLOR` display maps (instrument vocabulary: OFFLINE/STARTING/ACTIVE/FAULT) and `formatUptime`.
- `src/components/TitleBar.tsx` — the bezel for the frameless window (`data-tauri-drag-region`), carrying the product name, a condition readout and two hand-drawn window glyphs — minimise and a `×` that **hides to the tray** rather than quitting. Deliberately rendered **outside** `App`'s `.sheet-host`, so quit/minimise stay live while the profile drawer is open (the drawer and its scrim start 36px down to match).
- `src/lib/undo.ts` — a per-field undo/redo stack, plus `undoIntent()` for reading the shortcut off a keydown. Exists because Ctrl+Z works through a controlled React input in Chrome but not under WebKitGTK; the field owning its history behaves the same everywhere and adds redo. Bursts within 500ms collapse into one step. All refs, so it costs no render and is testable without a DOM (`undo.test.ts`).
- `src/lib/gesture.ts` — pure drag physics for the drawer: `velocityFrom`, `project` (Apple's exponential-decay form, not `v²/2a`), `rubberband`, `shouldDismiss`. No DOM access, so the numbers that decide how the drawer *feels* are the one part of the frontend that is actually tested (`gesture.test.ts`, `npm test`).
- `src/lib/rules.ts` — the same rule grammar as `tunnel/rules.rs`, duplicated on purpose: the editor has to underline a bad line per keystroke, and a round trip to Rust for that would be slow and, under WebKitGTK, jittery. Rust stays the authority and re-validates on save. `src/lib/rules.fixtures.json` is the one table both are tested against, so the duplication cannot drift in silence.
- `src/lib/tunnelMachine.ts` — the two-stage dependency as data: which transitions are legal, and the sentence explaining a refusal. One source, so the disabled switch and its explanation cannot disagree.
- `src/lib/motion.ts` — motion values a `motion/react` component needs as JavaScript. CSS-driven motion stays in `theme.css`; this exists so two drawers cannot hold two copies of one spring.
- `src/components/StatusPanel.tsx` — the instrument face: a 20-segment signal bar, the condition word and the uptime clock. The bar is driven entirely from CSS off `data-state`, so a running console costs zero React renders for the animation. It encodes **state only** — there is no throughput meter, because the engine reports no bytes and a bar moving without data behind it is undetectable as a lie.
- `src/components/PowerSwitch.tsx` — the only control that starts or stops the engine. A latching rocker: press drops it 1px and swaps the outer shadow for an inner one; `running` sets `data-lit`, which lights it solid phosphor green with dark ink. Deliberately **not** keyed on `state`, so keyboard focus survives a state change.
- `src/components/RouteRows.tsx` — read-only Listen/Upstream/SNI as a three-column grid, so ports line up vertically. A sibling of the switch, never inside its hit area.
- `src/components/ChannelSelect.tsx` — one channel row: the selector (Base UI `Select`) plus the way into its drawer. Generic over `{id, name}` with a `subtitle` function, so the profile row and the tunnel row are the same component rather than two that drift. Replaced a rail of chips because switching profiles while running restarts the engine, and a chip was one stray click from doing that; a selector costs two deliberate actions and keeps one fixed row whatever the profile count.
- `src/components/Sheet.tsx` — drawer primitive. Base UI `Dialog` supplies focus trapping, `Esc` and scroll lock; the visual layer and the drag are hand-rolled on Pointer Events writing `transform` straight onto the node, because a drag must be 1:1. Portals into `.shell` rather than `<body>` so it stays inside the bezel. Grabbing a closing drawer resumes from its presentation transform.
- `src/components/ProfileSheet.tsx` — drawer contents, list ⇄ editor as two horizontally pushed views that both stay mounted so the push can animate. Rows enter/leave/reorder via `AnimatePresence` + `layout`. Purely a management surface now that switching lives on the selector.
- `src/components/ProfileEditor.tsx` — name plus the 5 connection fields, inline per-field validation. Host+port pair on one line each so the control mirrors the shape of the value. Inputs are `dir="ltr"` and left-aligned (hostnames/IPs/ports, never prose) and every field keeps a visible label. The error line reserves its height so a message shifts nothing.
- `src/components/Disclosure.tsx` — Base UI `Collapsible` wrapper styled as an engraved section header made pressable. Its panel **unmounts when closed**, which is what keeps the log list out of the DOM.
- `src/components/ActivitySection.tsx` — owns all log state; drives `set_log_streaming`, backfills via `get_log_buffer`, renders `log-batch` payloads, and polls the buffer length once a second while closed to drive its badge. Lines do not wrap — they scroll sideways, because wrapping splits an IPv4 address mid-octet.
- `src/components/AboutDialog.tsx` — About, as a Base UI `Dialog` opened from the bezel's `ⓘ`: identity (wordmark + version), package/source/license, and a **Check for updates** button. It calls `checkUpdate()` rather than `findUpdate()` because a check somebody pressed has to distinguish "you are current" from "the server was unreachable", where the silent one on launch must not. A `Dialog`, not the `AlertDialog` the rest of the app uses — About decides nothing, so Esc/backdrop/Close must dismiss it without reading as "cancel". Replaced an inline disclosure at the foot of the scrolling column, which was both a non-standard place to look for version metadata and a claim on height the switch needed.
- `src/App.tsx` — assembles all components, calls Tauri commands via `invoke()`, listens for `state-changed`/`frontend-*-requested` events, owns `sheetOpen` and the exit/delete/update/error `AlertDialog`s. Tracks `runningId` separately from `store.active_id` (switching while running restarts the engine into the new profile with no prompt) and `since` for the uptime clock, started when the engine reports `running` rather than when we asked it to start. Holds no log state. Quit is reachable only from the tray’s Exit, which raises the window before the confirm dialog opens.
- `src/lib/updater.ts` — the two updater calls, wrapped. `findUpdate()` swallows every error and returns null: this app's users are plausibly behind something that blocks github.com, and an update is a convenience that must never surface as a failure. `App.tsx` checks once on mount and renders the offer in the same `AlertDialog` everything else uses. `applyUpdate()` takes a progress callback and sums the plugin's per-chunk sizes itself (the plugin reports chunk lengths, not a running total); `contentLength` can be absent, which is why the meter has an indeterminate mode instead of dividing by zero.
- `src/theme.css` — Tailwind v4 `@theme` tokens for the **Console** language: one cool-graphite surface family, three rule steps (`line`/`edge`/`beam`), four text steps, amber as the sole accent, tight radii (3/4/6px), the `--track-*` engraving table, and the `.engrave`/`.signal`/`.switch`/`.selector`/`.menu`/`.sheet-*`/`.log-scroll` primitives. **`DESIGN.md` is the source of truth for every value here.** Two signal colours, not one: phosphor green is `active`, amber is `starting` and the unread-log badge (amber on real equipment means *caution*, so an all-amber healthy panel reads as a fault that isn't there) — see `DESIGN.md` §1.1 and the 2026-08-27 decision-log entry. Note the file's own header comment still says "there is no green" and predates that reversal. Only `transform`/`opacity`/`color`/`background-color`/`border-color` animate (the one exception is `.disclosure-panel`'s height, which is `contain: paint`), and every animation has a `prefers-reduced-motion` opt-out.

## Versioning and release

One version number, in `package.json`. `tauri.conf.json` reads it from there; `scripts/set-version.mjs` writes it into both Cargo manifests. **Never hand-edit a version** — run `npm run version:set X.Y.Z`, and `npm run version:check` verifies the three agree (CI runs it, and the release workflow refuses a tag that disagrees with `package.json`).

- `.github/workflows/ci.yml` — every push/PR: version check, frontend build, vitest, clippy, `cargo test`.
- `.github/workflows/release.yml` — on a `v*` tag: builds Windows (NSIS+MSI), macOS (aarch64 + x86_64) and Linux (deb/rpm/AppImage), uploads to a **draft** release with `latest.json` for the in-app updater. Publishing the draft is the human step that makes an update live.
- `src-tauri/scripts/build-engine.sh` — the `beforeBuildCommand` hook. Builds the engine for `TAURI_ENV_TARGET_TRIPLE` (not the host — a macos-latest runner is arm64 but also builds the x86_64 bundle) then calls `stage-resources.sh` with the matching triple.
- The updater's public key is in `tauri.conf.json`; the private key is `~/.tauri/snifake.key` and lives in the `release` GitHub **environment** (not repository secrets) as `TAURI_SIGNING_PRIVATE_KEY`, restricted to `v*` tags — which is why the `build` job declares `environment: release`. Drop that line and the bundles ship unsigned without failing. Losing the key means no existing install can ever update in-app again: `pubkey` holds a single key, so there is no graceful rotation.

## Config keys

`LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI` — the uppercase names are the historical `config.json` keys and are still the on-disk serde names of `snifake_engine::proto::Profile`. Edited in the GUI form, saved via `save_profile`, and sent to the already-running elevated engine inside a `Command::Start { profile }` NDJSON line. They are **not** environment variables on a subprocess any more, and `validate()` in the engine — not the GUI — is the actual guarantee, because that process runs as root.

## The V2Ray tunnel

An **optional second stage** in front of the SNI forwarder. The SNI stage
stands up a listener; the tunnel's outbound dials *that listener*, so the
tunnel cannot run without it and the engine refuses `TunnelStart` when the
SNI stage is down. `address`/`port` are deliberately absent from a stored
tunnel — they are read from the running SNI profile at generation time,
because a stored copy of a read-only field eventually disagrees with reality.

- **Store:** `tunnels.json` in `app_dir()`, beside `profiles.json`. Unlike
  profiles, deleting the last tunnel is allowed: "no tunnel configured" is
  the state the application ships in.
- **Protocols are a closed set:** `vless` and `trojan`, transport `ws`,
  security `tls`. See `docs/superpowers/ACCEPTED_V2_CONFIG.md`. Widening it is
  a spec change, not a code change.
- **The core is never bundled.** sing-box is GPL-3.0 and this project is MIT,
  so it is downloaded or imported at runtime into `app_dir()/cores/`, pinned
  to one exact version with its digests in `engine/src/corepin.rs`. Import
  sits beside Download because a meaningful share of this application's users
  cannot reach github.com — which is why they have this application.
- **Three modes, with honest guarantees.** `Manual` points applications at a
  local port and captures nothing else. `System proxy` sets the OS setting and
  guarantees nothing, because nothing compels an application to honour it.
  `TUN` captures everything and is the only one that can fail closed. The
  interface says exactly that; claiming otherwise would be the same lie
  `DESIGN.md §4.1` refuses about a throughput bar.
- **Four guard rules are generated into every config** and cannot be
  overridden by the user's lists or the raw block. Three of them close the
  SNI↔tunnel loop; the tunnel would otherwise swallow the SNI engine's own
  connection.

## Notes

- The proxy engine is built from source in this repo (`src-tauri/engine`); there is no external binary to fetch. Windows additionally ships the official signed `WinDivert.dll` and `WinDivert64.sys` from `src-tauri/vendor/windivert/` — see the README there. They install as siblings of `snifake-engine.exe`, which is what lets the engine `LoadLibraryW("WinDivert.dll")` by bare name.
- Windows requires Administrator (UAC) for every app session, because WinDivert needs it to load the driver. The prompt appears once, on the first Start; the engine then stays alive for the session, so switching profiles never re-prompts.
- When adding a new target platform/arch, update `engine_name()`/`engine_path()` in `src-tauri/src/config.rs`, the elevation logic in `src-tauri/src/auth.rs` (Unix) or `src-tauri/src/elevate_windows.rs`, the backend selection in `src-tauri/engine/src/capture/mod.rs`, and `stage-resources.sh` if the target needs extra files.
- macOS bundles still need `cargo tauri build` on a Mac (or a matching CI runner) — Tauri does not cross-compile GUI bundles to Darwin. Windows *is* cross-compiled here, via `cargo-xwin` + NSIS.

## Dont commit this files:
./docs/*

## Git Conventions
- Commit messages must not include `Co-Authored-By` or any sign-off attribution lines
- Use conventional commit prefixes: `fix:`, `feat:`, `ci:`, `docs:`, `refactor:` and emoji

## Notis
- Not need run test command before commit
## Context Navigation (Graphify)

### 3-Layer Query Rule
1. **First:** query `graphify-out/graph.json` (`graphify query "..."`, `explain`, `god-nodes`)
   to understand code structure and connections
2. **Second:** query the Obsidian vault (`/home/mohamadtsn/vault/sni-fake/`) for decisions, progress, context
3. **Third:** only read raw code files when editing, or when layers 1-2 lack the answer

### When to rebuild the graph
- After structural changes (new modules, major refactors)
- `~/scripts/add_project.sh /home/mohamadtsn/scripts/sni-fake --update` — or `graphify update .`
- The graph is persistent — NO need to rebuild every session

### Do NOT
- Don't manually modify files inside `graphify-out/`
- Don't re-read the entire codebase if the graph already has the information
