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
- `src-tauri/src/lib.rs` — Tauri app entry (`run()`), `AppState` (`proxy` + the shared `Arc<LogBuffer>`), and the invokable commands: `load_config`, `save_config`, `start_proxy`, `stop_proxy`, `set_log_streaming`, `get_log_buffer`. Registers `tauri-plugin-single-instance` **first, before every other plugin** (a second launch unminimizes/shows/focuses the existing `main` window instead of spawning a duplicate — and a duplicate would spawn a second *elevated* proxy on the same port). Wires the system tray, and redirects the window's native close button and tray "Exit"/"Start"/"Stop" clicks into `frontend-*-requested` events so the confirm/validate logic lives once, in the frontend.
- `src-tauri/src/config.rs` — filesystem locations only: `app_dir()` (`snifake` under the platform app-data dir, where `profiles.json` lives), `engine_path()` (resolves `snifake-engine[.exe]` from the bundle's resource dir, falling back to the GUI's own directory for `cargo tauri dev`), and `install_sudoers_script_path()`. Everything config-shaped lives in `profiles.rs`.
- `src-tauri/src/auth.rs` — `get_elevated_prefix()`: `pkexec` (fallback `sudo -n`) on Linux, `osascript ... with administrator privileges` on macOS, no-op on Windows (UAC handled via the bundle manifest at packaging time).
- `src-tauri/src/logbuf.rs` — `LogBuffer`: a 500-line `VecDeque` ring for backfill, a `pending` batch, and an `AtomicBool` streaming gate, plus `spawn_flusher()` which emits a `log-batch` (`Vec<String>`) event every 200 ms **only while the frontend has Activity open**. Sole owner of log fan-out. With Activity closed, the whole cost of a proxy log line is one `push_back` — no IPC, no React render. (Before this, one Tauri event per stdout line pegged the CPU during downloads, even minimized: WebKitGTK keeps running JS and layout for hidden windows.)
- `src-tauri/src/proxy.rs` — `ProxyManager`: spawns/stops the proxy binary, emits the `state-changed` Tauri event, pushes all its own messages and the child's stdout/stderr into the shared `LogBuffer` (never straight over IPC), process-group-based kill (SIGTERM then SIGKILL after a 5s timeout) so elevation wrappers don't leave an orphaned child.
- `src-tauri/src/tray.rs` — system tray menu and the runtime-composited status-badge tray icon (colored dot over the app icon, mirroring the state).
- `src/types.ts` — shared `ProxyState`/`Profile`/`Store` types, the `STATE_TEXT`/`STATE_ACTION`/`STATE_COLOR` display maps (instrument vocabulary: OFFLINE/STARTING/ACTIVE/FAULT) and `formatUptime`.
- `src/components/TitleBar.tsx` — the bezel for the frameless window (`data-tauri-drag-region`), carrying the product name, a condition readout and three hand-drawn window glyphs. Deliberately rendered **outside** `App`'s `.sheet-host`, so quit/minimise stay live while the profile drawer is open (the drawer and its scrim start 36px down to match).
- `src/lib/gesture.ts` — pure drag physics for the drawer: `velocityFrom`, `project` (Apple's exponential-decay form, not `v²/2a`), `rubberband`, `shouldDismiss`. No DOM access, so the numbers that decide how the drawer *feels* are the one part of the frontend that is actually tested (`gesture.test.ts`, `npm test`).
- `src/components/StatusPanel.tsx` — the instrument face: a 20-segment signal bar, the condition word and the uptime clock. The bar is driven entirely from CSS off `data-state`, so a running console costs zero React renders for the animation. It encodes **state only** — there is no throughput meter, because the engine reports no bytes and a bar moving without data behind it is undetectable as a lie.
- `src/components/PowerSwitch.tsx` — the only control that starts or stops the engine. A latching rocker: press drops it 1px and swaps the outer shadow for an inner one; `running` lights it solid amber with dark ink. Deliberately **not** keyed on `state`, so keyboard focus survives a state change.
- `src/components/RouteRows.tsx` — read-only Listen/Upstream/SNI as a three-column grid, so ports line up vertically. A sibling of the switch, never inside its hit area.
- `src/components/ProfileSelect.tsx` — the channel selector (Base UI `Select`) plus the way into the drawer. Replaced a rail of chips because switching profiles while running restarts the engine, and a chip was one stray click from doing that; a selector costs two deliberate actions and keeps one fixed row whatever the profile count.
- `src/components/Sheet.tsx` — drawer primitive. Base UI `Dialog` supplies focus trapping, `Esc` and scroll lock; the visual layer and the drag are hand-rolled on Pointer Events writing `transform` straight onto the node, because a drag must be 1:1. Portals into `.shell` rather than `<body>` so it stays inside the bezel. Grabbing a closing drawer resumes from its presentation transform.
- `src/components/ProfileSheet.tsx` — drawer contents, list ⇄ editor as two horizontally pushed views that both stay mounted so the push can animate. Rows enter/leave/reorder via `AnimatePresence` + `layout`. Purely a management surface now that switching lives on the selector.
- `src/components/ProfileEditor.tsx` — name plus the 5 connection fields, inline per-field validation. Host+port pair on one line each so the control mirrors the shape of the value. Inputs are `dir="ltr"` and left-aligned (hostnames/IPs/ports, never prose) and every field keeps a visible label. The error line reserves its height so a message shifts nothing.
- `src/components/Disclosure.tsx` — Base UI `Collapsible` wrapper styled as an engraved section header made pressable. Its panel **unmounts when closed**, which is what keeps the log list out of the DOM.
- `src/components/ActivitySection.tsx` — owns all log state; drives `set_log_streaming`, backfills via `get_log_buffer`, renders `log-batch` payloads, and polls the buffer length once a second while closed to drive its badge. Lines do not wrap — they scroll sideways, because wrapping splits an IPv4 address mid-octet.
- `src/App.tsx` — assembles all components, calls Tauri commands via `invoke()`, listens for `state-changed`/`frontend-*-requested` events, owns `sheetOpen` and the exit/delete/error `AlertDialog`s. Tracks `runningId` separately from `store.active_id` (switching while running restarts the engine into the new profile with no prompt) and `since` for the uptime clock, started when the engine reports `running` rather than when we asked it to start. Holds no log state. Quit is reachable only from the bezel `×` and the tray.
- `src/lib/updater.ts` — the two updater calls, wrapped. `findUpdate()` swallows every error and returns null: this app's users are plausibly behind something that blocks github.com, and an update is a convenience that must never surface as a failure. `App.tsx` checks once on mount and renders the offer in the same `AlertDialog` everything else uses.
- `src/theme.css` — Tailwind v4 `@theme` tokens for the **Console** language: one cool-graphite surface family, three rule steps (`line`/`edge`/`beam`), four text steps, amber as the sole accent, tight radii (3/4/6px), the `--track-*` engraving table, and the `.engrave`/`.signal`/`.switch`/`.selector`/`.menu`/`.sheet-*`/`.log-scroll` primitives. **`DESIGN.md` is the source of truth for every value here.** Amber is the only accent and there is no green — see the decision log. Only `transform`/`opacity`/`color`/`background-color`/`border-color` animate (the one exception is `.disclosure-panel`'s height, which is `contain: paint`), and every animation has a `prefers-reduced-motion` opt-out.

## Versioning and release

One version number, in `package.json`. `tauri.conf.json` reads it from there; `scripts/set-version.mjs` writes it into both Cargo manifests. **Never hand-edit a version** — run `npm run version:set X.Y.Z`, and `npm run version:check` verifies the three agree (CI runs it, and the release workflow refuses a tag that disagrees with `package.json`).

- `.github/workflows/ci.yml` — every push/PR: version check, frontend build, vitest, clippy, `cargo test`.
- `.github/workflows/release.yml` — on a `v*` tag: builds Windows (NSIS+MSI), macOS (aarch64 + x86_64) and Linux (deb/rpm/AppImage), uploads to a **draft** release with `latest.json` for the in-app updater. Publishing the draft is the human step that makes an update live.
- `src-tauri/scripts/build-engine.sh` — the `beforeBuildCommand` hook. Builds the engine for `TAURI_ENV_TARGET_TRIPLE` (not the host — a macos-latest runner is arm64 but also builds the x86_64 bundle) then calls `stage-resources.sh` with the matching triple.
- The updater's public key is in `tauri.conf.json`; the private key is `~/.tauri/snifake.key` and lives in GitHub secrets as `TAURI_SIGNING_PRIVATE_KEY`. Losing it means no existing install can ever update in-app again.

## Config keys

`LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI` — edited in the GUI form, saved via the `save_config` command, and passed to the proxy subprocess as environment variables on start.

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
- Not need run test command
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
