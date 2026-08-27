mod auth;
mod config;
#[cfg(windows)]
mod elevate_windows;
mod engine_host;
mod logbuf;
mod profiles;
mod tray;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener, Manager};

use engine_host::EngineHost;
use logbuf::LogBuffer;
use profiles::Store;
use snifake_engine::proto::Profile;

pub(crate) struct AppState {
    pub(crate) engine: Mutex<EngineHost>,
    pub(crate) store: Mutex<Store>,
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

#[tauri::command]
fn stop_proxy(app: tauri::AppHandle, state: tauri::State<AppState>) {
    state.engine.lock().unwrap().stop(&app);
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
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .manage(AppState {
            engine: Mutex::new(EngineHost::new(logs.clone())),
            store: Mutex::new(store),
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("frontend-quit-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
