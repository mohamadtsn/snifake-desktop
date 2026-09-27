mod auth;
mod config;
#[cfg(windows)]
mod elevate_windows;
mod engine_host;
mod logbuf;
mod profiles;
mod tray;
mod tunnel;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener, Manager};

use engine_host::EngineHost;
use logbuf::LogBuffer;
use profiles::Store;
use snifake_engine::proto::Profile;

pub(crate) struct AppState {
    pub(crate) engine: Mutex<EngineHost>,
    pub(crate) store: Mutex<Store>,
    pub(crate) tunnels: Mutex<tunnel::model::TunnelStore>,
    pub(crate) logs: Arc<LogBuffer>,
}

#[tauri::command]
fn list_profiles(state: tauri::State<AppState>) -> Store {
    state.store.lock().unwrap().clone()
}

#[tauri::command]
fn save_profile(state: tauri::State<AppState>, profile: Profile) -> Result<Store, String> {
    let mut store = state.store.lock().unwrap();
    profiles::upsert(&mut store, profile);
    profiles::save(&store)?;
    Ok(store.clone())
}

#[tauri::command]
fn delete_profile(state: tauri::State<AppState>, id: String) -> Result<Store, String> {
    let mut store = state.store.lock().unwrap();
    profiles::delete(&mut store, &id)?;
    profiles::save(&store)?;
    Ok(store.clone())
}

#[tauri::command]
fn set_active_profile(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
) -> Result<Store, String> {
    let mut store = state.store.lock().unwrap();
    profiles::set_active(&mut store, &id)?;
    profiles::save(&store)?;
    let snapshot = store.clone();
    let name = profiles::active(&store)
        .map(|p| p.name.clone())
        .unwrap_or_default();
    drop(store);

    let engine_state = state.engine.lock().unwrap().state();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || tray::update_tray(&handle, &engine_state, &name));
    Ok(snapshot)
}

/// Starts the given profile. If something is already running the engine
/// stops it first — the switch happens inside the already-authenticated
/// helper, so it costs no new password prompt.
#[tauri::command]
fn start_proxy(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
) -> Result<(), String> {
    let profile = {
        let store = state.store.lock().unwrap();
        store
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| format!("no profile with id '{id}'"))?
    };
    state.engine.lock().unwrap().start(&app, &profile)
}

/// The tunnel's outbound dials this listener, so it goes first. Without
/// that order the core is left dialling something that is gone, and the
/// user sees a tunnel fault they did not cause.
#[tauri::command]
fn stop_proxy(app: tauri::AppHandle, state: tauri::State<AppState>) {
    let mut engine = state.engine.lock().unwrap();
    engine.tunnel_stop();
    engine.stop(&app);
}

/// The frontend only wants log traffic while Activity is open; with it
/// closed, lines still accumulate in the buffer but no IPC happens.
#[tauri::command]
fn set_log_streaming(state: tauri::State<AppState>, enabled: bool) {
    state.logs.set_streaming(enabled);
}

/// Per-packet logging. Off by default — the Go implementation logged every
/// packet and that alone was enough to peg a core during a download.
#[tauri::command]
fn set_verbose(state: tauri::State<AppState>, on: bool) {
    state.engine.lock().unwrap().set_verbose(on);
}

#[tauri::command]
fn get_log_buffer(state: tauri::State<AppState>) -> Vec<String> {
    state.logs.snapshot()
}

/// Called by the frontend immediately before the window is destroyed.
#[tauri::command]
fn shutdown_engine(state: tauri::State<AppState>) {
    state.engine.lock().unwrap().shutdown();
}

/// `async` on purpose: it reads and digests the installed core, which is
/// tens of megabytes, and a synchronous command runs on the main thread.
#[tauri::command]
async fn core_status() -> tunnel::download::CoreStatus {
    tunnel::download::status()
}

#[tauri::command]
async fn download_core(app: tauri::AppHandle) -> Result<(), String> {
    tunnel::download::download_core(app).await
}

/// The escape hatch for a user who cannot reach the download server —
/// which, for this application's audience, is a substantial share of them.
/// It goes through the same checksum verification as the download.
/// Split from the command so the digest comparison is testable without a
/// running app.
///
/// Two outcomes that must not collapse into one: `Err` means the check could
/// not be made (no file, unreadable, no pin for this platform) and `Ok(false)`
/// means it was made and the binary is not the pinned one. A user whose core
/// vanished needs a different sentence from a user whose core was swapped.
fn verify_binary_at(path: &std::path::Path) -> Result<bool, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Could not read the core binary at {}: {e}", path.display()))?;
    let pinned = snifake_engine::corepin::binary_sha256()
        .ok_or_else(|| "No digest pin exists for this platform".to_string())?;
    Ok(tunnel::core::sha256_hex(&bytes) == pinned)
}

/// The GUI's convenience check. The guarantee is still the engine's: it
/// re-checks this same digest before it executes the binary as root, because
/// the path it is handed comes from an unprivileged process and points into a
/// user-writable directory.
#[tauri::command]
fn verify_core() -> Result<bool, String> {
    verify_binary_at(&tunnel::core::core_binary())
}

/// Preferences > General > "Colorize Menu Bar Icon by Status".
///
/// Redraws immediately rather than at the next state change, so the toggle
/// shows its own effect.
#[tauri::command]
fn set_tray_colorize(app: tauri::AppHandle, state: tauri::State<AppState>, on: bool) {
    tray::set_colorize(on);
    let engine_state = state.engine.lock().unwrap().state();
    let name = {
        let store = state.store.lock().unwrap();
        profiles::active(&store)
            .map(|p| p.name.clone())
            .unwrap_or_default()
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || tray::update_tray(&handle, &engine_state, &name));
}

#[tauri::command]
fn import_core(path: String) -> Result<(), String> {
    tunnel::core::install_from_archive(std::path::Path::new(&path)).map(|_| ())
}

#[tauri::command]
fn list_tunnels(state: tauri::State<AppState>) -> tunnel::model::TunnelStore {
    state.tunnels.lock().unwrap().clone()
}

#[tauri::command]
fn save_tunnel(
    state: tauri::State<AppState>,
    profile: tunnel::model::TunnelProfile,
) -> Result<tunnel::model::TunnelStore, String> {
    let mut store = state.tunnels.lock().unwrap();
    tunnel::model::upsert(&mut store, profile);
    tunnel::model::save(&store)?;
    Ok(store.clone())
}

#[tauri::command]
fn delete_tunnel(
    state: tauri::State<AppState>,
    id: String,
) -> Result<tunnel::model::TunnelStore, String> {
    let mut store = state.tunnels.lock().unwrap();
    tunnel::model::delete(&mut store, &id);
    tunnel::model::save(&store)?;
    Ok(store.clone())
}

#[tauri::command]
fn set_active_tunnel(
    state: tauri::State<AppState>,
    id: String,
) -> Result<tunnel::model::TunnelStore, String> {
    let mut store = state.tunnels.lock().unwrap();
    tunnel::model::set_active(&mut store, &id)?;
    tunnel::model::save(&store)?;
    Ok(store.clone())
}

/// Mode, proxy port and the three lists, saved as one unit — they are
/// edited on one screen and validated together.
///
/// `rename_all` is not decoration: `#[tauri::command]` lower-camel-cases
/// every argument key by default, so without it this command expects
/// `proxyHost`/`proxyPort` while every call site in the frontend sends
/// `proxy_host`/`proxy_port`, and every save is rejected before it runs.
/// The test at the foot of this file pins that down for the next one.
#[tauri::command(rename_all = "snake_case")]
fn save_routing(
    state: tauri::State<AppState>,
    mode: tunnel::model::TunnelMode,
    proxy_host: String,
    proxy_port: u16,
    routing: tunnel::model::Routing,
) -> Result<tunnel::model::TunnelStore, String> {
    // Reject a rule the core would refuse, here, while the user is still
    // looking at the field they typed it into.
    for (name, lines) in [
        ("Block", &routing.block),
        ("Bypass", &routing.bypass),
        ("Proxy", &routing.proxy),
    ] {
        if let Err(errs) = tunnel::rules::parse_list(lines) {
            let (i, msg) = &errs[0];
            return Err(format!("{name} list, line {}: {msg}", i + 1));
        }
    }
    let mut store = state.tunnels.lock().unwrap();
    store.mode = mode;
    store.proxy_host = proxy_host;
    store.proxy_port = proxy_port;
    store.routing = routing;
    tunnel::model::save(&store)?;
    Ok(store.clone())
}

#[derive(serde::Serialize)]
struct ImportResult {
    profile: tunnel::model::TunnelProfile,
    warnings: Vec<String>,
    source_address: String,
    source_port: u16,
}

#[tauri::command]
fn import_tunnel(text: String) -> Result<ImportResult, String> {
    let got = tunnel::import::import(&text)?;
    Ok(ImportResult {
        profile: got.profile,
        warnings: got.warnings,
        source_address: got.source_address,
        source_port: got.source_port,
    })
}

#[tauri::command]
fn export_tunnel_uri(state: tauri::State<AppState>, id: String) -> Result<String, String> {
    let tunnels = state.tunnels.lock().unwrap();
    let profile = tunnels
        .tunnels
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("no tunnel with id '{id}'"))?;
    let store = state.store.lock().unwrap();
    let link = profiles::active(&store).ok_or("no active SNI profile")?;
    Ok(tunnel::import::export_uri(
        profile,
        &link.listen_host,
        link.listen_port,
    ))
}

/// Everything that has to be true before a tunnel can start, checked in
/// one place and reported as one message the UI can show verbatim.
#[tauri::command]
fn start_tunnel(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let (profile, tunnels) = {
        let tunnels = state.tunnels.lock().unwrap();
        let profile = tunnels
            .tunnels
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or_else(|| format!("no tunnel with id '{id}'"))?;
        (profile, tunnels.clone())
    };

    if !tunnel::core::is_installed() {
        return Err("The sing-box core is not installed yet.".into());
    }

    let link = {
        let store = state.store.lock().unwrap();
        profiles::active(&store).cloned().ok_or("no active SNI profile")?
    };

    // Bind and release, so a clash is reported against the field the user
    // can change rather than surfacing as an opaque core failure. The
    // engine maps sing-box's own bind error to the same message, because
    // the gap between this check and the spawn is real.
    let bind = (tunnels.proxy_host.as_str(), tunnels.proxy_port);
    match std::net::TcpListener::bind(bind) {
        Ok(l) => drop(l),
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            return Err(format!(
                "Port {} is already in use. Choose another port.",
                tunnels.proxy_port
            ));
        }
        Err(e) => return Err(format!("Cannot listen on port {}: {e}", tunnels.proxy_port)),
    }

    let config = tunnel::generate::generate(&profile, &tunnels, &link)?;
    let spec = snifake_engine::proto::TunnelSpec {
        config,
        core_path: tunnel::core::core_binary().to_string_lossy().into_owned(),
        ready_probe: snifake_engine::proto::ReadyProbe::TcpAccept {
            host: tunnels.proxy_host.clone(),
            port: tunnels.proxy_port,
        },
        connect_ip: link.connect_ip.clone(),
        connect_port: link.connect_port,
        listen_host: link.listen_host.clone(),
    };
    state.engine.lock().unwrap().tunnel_start(spec)
}

#[tauri::command]
fn stop_tunnel(state: tauri::State<AppState>) {
    state.engine.lock().unwrap().tunnel_stop();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let logs = Arc::new(LogBuffer::new());
    let store = profiles::load();
    let active_name = profiles::active(&store)
        .map(|p| p.name.clone())
        .unwrap_or_default();

    let mut builder = tauri::Builder::default();

    // Must be registered before every other plugin. Without it, launching
    // the app again from the desktop launcher starts a second process that
    // would spawn a second *elevated* engine on the same port.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
        // Preferences > General > "Launch at Login". The plugin owns the
        // platform mechanism (a LaunchAgent on macOS, the registry Run key on
        // Windows, an XDG autostart .desktop on Linux); the frontend only
        // calls its enable/disable/isEnabled.
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
        builder = builder
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_dialog::init());
    }

    builder
        .manage(AppState {
            engine: Mutex::new(EngineHost::new(logs.clone())),
            store: Mutex::new(store),
            tunnels: Mutex::new(tunnel::model::load()),
            logs: logs.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            save_profile,
            delete_profile,
            set_active_profile,
            start_proxy,
            stop_proxy,
            set_log_streaming,
            set_verbose,
            get_log_buffer,
            shutdown_engine,
            core_status,
            verify_core,
            set_tray_colorize,
            download_core,
            import_core,
            list_tunnels,
            save_tunnel,
            delete_tunnel,
            set_active_tunnel,
            save_routing,
            import_tunnel,
            export_tunnel_uri,
            start_tunnel,
            stop_tunnel,
        ])
        .setup(move |app| {
            tray::setup_tray(app.handle(), &active_name)?;
            logs.clone().spawn_flusher(app.handle().clone());
            for (from, to) in [
                ("tray-start-requested", "frontend-start-requested"),
                ("tray-stop-requested", "frontend-stop-requested"),
                ("tray-quit-requested", "frontend-quit-requested"),
            ] {
                let handle = app.handle().clone();
                app.listen(from, move |_| {
                    let _ = handle.emit(to, ());
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides to the tray. Quitting is reachable only from the
            // tray's Exit, so there is exactly one path that can stop a
            // running proxy by accident.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod verify_tests {
    #[test]
    fn a_missing_binary_is_an_error_not_a_false() {
        // verify_binary_at distinguishes "cannot check" from "checked and
        // wrong": a user whose core file vanished needs a different sentence
        // from a user whose core file was swapped.
        let path = std::path::Path::new("/nonexistent/snifake-core");
        assert!(super::verify_binary_at(path).is_err());
    }

    #[test]
    fn a_digest_that_does_not_match_the_pin_is_false_not_an_error() {
        let dir = std::env::temp_dir().join("snifake-verify-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("core");
        std::fs::write(&path, b"not the pinned binary").unwrap();
        // With a pin present for this target this is a clean `false`; with no
        // pin there is nothing to compare against and it is an error.
        match super::verify_binary_at(&path) {
            Ok(v) => assert!(!v),
            Err(e) => assert!(e.contains("pin"), "unexpected error: {e}"),
        }
        let _ = std::fs::remove_file(&path);
    }
}

#[cfg(test)]
mod command_argument_case_tests {
    /// `#[tauri::command]` lower-camel-cases every argument key by default
    /// (`tauri-macros`'s `ArgumentCase::Camel`), so a command with a
    /// multi-word parameter silently stops accepting the snake_case payload
    /// the whole frontend sends, and every call fails with
    /// `missing required key <camelCase>`.
    ///
    /// This scans this file rather than testing one command, because the
    /// failure is invisible at the call site and costs nothing until
    /// somebody adds the next two-word argument.
    #[test]
    fn every_command_with_a_multi_word_argument_opts_into_snake_case() {
        let source = include_str!("lib.rs");
        let mut offenders = Vec::new();

        for (index, _) in source.match_indices("#[tauri::command") {
            let rest = &source[index..];
            let attribute_end = rest.find(']').expect("an attribute is closed");
            let attribute = &rest[..attribute_end];
            let body = &rest[attribute_end..];
            let signature_end = body.find(')').unwrap_or(body.len());
            let signature = &body[..signature_end];

            let name = signature
                .split("fn ")
                .nth(1)
                .and_then(|s| s.split('(').next())
                .unwrap_or("<unknown>");

            let multi_word = signature.lines().any(|line| {
                let line = line.trim();
                match line.split_once(':') {
                    // Skip the injected `app: tauri::AppHandle` and
                    // `state: tauri::State<..>`, which are not wire keys.
                    Some((key, _)) if key == "app" || key == "state" => false,
                    Some((key, _)) => {
                        !key.is_empty()
                            && key.chars().all(|c| c.is_ascii_lowercase() || c == '_')
                            && key.contains('_')
                    }
                    None => false,
                }
            });

            if multi_word && !attribute.contains("rename_all = \"snake_case\"") {
                offenders.push(name.to_string());
            }
        }

        assert!(
            offenders.is_empty(),
            "these commands take a multi-word argument but do not opt into \
             snake_case, so the frontend's payload will be rejected: {offenders:?}"
        );
    }
}
