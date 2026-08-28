use image::{Rgba, RgbaImage};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

fn state_color(state: &str) -> Rgba<u8> {
    match state {
        "starting" => Rgba([243, 156, 18, 255]),
        "running" => Rgba([46, 204, 113, 255]),
        "error" => Rgba([231, 76, 60, 255]),
        _ => Rgba([149, 165, 166, 255]),
    }
}

/// Loads the base app icon and paints a colored status badge over its
/// bottom-right corner, mirroring `icons.py::make_tray_icon`.
pub fn build_tray_icon(app: &AppHandle, state: &str) -> Image<'static> {
    let base_icon = app
        .default_window_icon()
        .expect("default window icon must be configured in tauri.conf.json");
    let mut img = RgbaImage::from_raw(
        base_icon.width(),
        base_icon.height(),
        base_icon.rgba().to_vec(),
    )
    .expect("icon buffer has valid dimensions");

    let size = img.width().min(img.height());
    let badge_d = (size as f32 * 0.36) as i64;
    let cx = img.width() as i64 - badge_d / 2 - 2;
    let cy = img.height() as i64 - badge_d / 2 - 2;
    let r = badge_d / 2;
    let color = state_color(state);

    for y in (cy - r)..(cy + r) {
        for x in (cx - r)..(cx + r) {
            if x < 0 || y < 0 || x >= img.width() as i64 || y >= img.height() as i64 {
                continue;
            }
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= r * r {
                img.put_pixel(x as u32, y as u32, color);
            }
        }
    }

    Image::new_owned(img.into_raw(), base_icon.width(), base_icon.height())
}

/// The three menu items that change at runtime, kept so the menu can be
/// mutated in place.
///
/// The alternative — rebuilding the whole `Menu` and calling `set_menu` on
/// every state change — is what this replaced, and it is why the tray items
/// rendered blank under GNOME. Replacing the menu bumps the DBusMenu
/// revision and hands the shell a fresh set of item ids; the labels are all
/// correct on the bus (verified with `GetLayout`), but the appindicator
/// extension keeps the menu it already built and draws the new ids with no
/// text. Mutating properties instead emits `ItemsPropertiesUpdated`, which
/// is the path every DBusMenu consumer actually implements.
pub struct TrayMenu {
    current: MenuItem<Wry>,
    start: MenuItem<Wry>,
    stop: MenuItem<Wry>,
}

fn start_enabled(state: &str) -> bool {
    state == "stopped" || state == "error"
}

fn stop_enabled(state: &str) -> bool {
    state == "running" || state == "starting"
}

pub fn setup_tray(app: &AppHandle, profile_name: &str) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    // Disabled: a label, not a control. Tells you which profile Start acts on.
    let current = MenuItem::with_id(
        app,
        "current",
        format!("Profile: {profile_name}"),
        false,
        None::<&str>,
    )?;
    let start = MenuItem::with_id(app, "start", "Start Proxy", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop Proxy", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&show, &sep1, &current, &start, &stop, &sep2, &quit],
    )?;
    app.manage(TrayMenu {
        current,
        start,
        stop,
    });

    let icon = build_tray_icon(app, "stopped");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Snifake — Stopped")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let window = app.get_webview_window("main");
            match event.id.as_ref() {
                "show" => {
                    if let Some(w) = &window {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "start" => {
                    let _ = app.emit("tray-start-requested", ());
                }
                "stop" => {
                    let _ = app.emit("tray-stop-requested", ());
                }
                "quit" => {
                    // The confirm dialog lives in the window, so raise it
                    // first — otherwise a tray-only user answers a question
                    // they never see.
                    if let Some(w) = &window {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("tray-quit-requested", ());
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

pub fn update_tray(app: &AppHandle, state: &str, profile_name: &str) {
    if let Some(items) = app.try_state::<TrayMenu>() {
        let _ = items.current.set_text(format!("Profile: {profile_name}"));
        let _ = items.start.set_enabled(start_enabled(state));
        let _ = items.stop.set_enabled(stop_enabled(state));
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(build_tray_icon(app, state)));
        let label = format!(
            "Snifake — {}{} ({profile_name})",
            &state[..1].to_uppercase(),
            &state[1..]
        );
        let _ = tray.set_tooltip(Some(label));
    }
}