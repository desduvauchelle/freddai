//! In-app updater. Checks the public release feed, tells the UI, and replaces the bundle on request.
//! The background `--host` process is detached (setsid) and runs from a cached copy of the bundle, so
//! restarting this window never stops agent threads; `desktop.rs` upgrades the host once it is idle.
use serde::Serialize;
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

pub const STATE_EVENT: &str = "updater://state";
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);
const RELEASES_URL: &str = "https://github.com/desduvauchelle/freddai/releases";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UpdateState {
    Idle,
    Checking,
    /// `manual` installs (Linux without AppImage) cannot self-update; the UI opens the release page.
    Available { version: String, notes: Option<String>, manual: bool },
    Downloading { version: String, downloaded: u64, total: Option<u64> },
    ReadyToRestart { version: String },
    /// Local (`pnpm native:install`) build that is ahead of releases: quiet status only, never an install offer.
    LocalBuild { published: String },
    Error { message: String },
}

/// Set by scripts/install-macos.sh (`FREDDAI_LOCAL_BUILD=1`); release CI leaves it unset.
pub const LOCAL_BUILD: bool = option_env!("FREDDAI_LOCAL_BUILD").is_some();

/// What to do with a newer remote version. Local builds never notify or show a banner;
/// only a manual check reports (quietly) what is published.
#[derive(Debug, PartialEq)]
pub enum Found { Offer, QuietStatus, Ignore }
pub fn on_newer_remote(local_build: bool, manual: bool) -> Found {
    match (local_build, manual) { (false, _) => Found::Offer, (true, true) => Found::QuietStatus, (true, false) => Found::Ignore }
}

/// Local builds log automatic feed failures without interrupting work. Explicit checks
/// and distributed builds still surface errors so a broken feed is diagnosable.
pub fn check_error_state(local_build: bool, manual: bool, message: String) -> UpdateState {
    if local_build && !manual { UpdateState::Idle } else { UpdateState::Error { message } }
}

/// Delay before check number `n` (0-based): shortly after launch, then every 12 hours.
pub fn check_delay(n: u64) -> Duration {
    if n == 0 { FIRST_CHECK_DELAY } else { CHECK_INTERVAL }
}

/// The Tauri updater can only replace an AppImage on Linux; other platforms always self-update.
pub fn self_update_supported(os: &str, appimage_env: Option<&str>) -> bool {
    os != "linux" || appimage_env.is_some_and(|v| !v.is_empty())
}

/// True exactly once per version: records the version and reports whether it was new.
pub fn first_time_for(last_notified: &mut Option<String>, version: &str) -> bool {
    if last_notified.as_deref() == Some(version) { return false; }
    *last_notified = Some(version.to_string());
    true
}

pub fn release_page(version: &str) -> String {
    format!("{RELEASES_URL}/tag/v{}", version.trim_start_matches('v'))
}

pub fn progress_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    total.filter(|t| *t > 0).map(|t| ((downloaded.min(t) * 100) / t) as u8)
}

#[derive(Clone)]
pub struct Updater {
    state: Arc<Mutex<UpdateState>>,
    pending: Arc<Mutex<Option<Update>>>,
    notified_file: PathBuf,
}

fn log(event: &str, detail: serde_json::Value) {
    eprintln!("{}", json!({"event": event, "detail": detail}));
}

impl Updater {
    pub fn new(root: &Path) -> Self {
        Self { state: Arc::new(Mutex::new(UpdateState::Idle)), pending: Arc::new(Mutex::new(None)), notified_file: root.join("updater-notified-version") }
    }
    fn set(&self, app: &AppHandle, next: UpdateState) {
        *self.state.lock().unwrap() = next.clone();
        if let Err(e) = app.emit(STATE_EVENT, next) {
            log("updater.emit_failed", json!(e.to_string()));
        }
    }
    fn fail(&self, app: &AppHandle, event: &str, reason: String) {
        log(event, json!({"reason": reason}));
        self.set(app, UpdateState::Error { message: reason });
    }
    fn check_failed(&self, app: &AppHandle, manual: bool, reason: String) {
        log("updater.check.error", json!({"reason": reason, "local_build": LOCAL_BUILD, "manual": manual}));
        self.set(app, check_error_state(LOCAL_BUILD, manual, reason));
    }
    fn notify_once(&self, app: &AppHandle, version: &str) {
        let mut last = fs::read_to_string(&self.notified_file).ok().map(|s| s.trim().to_string());
        if !first_time_for(&mut last, version) { return; }
        let sent = app.notification().builder().title("Freddai update")
            .body(format!("Freddai {version} is available \u{2014} open Freddai to update")).show();
        match sent {
            Ok(()) => {
                log("updater.notified", json!({"version": version}));
                if let Err(e) = fs::write(&self.notified_file, version) { log("updater.notified_unrecorded", json!(e.to_string())); }
            }
            Err(e) => log("updater.notify_failed", json!({"version": version, "reason": e.to_string()})),
        }
    }

    pub async fn check(&self, app: &AppHandle, manual: bool) {
        if matches!(*self.state.lock().unwrap(), UpdateState::Checking | UpdateState::Downloading { .. } | UpdateState::ReadyToRestart { .. }) { return; }
        self.set(app, UpdateState::Checking);
        log("updater.check.start", json!({"current": app.package_info().version.to_string()}));
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => return self.check_failed(app, manual, format!("Couldn't check for updates: {e}")),
        };
        match updater.check().await {
            Ok(None) => {
                log("updater.check.up_to_date", json!({}));
                *self.pending.lock().unwrap() = None;
                self.set(app, UpdateState::Idle);
            }
            Ok(Some(update)) => {
                let version = update.version.clone();
                match on_newer_remote(LOCAL_BUILD, manual) {
                    Found::Offer => {}
                    found => {
                        log("updater.check", json!({"local_build": true, "remote": version, "outcome": "skipped_notify"}));
                        *self.pending.lock().unwrap() = None;
                        self.set(app, if found == Found::QuietStatus { UpdateState::LocalBuild { published: version } } else { UpdateState::Idle });
                        return;
                    }
                }
                log("updater.check.available", json!({"version": version}));
                let manual = !self_update_supported(std::env::consts::OS, std::env::var("APPIMAGE").ok().as_deref());
                let notes = update.body.clone();
                *self.pending.lock().unwrap() = Some(update);
                self.set(app, UpdateState::Available { version: version.clone(), notes, manual });
                self.notify_once(app, &version);
            }
            Err(e) => self.check_failed(app, manual, format!("Couldn't check for updates: {e}")),
        }
    }

    async fn install(&self, app: &AppHandle) -> Result<(), String> {
        let update = self.pending.lock().unwrap().clone().ok_or("No update is available to install")?;
        let version = update.version.clone();
        log("updater.install.start", json!({"version": version}));
        let (mut downloaded, mut last_pct) = (0u64, None::<u8>);
        let (this, handle, v) = (self.clone(), app.clone(), version.clone());
        let result = update.download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let pct = progress_percent(downloaded, total);
                if pct != last_pct || total.is_none() {
                    last_pct = pct;
                    this.set(&handle, UpdateState::Downloading { version: v.clone(), downloaded, total });
                }
            },
            || {},
        ).await;
        match result {
            Ok(()) => {
                log("updater.install.done", json!({"version": version}));
                self.set(app, UpdateState::ReadyToRestart { version });
                Ok(())
            }
            Err(e) => {
                let message = format!("Couldn't install the update: {e}");
                self.fail(app, "updater.install.error", message.clone());
                Err(message)
            }
        }
    }
}

pub fn start(app: &AppHandle) {
    let root = match app.path().app_data_dir() { Ok(r) => r, Err(e) => return log("updater.disabled", json!(e.to_string())) };
    let updater = Updater::new(&root);
    app.manage(updater.clone());
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut n = 0u64;
        loop {
            tokio::time::sleep(check_delay(n)).await;
            updater.check(&handle, false).await;
            n += 1;
        }
    });
}

#[tauri::command]
pub fn updater_state(u: State<'_, Updater>) -> UpdateState { u.state.lock().unwrap().clone() }

#[tauri::command]
pub async fn check_for_updates(app: AppHandle, u: State<'_, Updater>) -> Result<UpdateState, String> {
    u.check(&app, true).await;
    Ok(u.state.lock().unwrap().clone())
}

/// Downloads and installs the pending update; the UI persists drafts, then calls `restart_app`.
#[tauri::command]
pub async fn install_update(app: AppHandle, u: State<'_, Updater>) -> Result<(), String> {
    u.install(&app).await
}

#[tauri::command]
pub fn restart_app(app: AppHandle, u: State<'_, Updater>) -> Result<(), String> {
    if !matches!(*u.state.lock().unwrap(), UpdateState::ReadyToRestart { .. }) {
        return Err("No installed update is waiting for a restart".into());
    }
    log("updater.restart", json!({}));
    app.restart()
}

#[tauri::command]
pub fn open_release_page(version: String) -> Result<(), String> {
    let url = release_page(&version);
    let (program, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") { ("open", vec![&url]) }
        else if cfg!(target_os = "windows") { ("cmd", vec!["/C", "start", "", &url]) }
        else { ("xdg-open", vec![&url]) };
    std::process::Command::new(program).args(args).spawn().map(|_| ())
        .map_err(|e| { log("updater.open_release_failed", json!(e.to_string())); format!("Couldn't open {url}: {e}") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_check_is_soon_then_twelve_hours() {
        assert_eq!(check_delay(0), Duration::from_secs(30));
        assert_eq!(check_delay(1), Duration::from_secs(43_200));
        assert_eq!(check_delay(99), Duration::from_secs(43_200));
    }
    #[test]
    fn linux_needs_appimage_other_platforms_always_self_update() {
        assert!(!self_update_supported("linux", None));
        assert!(!self_update_supported("linux", Some("")));
        assert!(self_update_supported("linux", Some("/tmp/Freddai.AppImage")));
        assert!(self_update_supported("macos", None));
        assert!(self_update_supported("windows", None));
    }
    #[test]
    fn notifies_once_per_version() {
        let mut last = None;
        assert!(first_time_for(&mut last, "0.2.0"));
        assert!(!first_time_for(&mut last, "0.2.0"));
        assert!(first_time_for(&mut last, "0.3.0"));
    }
    #[test]
    fn release_page_and_progress() {
        assert_eq!(release_page("v1.2.3"), "https://github.com/desduvauchelle/freddai/releases/tag/v1.2.3");
        assert_eq!(progress_percent(50, Some(200)), Some(25));
        assert_eq!(progress_percent(500, Some(200)), Some(100));
        assert_eq!(progress_percent(5, None), None);
    }
    #[test]
    fn local_builds_never_offer_or_notify() {
        assert_eq!(on_newer_remote(false, false), Found::Offer);
        assert_eq!(on_newer_remote(false, true), Found::Offer);
        assert_eq!(on_newer_remote(true, false), Found::Ignore);
        assert_eq!(on_newer_remote(true, true), Found::QuietStatus);
    }
    #[test]
    fn local_automatic_check_failures_stay_quiet_but_manual_and_release_failures_surface() {
        assert_eq!(check_error_state(true, false, "missing feed".into()), UpdateState::Idle);
        for (local, manual) in [(true, true), (false, false), (false, true)] {
            assert_eq!(check_error_state(local, manual, "missing feed".into()),
                UpdateState::Error { message: "missing feed".into() });
        }
    }
    #[test]
    fn state_serializes_with_tag() {
        let v = serde_json::to_value(UpdateState::Available { version: "1".into(), notes: None, manual: false }).unwrap();
        assert_eq!(v["state"], "available");
        assert_eq!(serde_json::to_value(UpdateState::ReadyToRestart { version: "1".into() }).unwrap()["state"], "ready_to_restart");
    }
}
