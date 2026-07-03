mod auth;
mod autostart;
mod config;
mod proxy;
mod tray;

use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager};

use config::Config;
use proxy::ProxyManager;

struct AppState {
    proxy: Mutex<ProxyManager>,
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

#[tauri::command]
fn get_autostart_enabled() -> bool {
    autostart::is_autostart_enabled()
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
    let exe = app
        .path()
        .resolve("", tauri::path::BaseDirectory::Executable)
        .map_err(|e| e.to_string())?;
    autostart::toggle_autostart(enable, &exe.to_string_lossy())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            proxy: Mutex::new(ProxyManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            start_proxy,
            stop_proxy,
            get_autostart_enabled,
            set_autostart,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
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