mod auth;
mod config;
mod logbuf;
mod proxy;
mod tray;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener, Manager};

use config::Config;
use logbuf::LogBuffer;
use proxy::ProxyManager;

struct AppState {
    proxy: Mutex<ProxyManager>,
    logs: Arc<LogBuffer>,
}

#[tauri::command]
fn load_config() -> Config {
    config::load_config()
}

#[tauri::command]
fn save_config(cfg: Config) -> Result<(), String> {
    config::save_config(&cfg)
}

#[tauri::command]
fn start_proxy(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    cfg: Config,
) -> Result<(), String> {
    state.proxy.lock().unwrap().start(&app, &cfg);
    let current_state = state.proxy.lock().unwrap().state();
    // Tray icon/menu mutation must happen on the GTK main thread on Linux —
    // calling it from this command's worker thread intermittently corrupts
    // the tray menu (blank/missing item labels).
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        tray::update_tray(&handle, &current_state);
    });
    Ok(())
}

#[tauri::command]
fn stop_proxy(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    state.proxy.lock().unwrap().stop(&app);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        tray::update_tray(&handle, "stopped");
    });
    Ok(())
}

/// The frontend only wants log traffic while the Activity section is open;
/// with it closed, lines still accumulate in the buffer but no IPC happens.
#[tauri::command]
fn set_log_streaming(state: tauri::State<AppState>, enabled: bool) {
    state.logs.set_streaming(enabled);
}

/// Backfill so opening Activity shows recent history, not an empty panel.
#[tauri::command]
fn get_log_buffer(state: tauri::State<AppState>) -> Vec<String> {
    state.logs.snapshot()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let logs = Arc::new(LogBuffer::new());

    let mut builder = tauri::Builder::default();

    // Must be registered before every other plugin. Without it, launching
    // the app again from the desktop launcher starts a second process that
    // would spawn a second *elevated* proxy on the same port.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(AppState {
            proxy: Mutex::new(ProxyManager::new(logs.clone())),
            logs: logs.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            start_proxy,
            stop_proxy,
            set_log_streaming,
            get_log_buffer,
        ])
        .setup(move |app| {
            tray::setup_tray(app.handle())?;
            logs.clone().spawn_flusher(app.handle().clone());
            let handle = app.handle().clone();
            app.listen("tray-start-requested", move |_| {
                let _ = handle.emit("frontend-start-requested", ());
            });
            let handle = app.handle().clone();
            app.listen("tray-stop-requested", move |_| {
                let _ = handle.emit("frontend-stop-requested", ());
            });
            let handle = app.handle().clone();
            app.listen("tray-quit-requested", move |_| {
                let _ = handle.emit("frontend-quit-requested", ());
            });
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