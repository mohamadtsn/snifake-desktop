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

- `src-tauri/src/lib.rs` — Tauri app entry (`run()`), `AppState`, and the invokable commands: `load_config`, `save_config`, `start_proxy`, `stop_proxy`, `get_autostart_enabled`, `set_autostart`. Wires the system tray, and redirects the window's native close button and tray "Exit"/"Start"/"Stop" clicks into `frontend-*-requested` events so the confirm/validate logic lives once, in the frontend.
- `src-tauri/src/config.rs` — `Config` struct (serde, renamed to the exact `LISTEN_HOST`/`LISTEN_PORT`/`CONNECT_IP`/`CONNECT_PORT`/`FAKE_SNI` JSON keys), `load_config`/`save_config` (JSON file in the platform app-data dir), `get_binary_path` (resolves `sni-spoof-linux-amd64`, `sni-spoof-darwin-{arch}`, or `sni-spoof-windows-amd64.exe` from the app's bundled resources).
- `src-tauri/src/auth.rs` — `get_elevated_prefix()`: `pkexec` (fallback `sudo -n`) on Linux, `osascript ... with administrator privileges` on macOS, no-op on Windows (UAC handled via the bundle manifest at packaging time).
- `src-tauri/src/autostart.rs` — cross-platform "run on login" toggle: `.desktop` file in `~/.config/autostart` (Linux), registry `Run` key (Windows), `LaunchAgent` `.plist` (macOS).
- `src-tauri/src/proxy.rs` — `ProxyManager`: spawns/stops the proxy binary, emits `state-changed`/`log-message` Tauri events, process-group-based kill (SIGTERM then SIGKILL after a 5s timeout) so elevation wrappers don't leave an orphaned child.
- `src-tauri/src/tray.rs` — system tray menu and the runtime-composited status-badge tray icon (colored dot over the app icon, mirroring the state).
- `src/types.ts` — shared `ProxyState`/`Config` types and the `STATE_TEXT`/`STATE_SUBTITLE`/`STATE_DOT_CLASS` display maps.
- `src/components/TitleBar.tsx` — custom draggable title bar for the frameless window (`data-tauri-drag-region`, minimize/close).
- `src/components/StatusCard.tsx` — state dot + title + subtitle.
- `src/components/ConfigForm.tsx` — Listen/Connect/SNI fields, exposes `getValue()`/`validate()` via `forwardRef`/`useImperativeHandle`.
- `src/components/ActionBar.tsx` — Start/Stop/Save/Autostart/Exit controls.
- `src/components/LogPanel.tsx` — capped-length (500 lines, capped in `App.tsx`) scrolling activity log.
- `src/App.tsx` — assembles all components, calls Tauri commands via `invoke()`, listens for `state-changed`/`log-message`/`frontend-*-requested` events, owns the exit-confirmation and invalid-config `AlertDialog`s.
- `src/theme.css` — Tailwind v4 `@theme` tokens (colors ported from the original QSS palette) plus the `.glass-panel` utility class.

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