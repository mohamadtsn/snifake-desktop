# SNI Spoof

A cross-platform desktop GUI (system tray app) for managing a TLS SNI-spoofing proxy. It configures, launches (with elevated privileges), monitors, and stops a pre-built `sni-spoof` binary — it does not implement the proxy itself.

## Features

- System tray control with live status (stopped / starting / running / error)
- Simple form to configure listen/connect endpoints and the fake SNI value
- One-click elevated start (via `pkexec`/`sudo` on Linux, admin prompt on macOS, UAC on Windows)
- "Run on login" autostart toggle
- Persistent JSON config stored in the platform's standard app-data directory

## Requirements

- Python 3.9+
- [PySide6](https://pypi.org/project/PySide6/) `>=6.5.0`
- A `sni-spoof-{platform}-{arch}` binary placed alongside the app (not included in this repo)

## Installation

```bash
pip install -r requirements.txt
python main.py
```

## Docker-based dev/build workflow

```bash
docker compose run --rm dev        # Interactive dev shell (X11 passthrough via DISPLAY)
docker compose run --rm build      # Build standalone binary with PyInstaller -> ./dist/sni-fake
docker compose run --rm test       # ruff check + ruff format --check on src/
docker compose run --rm package    # Full package build (same as build, with completion message)
```

## Configuration

Settings are edited in the GUI and saved to a JSON config file (`Config.save()`), then passed to the proxy subprocess as environment variables on start.

| Key            | Description                          |
|----------------|---------------------------------------|
| `LISTEN_HOST`  | Local address the proxy listens on    |
| `LISTEN_PORT`  | Local port the proxy listens on       |
| `CONNECT_IP`   | Upstream IP the proxy connects to     |
| `CONNECT_PORT` | Upstream port the proxy connects to   |
| `FAKE_SNI`     | SNI value sent instead of the real one|

Config file location:

| Platform | Path                                              |
|----------|----------------------------------------------------|
| Linux    | `$XDG_CONFIG_HOME/sni-fake` (default `~/.config/sni-fake`) |
| Windows  | `%APPDATA%\sni-fake`                                |
| macOS    | `~/Library/Application Support/sni-fake`            |

## Building a standalone binary

```bash
docker compose run --rm build
```

Produces `./dist/sni-fake` (mirrors the `sni-fake.spec` PyInstaller config: `--onefile --windowed --add-data config.json:. --add-data assets/icon.svg:assets`).

## Project layout

- `main.py` — entry point, wires `Config`, `SniProxy`, `MainWindow`, `SystemTrayIcon` together
- `src/config.py` — JSON-backed settings + binary path resolution per platform/arch
- `src/proxy.py` — manages the `sni-spoof` binary's subprocess lifecycle
- `src/auth.py` — platform-specific elevated-privilege launch prefix
- `src/autostart.py` — cross-platform "run on login" toggle
- `src/gui.py` — main window + system tray icon
- `src/icons.py` — SVG icon loading/rendering
- `src/titlebar.py` — custom draggable title bar for the frameless window

## License

Add your license here.