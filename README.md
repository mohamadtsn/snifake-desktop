# SNI Spoof

Cross-platform desktop app (Tauri + React) that manages an external `sni-spoof` binary process — a TLS SNI-spoofing proxy. This app does not implement the proxy itself; it configures, launches (with elevated privileges), monitors, and stops the pre-built `sni-spoof-{platform}-{arch}` binary as a subprocess.

## Features

- System tray with live status (stopped/starting/running/error)
- Config form: Listen Host/Port, Connect IP/Port, Fake SNI
- Start/Stop/Save/Autostart toggle/Exit
- Activity log
- Elevated privilege launch of the bundled proxy binary
- Persistent JSON config in the platform app-data dir

## Configuration

Config keys (`LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI`) are edited in the GUI form, saved via the `save_config` command to a JSON file in the platform app-data dir, and passed to the proxy subprocess as environment variables on start.

## Requirements

- Node.js 18+
- Rust (stable, via [rustup](https://rustup.rs)) — only needed for building/running outside Docker
- Platform build dependencies per the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)
- A `sni-spoof-{platform}-{arch}` binary placed at the repo root (not included in this repo)

## Development

```bash
npm install
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

Produces platform-native installers/binaries in `src-tauri/target/release/bundle/`.

## Docker (Linux Rust/Tauri build & dev only)

Frontend tooling runs on the host; Docker only covers the Rust/Tauri side:

```bash
npm run build && docker compose run --rm build   # Linux bundle -> src-tauri/target/release/bundle
npm run dev                                       # in one terminal
docker compose run --rm dev                       # in another, X11 passthrough
```