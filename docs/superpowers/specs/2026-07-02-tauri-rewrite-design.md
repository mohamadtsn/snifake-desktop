# SNI Spoof — Tauri Rewrite Design

## Goal

Replace the PySide6/QSS stack with Tauri (Rust backend) + React (Tailwind + shadcn/ui) frontend. Motivation: QSS styling has proven hard to get a modern, polished look with (two prior redesign attempts in this stack, `docs/superpowers/plans/2026-07-02-modern-redesign.md` and `2026-07-02-glass-redesign-v2.md`, still unsatisfying). Web-tech (CSS/Tailwind) gives real design control.

## Scope

Same feature set as current app, no new features:
- System tray with live status (stopped/starting/running/error)
- Config form: Listen Host/Port, Connect IP/Port, Fake SNI
- Start/Stop/Save/Autostart toggle/Exit
- Activity log (capped length)
- Elevated privilege launch of bundled `sni-spoof-{platform}-{arch}` binary
- Persistent JSON config in platform app-data dir
- Cross-platform: Linux, Windows, macOS build targets

Design direction: dark glassmorphism, refined (blur/shadow/gradient depth), replacing the current QSS-based glass look.

## Architecture

Tauri 2.x app. Rust backend owns everything currently in `src/proxy.py`, `src/config.py`, `src/auth.py`, `src/autostart.py` — ported near 1:1:

- **Process management**: spawn/kill `sni-spoof` binary as child process, passing `LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI` as env vars (same contract as today).
- **Elevation**: `pkexec` (fallback `sudo -n`) on Linux, `osascript ... with administrator privileges` on macOS, UAC via Tauri's Windows manifest config on Windows (build-time, no runtime code — same as current PyInstaller manifest approach).
- **Config persistence**: JSON file in platform-standard app-data dir (Linux: XDG_CONFIG_HOME, Windows: AppData\Roaming, macOS: Library/Application Support) — same paths/format as today, via Rust `dirs` crate.
- **Autostart**: `.desktop` file (Linux `~/.config/autostart`), registry `Run` key (Windows, `winreg` crate), `LaunchAgent` plist (macOS) — same three mechanisms as `src/autostart.py`.
- **Binary resolution**: same naming scheme (`sni-spoof-linux-amd64`, `sni-spoof-darwin-{arch}`, `sni-spoof-windows-amd64.exe`) bundled alongside the app.

React frontend owns all UI. No business logic in the frontend beyond calling Tauri commands and rendering state.

## Components (React + Tailwind + shadcn/ui)

One-to-one with current widgets:
- `TitleBar` — custom frameless drag bar (`decorations:false` + drag region), minimize/close
- `StatusCard` — glass panel, state dot + title + subtitle
- `ConfigForm` — Listen/Connect/SNI fields, client-side validation mirroring current `validate()`
- `ActionBar` — Start/Stop/Save/Autostart/Exit controls
- `LogPanel` — capped-length scrolling activity log

Shared theme (colors, spacing, glass/gradient styles) lives in a Tailwind config + a small set of reusable className helpers, replacing `src/theme.py`.

## Data flow

React calls Rust via `invoke()`:
- `start_proxy`, `stop_proxy`, `save_config`, `toggle_autostart`, `load_config`

Rust emits events back to the frontend via Tauri's event system:
- `state-changed` (stopped/starting/running/error)
- `log-message`

Frontend listens via `listen()` in a `useEffect`, updates local component state (`useState`/`useReducer` — no external state library needed at this size).

## Error handling

Rust commands return `Result<(), String>`. Errors surface as entries in the activity log, same UX as today's `log_message` signal — no new error UI paradigm introduced.

## Build/tooling

- Scaffold: `npm create tauri-app` (React + TypeScript + Vite template)
- Styling: Tailwind CSS + shadcn/ui components
- Dev: `cargo tauri dev` (hot reload) replaces `docker compose run dev`
- Build: `cargo tauri build` replaces PyInstaller + `docker compose run build`/`package`, produces native installers/binaries for Linux/Windows/macOS from one codebase
- Existing Docker dev/build flow (`Dockerfile`, `docker-compose.yml`, `sni-fake.spec`) retired; replaced with Tauri's own build tooling (still scriptable via Docker for Linux CI builds if cross-compilation needs it later)

## Out of scope

- No new features beyond current app
- No test suite (matches current project — none exists today)
- No change to the `sni-spoof` binary itself or its env-var contract