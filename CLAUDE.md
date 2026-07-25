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

Docker (Linux Rust/Tauri build & dev only — frontend tooling stays on the host):

```bash
npm run build && docker compose run --rm build   # cargo tauri build -> src-tauri/target/release/bundle
npm run dev                                       # in one terminal (leave running)
docker compose run --rm dev                       # in another, X11 passthrough for cargo tauri dev
```

## Architecture

- `src-tauri/src/lib.rs` — Tauri app entry (`run()`), `AppState` (`proxy` + the shared `Arc<LogBuffer>`), and the invokable commands: `load_config`, `save_config`, `start_proxy`, `stop_proxy`, `get_autostart_enabled`, `set_autostart`, `set_log_streaming`, `get_log_buffer`. Registers `tauri-plugin-single-instance` **first, before every other plugin** (a second launch unminimizes/shows/focuses the existing `main` window instead of spawning a duplicate — and a duplicate would spawn a second *elevated* proxy on the same port). Wires the system tray, and redirects the window's native close button and tray "Exit"/"Start"/"Stop" clicks into `frontend-*-requested` events so the confirm/validate logic lives once, in the frontend.
- `src-tauri/src/config.rs` — `Config` struct (serde, renamed to the exact `LISTEN_HOST`/`LISTEN_PORT`/`CONNECT_IP`/`CONNECT_PORT`/`FAKE_SNI` JSON keys), `load_config`/`save_config` (JSON file in the platform app-data dir), `get_binary_path` (resolves `sni-spoof-linux-amd64`, `sni-spoof-darwin-{arch}`, or `sni-spoof-windows-amd64.exe` from the app's bundled resources).
- `src-tauri/src/auth.rs` — `get_elevated_prefix()`: `pkexec` (fallback `sudo -n`) on Linux, `osascript ... with administrator privileges` on macOS, no-op on Windows (UAC handled via the bundle manifest at packaging time).
- `src-tauri/src/autostart.rs` — cross-platform "run on login" toggle: `.desktop` file in `~/.config/autostart` (Linux), registry `Run` key (Windows), `LaunchAgent` `.plist` (macOS).
- `src-tauri/src/logbuf.rs` — `LogBuffer`: a 500-line `VecDeque` ring for backfill, a `pending` batch, and an `AtomicBool` streaming gate, plus `spawn_flusher()` which emits a `log-batch` (`Vec<String>`) event every 200 ms **only while the frontend has Activity open**. Sole owner of log fan-out. With Activity closed, the whole cost of a proxy log line is one `push_back` — no IPC, no React render. (Before this, one Tauri event per stdout line pegged the CPU during downloads, even minimized: WebKitGTK keeps running JS and layout for hidden windows.)
- `src-tauri/src/proxy.rs` — `ProxyManager`: spawns/stops the proxy binary, emits the `state-changed` Tauri event, pushes all its own messages and the child's stdout/stderr into the shared `LogBuffer` (never straight over IPC), process-group-based kill (SIGTERM then SIGKILL after a 5s timeout) so elevation wrappers don't leave an orphaned child.
- `src-tauri/src/tray.rs` — system tray menu and the runtime-composited status-badge tray icon (colored dot over the app icon, mirroring the state).
- `src/types.ts` — shared `ProxyState`/`Config` types and the `STATE_TEXT`/`STATE_SUBTITLE`/`STATE_ORB` display maps.
- `src/components/TitleBar.tsx` — custom draggable title bar for the frameless window (`data-tauri-drag-region`, hide-to-tray/minimize/quit as lucide icons).
- `src/components/StatusHero.tsx` — animated status orb + state title + active-SNI line. Remounts on `key={state}` (WebKitGTK leaves stale glyphs when text changes under a composited layer; the remount also re-triggers the orb pop).
- `src/components/PrimaryAction.tsx` — the single morphing Start/Stop button (Stop stays available during `starting`).
- `src/components/Disclosure.tsx` — Base UI `Collapsible` wrapper: trigger row (label / collapsed summary / badge / chevron) + animated panel. Its panel **unmounts when closed**, which is what keeps the log list out of the DOM.
- `src/components/ConnectionSection.tsx` — the 5 config fields inside a `Disclosure`; exposes `getValue()`/`validate()` via `forwardRef`/`useImperativeHandle` as `ConfigFormHandle`, and only shows "Save changes" while dirty.
- `src/components/ActivitySection.tsx` — owns all log state; drives `set_log_streaming`, backfills via `get_log_buffer`, renders `log-batch` payloads, and polls the buffer length once a second while closed to drive its badge.
- `src/components/SettingsRow.tsx` — "Launch at login" row using `src/components/ui/switch.tsx` (Base UI `Switch`).
- `src/App.tsx` — assembles all components, calls Tauri commands via `invoke()`, listens for `state-changed`/`frontend-*-requested` events, owns the exit-confirmation and invalid-config `AlertDialog`s. Holds no log state. Quit is reachable only from the titlebar `×` and the tray.
- `src/theme.css` — Tailwind v4 `@theme` tokens: two surface levels (`.shell`, `.raised`), three text steps, state colors, motion easings (`--ease-out-quint`/`--ease-spring`/`--ease-sheet`), and the `.orb`/`.disclosure-panel`/`.log-scroll` primitives. The brand accent is `--color-brand`, **not** `--color-accent` — the later `@theme inline` block re-maps `--color-accent` onto shadcn's token and would win. Only `transform`/`opacity`/`color` animate, and every animation has a `prefers-reduced-motion` opt-out.

## Config keys

`LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI` — edited in the GUI form, saved via the `save_config` command, and passed to the proxy subprocess as environment variables on start.

## Notes

- No `sni-spoof-*` binary is checked into this repo. Place the platform binary at the repo root before `npm run tauri build`/`docker compose run --rm build` will produce a working installer; `src-tauri/tauri.conf.json`'s `bundle.resources` needs to be re-added listing the binaries once they exist.
- When adding a new target platform/arch, update both `get_binary_path()` in `src-tauri/src/config.rs` and the elevation logic in `src-tauri/src/auth.rs`.
- macOS and Windows builds need `cargo tauri build` run on that OS (or a matching CI runner) — Tauri does not cross-compile GUI bundles from Linux.

## Dont commit this files:
./docs/*

## Git Conventions
- Commit messages must not include `Co-Authored-By` or any sign-off attribution lines
- Use conventional commit prefixes: `fix:`, `feat:`, `ci:`, `docs:`, `refactor:` and emoji

## Notis
- Not need run test command