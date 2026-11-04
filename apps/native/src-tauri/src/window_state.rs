//! Local native window geometry, independent of accounts and webview storage.
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::Duration};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct Rect { x: i32, y: i32, width: u32, height: u32 }

fn fits(r: Rect, area: Rect) -> bool {
    r.width > 0 && r.height > 0 && r.x >= area.x && r.y >= area.y
        && i64::from(r.x) + i64::from(r.width) <= i64::from(area.x) + i64::from(area.width)
        && i64::from(r.y) + i64::from(r.height) <= i64::from(area.y) + i64::from(area.height)
}

fn recover(r: Rect, areas: &[Rect], primary: usize) -> Rect {
    if areas.iter().any(|a| fits(r, *a)) { return r; }
    let Some(area) = areas.get(primary).or_else(|| areas.first()) else { return r; };
    let width = r.width.max(1).min(area.width);
    let height = r.height.max(1).min(area.height);
    Rect { x: area.x + ((area.width - width) / 2) as i32,
        y: area.y + ((area.height - height) / 2) as i32, width, height }
}

fn geometry(window: &WebviewWindow) -> Option<Rect> {
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(Rect { x: pos.x, y: pos.y, width: size.width, height: size.height })
}

fn areas(window: &WebviewWindow) -> Option<(Vec<Rect>, usize)> {
    let monitors = window.available_monitors().ok()?;
    let primary = window.primary_monitor().ok().flatten();
    let index = monitors.iter().position(|m| primary.as_ref().is_some_and(|p| p.position() == m.position())).unwrap_or(0);
    Some((monitors.iter().map(|m| {
        let a = m.work_area();
        Rect { x: a.position.x, y: a.position.y, width: a.size.width, height: a.size.height }
    }).collect(), index))
}

fn apply(window: &WebviewWindow, rect: Rect) {
    // Saved bounds include decorations; set_size takes the inner size.
    let border = window.outer_size().ok().zip(window.inner_size().ok())
        .map(|(o, i)| (o.width.saturating_sub(i.width), o.height.saturating_sub(i.height)))
        .unwrap_or_default();
    let _ = window.set_size(PhysicalSize::new(rect.width.saturating_sub(border.0).max(1), rect.height.saturating_sub(border.1).max(1)));
    let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
}

pub fn install(window: WebviewWindow, root: PathBuf) {
    let path = root.join("window-state.json");
    let saved = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<Rect>(&bytes).ok())
        .filter(|r| r.width > 0 && r.height > 0);
    let mut previous_areas = areas(&window).unwrap_or_default();
    if let Some(rect) = saved.or_else(|| geometry(&window)) {
        apply(&window, recover(rect, &previous_areas.0, previous_areas.1));
    }
    let _ = window.show();
    // Polling also detects display disconnection while the app is idle. Do not
    // fight intentional window dragging: only recover when the displays change.
    std::thread::spawn(move || {
        let mut last_saved = saved;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if window.is_minimized().unwrap_or(true) || window.is_maximized().unwrap_or(true)
                || window.is_fullscreen().unwrap_or(true) { continue; }
            let Some(mut rect) = geometry(&window) else { break; };
            let Some(current_areas) = areas(&window) else { continue; };
            if current_areas != previous_areas {
                rect = recover(rect, &current_areas.0, current_areas.1);
                apply(&window, rect);
                previous_areas = current_areas.clone();
            }
            if !current_areas.0.is_empty() && Some(rect) != last_saved {
                let temporary = path.with_extension("json.tmp");
                if let Ok(bytes) = serde_json::to_vec(&rect) {
                    if fs::write(&temporary, bytes).is_ok() && fs::rename(&temporary, &path).is_ok() {
                        last_saved = Some(rect);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    const INTERNAL: Rect = Rect { x: 0, y: 25, width: 1440, height: 850 };
    #[test]
    fn keeps_visible_bounds_including_negative_display_coordinates() {
        let external = Rect { x: -1920, y: 0, width: 1920, height: 1080 };
        let r = Rect { x: -1800, y: 100, width: 1100, height: 760 };
        assert_eq!(recover(r, &[INTERNAL, external], 0), r);
    }
    #[test]
    fn disconnected_display_recenters_and_shrinks() {
        let r = Rect { x: 2000, y: 100, width: 1800, height: 1000 };
        assert_eq!(recover(r, &[INTERNAL], 0), INTERNAL);
    }
    #[test]
    fn partial_offscreen_window_is_centered_inside_work_area() {
        let r = Rect { x: 1300, y: -10, width: 1100, height: 760 };
        assert_eq!(recover(r, &[INTERNAL], 0), Rect { x: 170, y: 70, width: 1100, height: 760 });
        assert_eq!(recover(r, &[], 0), r);
    }
}
