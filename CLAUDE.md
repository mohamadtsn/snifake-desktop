# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cross-platform PySide6 GUI (system tray app) that manages an external `sni-spoof` binary process — a TLS SNI-spoofing proxy. The Python code does not implement the proxy itself; it configures, launches (with elevated privileges), monitors, and stops the pre-built `sni-spoof-{platform}-{arch}` binary as a subprocess.

## Commands

No test suite exists. Dev/build/lint flows run through Docker Compose:

```bash
docker compose run --rm dev        # Interactive dev shell (mounts repo, X11 passthrough via DISPLAY)
docker compose run --rm build      # Build standalone binary with PyInstaller -> ./dist/sni-fake
docker compose run --rm test       # ruff check + ruff format --check on src/
docker compose run --rm package    # Full package build (same as build, with completion message)
```

Run locally without Docker:

```bash
pip install -r requirements.txt
python main.py
```

PyInstaller spec (`sni-fake.spec`) mirrors the compose `build`/`package` commands: `--onefile --windowed --add-data config.json:.`

## Architecture

- `main.py` — entry point. Wires `Config`, `SniProxy`, `MainWindow`, and `SystemTrayIcon` together via Qt signals (`start_requested`/`stop_requested` -> `proxy.start`/`proxy.stop`).
- `src/config.py` — `Config` class persists settings as JSON at a platform-specific app-data dir (`get_app_dir()`: XDG_CONFIG_HOME on Linux, AppData\Roaming on Windows, Library/Application Support on macOS). `get_binary_path()` resolves the correct platform/arch binary name (e.g. `sni-spoof-linux-amd64`, `sni-spoof-darwin-{arch}`, `sni-spoof-windows-amd64.exe`) sitting alongside the app. Falls back to `DEFAULT_CONFIG` if no config file exists yet.
- `src/proxy.py` — `SniProxy(QObject)` manages the binary's subprocess lifecycle (start/stop/restart) and emits `state_changed` ("stopped"/"starting"/"running"/"error") and `log_message` signals. Passes config as env vars (`LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI`) to the binary rather than CLI args.
- `src/auth.py` — `get_elevated_prefix()` returns a platform-specific command prefix to run the binary with elevated privileges: `pkexec` (fallback `sudo -n`) on Linux, `osascript ... with administrator privileges` on macOS, no-op on Windows (UAC handled via PyInstaller manifest at packaging time / `ShellExecuteW runas` in dev).
- `src/autostart.py` — cross-platform "run on login" toggle: `.desktop` file in `~/.config/autostart` (Linux), registry `Run` key (Windows), LaunchAgent `.plist` (macOS).
- `src/theme.py` — shared color palette (`COLORS`), spacing constant (`SPACING`), and QSS/glow helpers (`apply_glow`, `glass_panel_qss`, `input_qss`, `checkbox_qss`, `gradient_button_qss`, `styled_button`) used by every widget module below.
- `src/widgets/status_card.py` — `StatusCard`: the glass panel showing current proxy state (dot + title + subtitle).
- `src/widgets/config_form.py` — `ConfigForm`: the Listen/Connect/SNI config fields, with `apply_to(config)` and `validate() -> (bool, str)`.
- `src/widgets/action_bar.py` — `ActionBar`: Start/Stop/Save/Autostart/Exit controls, exposed as Qt Signals (`start_clicked`, `stop_clicked`, `save_clicked`, `exit_clicked`, `autostart_toggled`).
- `src/widgets/log_panel.py` — `LogPanel`: capped-length (`MAX_LOG_LINES`) activity log.
- `src/gui.py` — `MainWindow` (assembles the widgets above via signals) and `SystemTrayIcon` (tray icon reflecting proxy state, context menu mirroring window actions). The window is resizable (`QSizeGrip`), not fixed-size.
- `src/titlebar.py` — `TitleBar`: custom draggable title bar for the frameless window (icon, title, drag-to-move, minimize/close buttons).

## Config keys

`LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI` — edited in the GUI form, saved via `Config.save()`, and passed to the proxy subprocess as environment variables on start.

## Notes

- `build/` and `dist/` are PyInstaller output (already-built artifacts) — not source to edit.
- When adding a new target platform/arch, update both `get_binary_path()` in `src/config.py` and the elevation logic in `src/auth.py`.
