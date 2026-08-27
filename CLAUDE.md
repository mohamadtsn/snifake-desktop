# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cross-platform Tauri (Rust backend) + React (TypeScript) desktop app that manages an external `sni-spoof` binary process — a TLS SNI-spoofing proxy. The app does not implement the proxy itself; it configures, launches (with elevated privileges), monitors, and stops the pre-built `sni-spoof-{platform}-{arch}` binary as a subprocess.

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
- `src-tauri/src/config.rs` — `Config` struct (serde, renamed to the exact `LISTEN_HOST`/`LISTEN_PORT`/`CONNECT_IP`/`CONNECT_PORT`/`FAKE_SNI` JSON keys), `load_config`/`save_config` (JSON file in the platform app-data dir), `get_binary_path` (resolves `sni-spoof-linux-amd64`, `sni-spoof-darwin-{arch}`, or `sni-spoof-windows-amd64.exe` from the app's bundled resources).
- `src-tauri/src/auth.rs` — `get_elevated_prefix()`: `pkexec` (fallback `sudo -n`) on Linux, `osascript ... with administrator privileges` on macOS, no-op on Windows (UAC handled via the bundle manifest at packaging time).
- `src-tauri/src/logbuf.rs` — `LogBuffer`: a 500-line `VecDeque` ring for backfill, a `pending` batch, and an `AtomicBool` streaming gate, plus `spawn_flusher()` which emits a `log-batch` (`Vec<String>`) event every 200 ms **only while the frontend has Activity open**. Sole owner of log fan-out. With Activity closed, the whole cost of a proxy log line is one `push_back` — no IPC, no React render. (Before this, one Tauri event per stdout line pegged the CPU during downloads, even minimized: WebKitGTK keeps running JS and layout for hidden windows.)
- `src-tauri/src/proxy.rs` — `ProxyManager`: spawns/stops the proxy binary, emits the `state-changed` Tauri event, pushes all its own messages and the child's stdout/stderr into the shared `LogBuffer` (never straight over IPC), process-group-based kill (SIGTERM then SIGKILL after a 5s timeout) so elevation wrappers don't leave an orphaned child.
- `src-tauri/src/tray.rs` — system tray menu and the runtime-composited status-badge tray icon (colored dot over the app icon, mirroring the state).
- `src/types.ts` — shared `ProxyState`/`Profile`/`Store` types and the `STATE_TEXT`/`STATE_ACTION`/`STATE_COLOR` display maps.
- `src/components/TitleBar.tsx` — custom draggable title bar for the frameless window (`data-tauri-drag-region`, hide-to-tray/minimize/quit as lucide icons).
- `src/lib/gesture.ts` — pure drag physics for the sheet: `velocityFrom`, `project` (Apple's exponential-decay form, not `v²/2a`), `rubberband`, `shouldDismiss`. No DOM access, so the numbers that decide how the sheet *feels* are the one part of the frontend that is actually tested (`gesture.test.ts`, `npm test`).
- `src/components/PowerDisc.tsx` — the status indicator and the primary action as **one** 152px circular button. Colour tells you where you are, pressing changes it; nothing else in the app toggles the proxy. The button is deliberately **not** keyed on `state` so keyboard focus survives a state change; only the label block below it is keyed, so it cross-fades. Three nested transforms compose: press scale on `.disc-button` (CSS), state spring on the `motion.span` (because `.disc` runs keyframes in two states and an animation's transform beats an `:active` one), breathe/shake keyframes on `.disc`.
- `src/components/RouteRows.tsx` — read-only Listen/Upstream/SNI, a sibling of the disc rather than inside it, so reading the route can never toggle it.
- `src/components/Sheet.tsx` — bottom-sheet primitive. Base UI `Dialog` supplies focus trapping, `Esc` and scroll lock; the visual layer and the drag are hand-rolled on Pointer Events writing `transform` straight onto the node, because a drag must be 1:1. Portals into `.shell` rather than `<body>` so the panel's square bottom corners clip against the rounded window. Grabbing a closing sheet resumes from its presentation transform.
- `src/components/ProfileBar.tsx` — the active profile and the way into the sheet. A separate control from the disc on purpose: switching profiles and starting the proxy must not share a hit area.
- `src/components/ProfileSheet.tsx` — sheet contents, list ⇄ editor as two horizontally pushed views that both stay mounted so the push can animate. Rows enter/leave/reorder via `AnimatePresence` + `layout`.
- `src/components/ProfileEditor.tsx` — name plus the 5 connection fields, inline per-field validation. Host+port pair on one line each so the control mirrors the shape of the value. Inputs are `dir="ltr"` and left-aligned (hostnames/IPs/ports, never prose) and every field keeps a visible label. Solid accent fills carrying white text use `--color-brand-press`, not `--color-brand` (see `DESIGN.md` decision log).
- `src/components/Disclosure.tsx` — Base UI `Collapsible` wrapper: trigger row (label / collapsed summary / badge / chevron) + animated panel. Its panel **unmounts when closed**, which is what keeps the log list out of the DOM.
- `src/components/ActivitySection.tsx` — owns all log state; drives `set_log_streaming`, backfills via `get_log_buffer`, renders `log-batch` payloads, and polls the buffer length once a second while closed to drive its badge.
- `src/App.tsx` — assembles all components, calls Tauri commands via `invoke()`, listens for `state-changed`/`frontend-*-requested` events, owns `sheetOpen` (and pushes the main content back with `.sheet-host` while it is open) and the exit/delete/error `AlertDialog`s. Tracks `runningId` separately from `store.active_id`: switching profiles while running restarts the engine into the new one with no prompt. Holds no log state. Quit is reachable only from the titlebar `×` and the tray.
- `src/theme.css` — Tailwind v4 `@theme` tokens: two surface levels (`.shell`, `.raised`), three text steps, state colors, motion easings (`--ease-out`/`--ease-in-out`/`--ease-sheet`), the `--track-*` tracking table, and the `.disc`/`.sheet-*`/`.disclosure-panel`/`.log-scroll` primitives. **`DESIGN.md` is the source of truth for every value here.** The brand accent is `--color-brand`, **not** `--color-accent` — the later `@theme inline` block re-maps `--color-accent` onto shadcn's token and would win. Only `transform`/`opacity`/`color`/`background-color` animate (the one exception is `.disclosure-panel`'s height, which is `contain: paint`), and every animation has a `prefers-reduced-motion` opt-out.

## Config keys

`LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI` — edited in the GUI form, saved via the `save_config` command, and passed to the proxy subprocess as environment variables on start.

## Notes

- The proxy engine is built from source in this repo (`src-tauri/engine`); there is no external binary to fetch. Windows additionally ships the official signed `WinDivert.dll` and `WinDivert64.sys` from `src-tauri/vendor/windivert/` — see the README there. They install as siblings of `sni-fake-engine.exe`, which is what lets the engine `LoadLibraryW("WinDivert.dll")` by bare name.
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
