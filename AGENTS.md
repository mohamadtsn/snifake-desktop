# AGENTS.md

Instructions, architecture, workflows, and operational boundaries for AI coding agents working on **Snifake Desktop**.

---

## 1. Project Overview & Identity

**Snifake Desktop** is a cross-platform desktop application built with **Tauri v2 (Rust backend)** and **React 19 (TypeScript frontend)** for a TLS SNI-spoofing forwarder with an optional chained **V2Ray secondary tunnel** (`sing-box`).

- **Built-in Engine:** The forwarder engine (`snifake-engine`) is compiled from source in this repository (`src-tauri/engine/`) and packaged inside the application bundle. It is not an external prebuilt binary.
- **Product Identity (Must Remain Synchronized):**
  - `productName`: `Snifake` (Linux deb package name is `heck::to_kebab_case(productName)` -> `snifake`. Do NOT use `SNIFake` as it kebabs to `sni-fake`, an obsolete 1.x package name).
  - `mainBinaryName`: `snifake`
  - App Identifier: `io.github.mohamadtsn.snifake`
  - GitHub Repository: `mohamadtsn/snifake-desktop`
  - Linux Resource Path: `/usr/lib/<productName>/` (The polkit policy specifies `exec.path` as `/usr/lib/Snifake/...`; renaming `productName` breaks polkit elevation).
  - Verify package paths after packaging: `dpkg -c <deb-path>`.

---

## 2. Critical Agent Invariants & Rules

Every agent operating in this repository **must** respect the following non-negotiable rules:

### 2.1 Tooling & Shell Commands
- **Docker Environment:** The project is containerized on Docker (`snifake-toolchain`). Rust, Cargo, Tauri build, and target tests must be run via Docker (`docker compose run --rm ...`), not bare on the host.
- **RTK (Rust Token Killer):** Always prefix shell commands with `rtk` (e.g. `rtk git status`, `rtk docker compose run --rm test`, `rtk npm run test`, `rtk find "*.rs" .`).
- **Code Discovery Priority:**
  1. MCP Graph tools (`search_graph`, `trace_path`, `get_code_snippet`, `get_architecture`).
  2. Graphify query: `graphify query "..."` against `graphify-out/graph.json` or Obsidian vault `/home/mohamadtsn/vault/sni-fake/`.
  3. Raw file reading only when preparing edits or when graph layers lack answers.
  4. Never edit files inside `graphify-out/`.

### 2.2 Git & Commits
- **Do NOT commit `./docs/*`:** Documentation files in `./docs/*` must remain uncommitted.
- **No Mandatory Pre-commit Tests:** It is not required to run full test suites before committing.
- **Conventional Commits:** Use standard prefixes with emoji: `fix:`, `feat:`, `ci:`, `docs:`, `refactor:`.
- **No Sign-offs:** Commit messages must NOT include `Co-Authored-By` or any sign-off attribution lines.

### 2.3 Licensing & Isolation Boundaries
- **Licensing Constraint:** Snifake Desktop is licensed under **MIT**. The optional secondary core (`sing-box`) is **GPL-3.0**.
- **No Direct Linking:** Never link GPL code or crates (e.g. netlink crates).
- **Core Delivery:** `sing-box` is never bundled into the installer. It is downloaded or imported at runtime by the user into `app_dir()/cores/`.
- **Linux Kill Switch:** `engine/src/killswitch/linux.rs` interacts with nftables strictly via piping text to `nft -f -` as a child process.

### 2.4 Privilege Separation & Security
- **Dual-Process Architecture:**
  - GUI runs as an unprivileged user process.
  - Engine (`snifake-engine`) runs **elevated (root/Administrator)** once per session.
  - IPC between GUI and Engine is private NDJSON over a Unix Domain Socket (Linux/macOS) or Named Pipe (Windows). Never use standard I/O (buffered or unredirectable on certain platforms).
- **Authoritative Validation:** GUI validation in `src/lib/rules.ts` is only for instant UI feedback. The root engine's `engine/src/validate.rs` is the authoritative trust and security boundary.
- **sing-box Execution Guard:** The root engine verifies the downloaded/imported `sing-box` binary against hardcoded SHA256 digests in `engine/src/corepin.rs` before executing. Config files containing user credentials are written with strict permissions (`0600`).
- **OS Proxy (`sysproxy`):**
  - **MUST run in the GUI process, NEVER in the root engine.**
  - OS proxy configurations (GNOME `dconf`, KDE `kioslaverc`, macOS `networksetup`, Windows WinINET registry `HKCU`) are per-user. Running them in the root engine would modify root's proxy and leave the user's browser unproxied.
  - Linux `sysproxy` writes **both** GNOME and KDE settings.
  - Crash recovery is tracked via `marker.rs`: a marker is written before applying and only deleted after successful restore.

### 2.5 Performance & WebKitGTK Invariants
- **Log Streaming Gate:** In `src-tauri/src/logbuf.rs` and `src/components/ActivitySection.tsx`, proxy logs are batched into a 500-line ring buffer. Tauri `log-batch` events fire every 200ms **only while the Activity panel is open**.
  - **DO NOT bypass or remove this gate.** Under WebKitGTK (Linux), continuous IPC events and DOM updates peg the CPU at 100% even when the window is minimized.
- **Traffic Counter Decoupling:** Engine traffic rates are emitted once per second as cumulative totals (`Event::Traffic { up, down }`) directly to `App.tsx`, bypassing `LogBuffer` to prevent evicting operational logs.

### 2.6 Networking & Packet Injection Invariants
- **Packet Layer:** Packet capture and injection (`engine/src/capture/`) operate strictly at the **IP layer and above**, never Ethernet headers.
- **Fake ClientHello Frame Length:** In `engine/src/hello.rs`, the fake ClientHello frame length must remain exactly **517 bytes**. The SNI payload length change is compensated using TLS padding extensions.
- **Single Instance Guarantee:** In `src-tauri/src/lib.rs`, `tauri-plugin-single-instance` must be initialized **before any other plugin** to prevent duplicate elevated listeners on identical ports.

### 2.7 Version Management
- Single source of truth: `package.json`.
- **Never hand-edit version numbers** in `tauri.conf.json` or `Cargo.toml`.
- Update version: `npm run version:set <X.Y.Z>`
- Verify consistency: `npm run version:check`

---

## 3. Commands & Development Workflows

### 3.1 Host Development (Node.js & Rust required)
```bash
npm install                        # Install frontend dependencies
npm run dev                        # Run Vite frontend dev server
npm run build                      # Typecheck (tsc) & build frontend
npm run tauri dev                  # Launch full Tauri app in dev mode
npm run tauri build                # Production release build
npm test                           # Run frontend unit tests (vitest)
npm run version:check              # Check version sync across manifests
npm run version:set <X.Y.Z>        # Synchronize new version across manifests
```

### 3.2 Docker Toolchain (`snifake-toolchain`)
Docker encapsulates the full Rust/Tauri toolchain, Linux target bundles, Windows cross-compilation (`cargo-xwin` + NSIS), and macOS type-checks.
```bash
docker compose run --rm doctor          # Verify toolchain (cargo, tauri, xwin, nsis)
docker compose run --rm test            # Workspace test suite: cargo test --workspace
docker compose run --rm check           # Type-check Linux, Windows, and macOS targets
docker compose run --rm tunnel-it       # TUN kill-switch integration tests (requires NET_ADMIN)
npm run build && docker compose run --rm build-linux    # Build Linux bundles (deb, rpm, appimage)
npm run build && docker compose run --rm build-windows  # Build Windows NSIS bundle
npm run dev                             # Host terminal: Vite dev server
docker compose run --rm dev             # Second terminal: X11 passthrough for cargo tauri dev
```
> [!NOTE]
> All Docker services use the pinned image `snifake-toolchain`. Windows builds produce NSIS installers only. macOS targets are check-only (`cargo check`); `.app` and `.dmg` bundles require compilation on macOS.

### 3.3 Resource Staging
Cargo outputs native binaries to `target/release/` and cross-compilations to `target/<triple>/release/`.
- `src-tauri/scripts/stage-resources.sh <triple?>` stages `snifake-engine` (and WinDivert binaries for Windows) into `src-tauri/resources/`.
- Staging runs automatically during `npm run tauri build` via `beforeBuildCommand`.

---

## 4. Architecture & Code Map

### 4.1 UI Design System (`DESIGN.md`)
- `DESIGN.md` is the **system of record** for visual styling, tokens, type scale, animations, and component inventory.
- Consult `DESIGN.md` before making UI changes, and update it when introducing new design decisions.
- CSS variables and tokens are defined in `src/theme.css` using Tailwind v4 `@theme static`. Surfaces are solid fills (canvas, surface, card, inset, raised), not stacked alpha overlays.

### 4.2 Rust Tauri Backend (`src-tauri/src/`)
- `lib.rs`: Application entry (`run()`), `AppState` (`Mutex<EngineHost>`, `Mutex<Store>`, `Arc<LogBuffer>`), commands registration, single-instance plugin registration, tray events, and window close redirects.
- `config.rs`: File paths (`app_dir()`, `engine_path()`, `install_sudoers_script_path()`).
- `auth.rs`: Privilege elevation handling (`pkexec`, `sudo -n`, macOS `osascript`, Windows manifest UAC).
- `logbuf.rs`: Ring buffer (500 lines) with throttled flusher (200ms) gated on the Activity tab being open.
- `engine_host.rs`: Manages the elevated child engine process lifetime and NDJSON bidirectional communication.
- `profiles.rs`: SNI proxy profile store (`profiles.json`).
- `tray.rs`: System tray menu and runtime composited status-badge icon.
- `elevate_windows.rs`: Windows elevation using `ShellExecuteExW` with `runas`.
- `tunnel/`: Unprivileged tunnel management:
  - `model.rs`: Tunnel configuration store (`tunnels.json`).
  - `rules.rs`: Routing rule grammar parser.
  - `generate.rs`: sing-box JSON configuration generation and snapshot tests (`testdata/`).
  - `core.rs`: sing-box core download, integrity validation, and installation.
  - `tun.rs`: TUN interface support diagnostics and crash marker management (`tun.marker`).
  - `interfaces.rs`: Candidate VPN interface discovery for coexistence mode.
  - `rulesets.rs`: Rule-set downloads and imports (`app_dir()/rulesets/`).
  - `download.rs` & `exit.rs`: Core archive fetching and tunnel exit probe via `ipinfo.io`.
- `sysproxy/`: User-level OS proxy management:
  - `mod.rs`: Public API and platform dispatch.
  - `linux.rs`: Manages GNOME (`gsettings org.gnome.system.proxy`) and KDE (`kwriteconfig... kioslaverc`).
  - `macos.rs`: Drives `networksetup`.
  - `windows.rs`: Updates WinINET registry and triggers `InternetSetOptionW`.
  - `marker.rs`: Crash-safety state record; verifies state before restore.

### 4.3 Privileged Engine (`src-tauri/engine/`)
- `engine/src/main.rs`: CLI entrypoint (`snifake-engine <endpoint> <token>`). Connects back to GUI socket, joins threads on stop.
- `engine/src/proto.rs`: Wire protocol structs (`Profile`, `Command`, `Event`).
- `engine/src/transport.rs`: IPC transport (Unix domain socket or Windows named pipe).
- `engine/src/corepin.rs`: Pinned sing-box version and binary SHA256 checksums.
- `engine/src/tunnel.rs`: `TunnelSupervisor`: executes sing-box with 0600 config, probes readiness, handles termination.
- `engine/src/tun.rs`: `TunGuard`: manages nftables kill switch and route pinning.
- `engine/src/killswitch/`: `KillSwitch` implementation. Linux applies rules via text pipe to `nft -f -`.
- `engine/src/route_guard.rs`: Route pinning for `CONNECT_IP/32` with proto 177; cleans orphan iproute2 rules.
- `engine/src/passthrough.rs`: Coexisting VPN routing rules (`PASS_ENDPOINT_RULE`, `PASS_ROUTE_RULE`).
- `engine/src/forward.rs`: `Forwarder`: binds listener, performs egress route discovery via UDP connect, triggers fake packet handshake, and maintains cumulative traffic counters.
- `engine/src/sniffer.rs`: TCP packet classifier; triggers out-of-window fake ClientHello injection.
- `engine/src/hello.rs`: Synthesizes the fixed-length (517-byte) fake TLS ClientHello.
- `engine/src/netpkt.rs`: IP/TCP header parsing, checksum calculations, and packet injection synthesis.
- `engine/src/capture/`: Raw packet capture/injection backend (`linux.rs` AF_PACKET, `macos.rs` BPF, `windivert/`).

### 4.4 React Frontend (`src/`)
- `src/types.ts`: Type models, telemetry states (OFFLINE, STARTING, ACTIVE, HOLD, FAULT), color token maps.
- `src/App.tsx`: App shell, active tab coordinator, global state listeners, leave guard coordinator.
- `src/components/shell/`: `TitleBar` (52px, centered tabs), `StatusFooter` (36px, endpoints & traffic rate), `TabRegion` (tab scroll memory & cross-fade).
- `src/components/ui/`: UI primitives (`Button`, `Toggle`, `Segmented`, `Card`, `ModalSheet`, `ConfirmDialog`, `TextField`).
- `src/components/telemetry/`: Telemetry tab (`StagePipeline`, `ActuatorCard`, `StatusStrip`, `ChannelRow`).
- `src/components/sockets/`: Sockets tab (`ModeCards`, `SafeguardList`, `PassthroughList`, `RuleEditor`, `RuleSetList`, `AdvancedJson`).
- `src/components/config/`: Config tab (`ProfileList`, `SniEditor`, `TunnelEditorPane`, `ImportSheet`).
- `src/components/prefs/`: Preferences modal (General, Network, Core).
- `src/components/about/`: About tab (app identity, updater, license).
- `src/components/core/CoreSetupModal.tsx`: Core import/download workflow.
- `src/components/ActivitySection.tsx`: Log terminal with streaming gate and badge polling.
- `src/lib/`:
  - `rules.ts`: Frontend rule syntax validator matching Rust's `tunnel/rules.rs`. Tested against `rules.fixtures.json`.
  - `tunnelMachine.ts`: Two-stage dependency state machine.
  - `traffic.ts`: Transforms cumulative byte counts into live rates. Returns `null` (`—`) on stage reset, never misleading `0`.
  - `modeTransition.ts`: Dictates restart requirements on mode changes (Manual <-> SystemProxy requires no core restart).
  - `leaveGuard.ts`: Guards against accidental discard of dirty drafts across tabs/actions.
  - `undo.ts`: Input history stack for WebKitGTK input compatibility.
  - `readouts.ts`: Formatted status and telemetry strings.
  - `updater.ts`: In-app updater client.

---

## 5. Tunnel & Interception Modes

The secondary stage runs in front of the SNI forwarder. The tunnel dials the SNI forwarder's local listener; the tunnel cannot start unless the SNI stage is running.

| Mode | Behavior | Interception Guarantee | Cleanup on Stop / Crash |
| :--- | :--- | :--- | :--- |
| **Manual** | Listens on local SOCKS/HTTP port. Generates config. | Applications must be manually pointed to the port. | Closes inbound listener. |
| **System Proxy** | Listens on port + automatically configures OS proxy settings. | Affects applications honoring system proxy. | Cleans proxy on exit, crash recovery via `marker.rs`. |
| **TUN** | Packet-level routing via TUN interface + nftables kill switch. | Full system traffic interception; fails closed if kill switch enabled. | Flushes nftables table, purges iproute2 rules (`proto 177`). |

- **Coexisting VPNs:** In TUN mode, other network interfaces (e.g. WireGuard) are detected unprivileged and passed to the engine. `passthrough.rs` installs policy rules to route VPN endpoint and subnet traffic directly via the physical interface, preventing connection loops.
- **Loop Guards:** Four immutable routing rules are generated into every sing-box config ahead of user rules to guarantee the SNI forwarder itself and the GUI probe endpoints never route through the tunnel.

---

## 6. Pre-flight Checklist for Agents

Before completing any task or proposing changes:

1. [ ] **Did you run commands with `rtk`?** (e.g., `rtk npm test`, `rtk cargo check`).
2. [ ] **Are `./docs/*` files untouched in Git?** Verify with `rtk git status`.
3. [ ] **Did you touch visual elements?** Ensure alignment with `DESIGN.md` tokens in `src/theme.css`.
4. [ ] **Did you alter logging or IPC?** Verify the streaming gate in `ActivitySection.tsx` / `logbuf.rs` is intact.
5. [ ] **Did you modify proxy routing?** Verify system proxy alterations remain strictly in `src-tauri/src/sysproxy/` (GUI process).
6. [ ] **Did you update rule validation?** If modifying rule grammar, update both `src-tauri/src/tunnel/rules.rs` and `src/lib/rules.ts`, and test with `src/lib/rules.fixtures.json`.
7. [ ] **Are commit messages conforming?** Conventional commit format with emojis, and NO `Co-Authored-By` lines.
