use image::{Rgba, RgbaImage};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The state palette, straight from `theme.css` — the same four values the
/// window shows, so the tray and the console never disagree about a colour.
fn state_color(state: &str) -> [u8; 3] {
    match state {
        "starting" => [0xff, 0xb2, 0x24], // --color-amber
        "running" => [0x4e, 0xd1, 0x7f],  // --color-live
        "error" => [0xff, 0x5c, 0x4d],    // --color-st-error
        _ => [0x6a, 0x6f, 0x76],          // --color-st-stopped
    }
}

/// Below this chroma a pixel belongs to the plate rather than to the trace.
///
/// The graphite family is not strictly neutral — it is cooled towards blue,
/// and its widest stop, the bevel highlight `#4a5058`, carries a chroma of
/// 14. The threshold sits above every colour the plate is drawn from and far
/// below the trace's 131, which is the margin the test at the foot of this
/// file pins down.
const LIT_CHROMA: u8 = 20;

/// Re-lights the icon's trace in the colour of `state`.
///
/// The app icon is a lit trace on a graphite plate, so the honest way to show
/// state in the tray is the one a real panel uses: the same lamp, a different
/// colour. This replaces a status dot painted over the icon's corner — at the
/// 22px a tray actually renders, that dot was a few pixels of colour, while
/// the whole glyph changing is legible at a glance.
///
/// Only the plate is neutral, so chroma alone separates trace from
/// background. Each lit pixel keeps its saturation and brightness — which is
/// what preserves the gradient, the antialiased edges and the bloom — and
/// takes the state's hue.
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

    relight(&mut img, state_color(state));
    Image::new_owned(img.into_raw(), base_icon.width(), base_icon.height())
}

fn relight(img: &mut RgbaImage, lit: [u8; 3]) {
    for pixel in img.pixels_mut() {
        let Rgba([r, g, b, a]) = *pixel;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        if max - min < LIT_CHROMA {
            continue;
        }
        // HSV with the hue swapped: value is max/255, saturation is
        // 1 - min/max, and the rest is the definition of the model.
        let value = max as f32 / 255.0;
        let white = min as f32 / max as f32;
        let mix = |channel: u8| {
            let tinted = channel as f32 * (1.0 - white) + 255.0 * white;
            (tinted * value).round().clamp(0.0, 255.0) as u8
        };
        *pixel = Rgba([mix(lit[0]), mix(lit[1]), mix(lit[2]), a]);
    }
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
#[cfg(test)]
mod tests {
    use super::*;

    /// The plate is neutral by construction, so anything without chroma is
    /// background and must survive untouched — otherwise the state colour
    /// would wash over the whole icon instead of the trace.
    #[test]
    fn the_graphite_plate_is_left_exactly_as_drawn() {
        // Every colour icon.svg draws the plate from, widest chroma first.
        let plate = [
            Rgba([0x4a, 0x50, 0x58, 255]), // bevel highlight, chroma 14
            Rgba([0x2d, 0x31, 0x37, 255]), // bevel mid, chroma 10
            Rgba([0x1c, 0x20, 0x25, 255]), // top of the plate gradient
            Rgba([0x12, 0x14, 0x17, 255]), // middle
            Rgba([0x08, 0x09, 0x0b, 255]), // bottom
            Rgba([0, 0, 0, 0]),            // outside the rounded corner
        ];
        let mut img = RgbaImage::from_pixel(plate.len() as u32, 1, Rgba([0, 0, 0, 0]));
        for (x, px) in plate.iter().enumerate() {
            img.put_pixel(x as u32, 0, *px);
        }
        relight(&mut img, state_color("running"));
        for (x, px) in plate.iter().enumerate() {
            assert_eq!(img.get_pixel(x as u32, 0), px, "plate pixel {x} was tinted");
        }
    }

    /// A fully saturated trace pixel becomes the state colour outright, and
    /// the alpha that carries the antialiased edge is never touched.
    #[test]
    fn a_lit_pixel_takes_the_state_colour() {
        for state in ["stopped", "starting", "running", "error"] {
            let lit = state_color(state);
            let mut img = RgbaImage::from_pixel(1, 1, Rgba([0x00, 0xff, 0x00, 0x80]));
            relight(&mut img, lit);
            let Rgba([r, g, b, a]) = *img.get_pixel(0, 0);
            assert_eq!([r, g, b], lit, "{state}");
            assert_eq!(a, 0x80, "{state} changed the alpha");
        }
    }

    /// The trace is a gradient with a bloom behind it, so relighting has to
    /// keep each pixel's own brightness and saturation — a flat fill would
    /// erase the shading and the soft edge with it.
    #[test]
    fn shading_survives_the_change_of_hue() {
        // Half-bright, half-saturated green: value 0.5, white 0.5.
        let mut img = RgbaImage::from_pixel(1, 1, Rgba([0x40, 0x80, 0x40, 255]));
        relight(&mut img, [0xff, 0x00, 0x00]);
        let Rgba([r, g, b, _]) = *img.get_pixel(0, 0);
        assert_eq!(r, 0x80, "the lit channel keeps the pixel's value");
        assert_eq!([g, b], [0x40, 0x40], "the pixel keeps its saturation");
    }

    #[test]
    fn every_state_has_its_own_colour() {
        let mut seen = vec![];
        for state in ["stopped", "starting", "running", "error"] {
            let color = state_color(state);
            assert!(!seen.contains(&color), "{state} repeats another state");
            seen.push(color);
        }
        // Anything the engine has not defined reads as stopped, not as the
        // last state that happened to be set.
        assert_eq!(state_color("nonsense"), state_color("stopped"));
    }
}
