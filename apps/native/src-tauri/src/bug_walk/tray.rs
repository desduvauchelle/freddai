//! Menu bar item shown only while a bug walk is selecting or recording: "Stop bug walk" / "Cancel bug walk".
//! It calls the same stop/cancel code as the in-app commands, so the UI reacts through the normal state events.

use super::{bug_walk_cancel, emit, state, stop_blocking, StatePayload};
use crate::desktop::Host;
use serde_json::json;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ID: &str = "bug-walk";
const ID_STOP: &str = "bug-walk-stop";
const ID_CANCEL: &str = "bug-walk-cancel";

/// Current walk id and whether it is recording (vs. selecting), for the menu handlers.
static CURRENT: Mutex<Option<(String, bool)>> = Mutex::new(None);

fn current() -> Option<(String, bool)> {
    CURRENT.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn set_current(v: Option<(String, bool)>) {
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = v;
}

/// m:ss, e.g. 42.9 -> "0:42", 125 -> "2:05".
pub(super) fn format_elapsed(s: f64) -> String {
    let t = if s.is_finite() && s > 0.0 { s as u64 } else { 0 };
    format!("{}:{:02}", t / 60, t % 60)
}

/// Visible only while selecting or recording.
pub(super) fn visible_for(phase: &str) -> bool {
    matches!(phase, "selecting" | "recording")
}

pub(super) fn title_for(phase: &str, elapsed_s: Option<f64>) -> String {
    if phase == "recording" { format!("Rec {}", format_elapsed(elapsed_s.unwrap_or(0.0))) } else { "Pick…".to_string() }
}

/// Filled black circle with alpha edge, 44x44 (2x of 22pt); macOS tints it as a template image.
fn dot_icon() -> Image<'static> {
    const N: u32 = 44;
    let c = (N as f32 - 1.0) / 2.0;
    let r = 12.0f32;
    let mut px = Vec::with_capacity((N * N * 4) as usize);
    for y in 0..N {
        for x in 0..N {
            let d = ((x as f32 - c).powi(2) + (y as f32 - c).powi(2)).sqrt();
            let a = (r + 0.5 - d).clamp(0.0, 1.0);
            px.extend_from_slice(&[0, 0, 0, (a * 255.0) as u8]);
        }
    }
    Image::new_owned(px, N, N)
}

fn log_fail(event: &str, id: &str, err: &str) {
    eprintln!("{}", json!({"event": event, "id": id, "error": err}));
}

pub fn sync(app: &AppHandle, phase: &str, id: &str, elapsed_s: Option<f64>) {
    if !visible_for(phase) {
        if current().is_none() { return; }
        set_current(None);
        let a = app.clone();
        if let Err(e) = app.run_on_main_thread(move || { let _ = a.remove_tray_by_id(TRAY_ID); }) {
            log_fail("bug_walk.tray_remove_failed", id, &e.to_string());
        }
        return;
    }
    let recording = phase == "recording";
    set_current(Some((id.to_string(), recording)));
    let title = title_for(phase, elapsed_s);
    let a = app.clone();
    let walk_id = id.to_string();
    if let Err(e) = app.run_on_main_thread(move || {
        if let Some(tray) = a.tray_by_id(TRAY_ID) {
            let _ = tray.set_title(Some(title));
            // Selecting -> recording: rebuild the menu so "Stop" becomes enabled.
            if recording { if let Ok(m) = build_menu(&a, true) { let _ = tray.set_menu(Some(m)); } }
            return;
        }
        if let Err(e) = create(&a, &title, recording) {
            log_fail("bug_walk.tray_create_failed", &walk_id, &e);
        }
    }) {
        log_fail("bug_walk.tray_dispatch_failed", id, &e.to_string());
    }
}

fn build_menu(app: &AppHandle, recording: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let stop = MenuItem::with_id(app, ID_STOP, "Stop bug walk", recording, None::<&str>)?;
    let cancel = MenuItem::with_id(app, ID_CANCEL, "Cancel bug walk", true, None::<&str>)?;
    Menu::with_items(app, &[&stop, &cancel])
}

fn create(app: &AppHandle, title: &str, recording: bool) -> Result<(), String> {
    let menu = build_menu(app, recording).map_err(|e| e.to_string())?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(dot_icon())
        .icon_as_template(true)
        .title(title)
        .tooltip("Freddai bug walk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev: MenuEvent| match ev.id().as_ref() {
            ID_STOP => stop(app),
            ID_CANCEL => cancel(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                stop(tray.app_handle());
            }
        })
        .build(app)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn stop(app: &AppHandle) {
    let Some((id, recording)) = current() else { return };
    if !recording { return; }
    let app = app.clone();
    std::thread::spawn(move || {
        let root = app.state::<Host>().root.clone();
        if let Err(e) = stop_blocking(app.clone(), root, id.clone()) {
            log_fail("bug_walk.tray_stop_failed", &id, &e);
            emit(&app, StatePayload { error: Some(e), ..state(&id, "error") });
        }
    });
}

fn cancel(app: &AppHandle) {
    let Some((id, _)) = current() else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let res = {
            let h = app.state::<Host>();
            bug_walk_cancel(app.clone(), h, id.clone()).await
        };
        if let Err(e) = res {
            log_fail("bug_walk.tray_cancel_failed", &id, &e);
            emit(&app, StatePayload { error: Some(e), ..state(&id, "error") });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_m_ss() {
        assert_eq!(format_elapsed(0.0), "0:00");
        assert_eq!(format_elapsed(42.9), "0:42");
        assert_eq!(format_elapsed(125.0), "2:05");
        assert_eq!(format_elapsed(-3.0), "0:00");
        assert_eq!(format_elapsed(f64::NAN), "0:00");
    }

    #[test]
    fn visibility_by_phase() {
        assert!(visible_for("selecting"));
        assert!(visible_for("recording"));
        for p in ["stopped", "cancelled", "error", "done", "launching"] { assert!(!visible_for(p), "{p}"); }
        assert_eq!(title_for("selecting", None), "Pick…");
        assert_eq!(title_for("recording", Some(61.0)), "Rec 1:01");
    }
}
