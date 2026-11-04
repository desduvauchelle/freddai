use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};
use tauri::{Manager, State};
#[derive(Clone)]
struct Host {
    root: PathBuf,
    binary: PathBuf,
    upgrade_attempt: std::sync::Arc<std::sync::Mutex<Option<std::time::Instant>>>,
    /// Key of the last logged upgrade event, so a persistent refusal is logged once, not per poll.
    upgrade_note: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}
/// Minimum gap between automatic idle-upgrade attempts while the host is out of date.
const UPGRADE_RETRY_INTERVAL: Duration = Duration::from_secs(10);
/// Pure decision for the automatic retry: skip while the snapshot shows running work, and
/// throttle real attempts. The host's `prepare_upgrade` refusal remains the actual safety check.
fn upgrade_attempt_due(since_last_attempt: Option<Duration>, running_in_view: usize) -> bool {
    running_in_view == 0 && since_last_attempt.map_or(true, |d| d >= UPGRADE_RETRY_INTERVAL)
}
fn running_sessions(reply: &Value) -> usize {
    reply["sessions"].as_array().map_or(0, |s| {
        s.iter()
            .filter(|x| matches!(x["status"].as_str(), Some("running" | "starting" | "waiting")))
            .count()
    })
}
impl Host {
    fn new(root: PathBuf, binary: PathBuf) -> Self {
        Self { root, binary, upgrade_attempt: Default::default(), upgrade_note: Default::default() }
    }
    fn retry_idle_upgrade(&self, running: usize) -> Result<bool, String> {
        // One serialized attempt every ten seconds, including when overlapping refreshes arrive.
        // A busy host refuses the handshake; it must remain alive until its agents finish.
        let mut last = self.upgrade_attempt.lock().unwrap();
        if !upgrade_attempt_due(last.map(|t| t.elapsed()), running) {
            if running > 0 {
                self.log_upgrade("host_upgrade.deferred", "running sessions", Some(running));
            }
            return Ok(false);
        }
        *last = Some(std::time::Instant::now());
        ensure_host_inner(self, Some(running))?;
        Ok(true)
    }
    /// One structured stderr line (-> native.log) per state change.
    fn log_upgrade(&self, event: &str, reason: &str, running: Option<usize>) {
        let key = format!("{event}|{reason}");
        let mut note = self.upgrade_note.lock().unwrap();
        if note.as_deref() == Some(key.as_str()) { return; }
        *note = Some(key);
        eprintln!("{}", json!({"event": event, "reason": reason, "running": running}));
    }
    fn upgrade_resolved(&self) {
        if self.upgrade_note.lock().unwrap().take().is_some() {
            eprintln!("{}", json!({"event": "host_upgrade.applied"}));
        }
    }
}
fn host_binary(root: &std::path::Path) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    cache_host_binary(&exe, root)
}
fn cache_host_binary(exe: &std::path::Path, root: &std::path::Path) -> Result<PathBuf, String> {
    let data = fs::read(exe).map_err(|e| e.to_string())?;
    let dir = root.join("host-binaries");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("freddai-{:x}", Sha256::digest(&data));
    // A bundle-signed Mach-O requires its signed Info.plist and resources.
    // Keep the whole bundle so the detached host remains valid after app updates.
    #[cfg(target_os = "macos")]
    if let Some(bundle) = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .filter(|p| p.extension().is_some_and(|ext| ext == "app"))
    {
        let target = dir.join(format!("{name}.app"));
        if !target.exists() {
            let stage = dir.join(format!(".{name}-{}.app", std::process::id()));
            let result = (|| {
                let copy = Command::new("/usr/bin/ditto")
                    .arg(bundle)
                    .arg(&stage)
                    .output()
                    .map_err(|e| e.to_string())?;
                if !copy.status.success() {
                    return Err(format!(
                        "Cannot cache signed host bundle: {}",
                        String::from_utf8_lossy(&copy.stderr)
                    ));
                }
                verify_bundle(&stage)?;
                fs::rename(&stage, &target).map_err(|e| e.to_string())
            })();
            if result.is_err() {
                let _ = fs::remove_dir_all(&stage);
            }
            result?;
        }
        verify_bundle(&target)?;
        return fs::canonicalize(
            target
                .join("Contents/MacOS")
                .join(exe.file_name().ok_or("Missing executable name")?),
        )
        .map_err(|e| e.to_string());
    }
    // Unbundled development executables do not depend on a bundle Info.plist.
    let target = dir.join(name);
    if !target.exists() {
        fs::copy(exe, &target).map_err(|e| e.to_string())?;
    }
    fs::canonicalize(target).map_err(|e| e.to_string())
}
#[cfg(target_os = "macos")]
fn verify_bundle(bundle: &std::path::Path) -> Result<(), String> {
    let check = Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(bundle)
        .output()
        .map_err(|e| e.to_string())?;
    if !check.status.success() {
        return Err(format!(
            "Cached host signature is invalid: {}",
            String::from_utf8_lossy(&check.stderr)
        ));
    }
    Ok(())
}
fn ensure_host(host: &Host) -> Result<(), String> {
    let mut last = host.upgrade_attempt.lock().unwrap();
    *last = Some(std::time::Instant::now());
    ensure_host_inner(host, None)
}
fn ensure_host_inner(host: &Host, running: Option<usize>) -> Result<(), String> {
    let result = ensure_host_core(host, running);
    if let Err(e) = &result {
        host.log_upgrade("host_upgrade.failed", e, running);
    }
    result
}
fn ensure_host_core(host: &Host, running: Option<usize>) -> Result<(), String> {
    let binary = host.binary.clone();
    let build = binary.to_string_lossy();
    if let Ok(reply) = freddai_core::host::call(&host.root, "hello", json!({})) {
        if reply["version"] == freddai_core::host::VERSION && reply["build"] == build.as_ref() {
            host.upgrade_resolved();
            return Ok(());
        }
        if let Err(e) = freddai_core::host::call(&host.root, "upgrade_idle", json!({})) {
            host.log_upgrade("host_upgrade.deferred", &e, running);
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    let mut cmd = Command::new(binary);
    cmd.arg("--host")
        .arg(&host.root)
        .current_dir(&host.root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    for _ in 0..50 {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("Background host exited during startup ({status}). See ~/Library/Logs/Freddai/native.log for details."));
        }
        if freddai_core::host::call(&host.root, "hello", json!({}))
            .is_ok_and(|reply| reply["build"].as_str() == host.binary.to_str()) {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            host.upgrade_resolved();
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Err("Background host did not start. An older active host may need stopping before this upgrade.".into())
}
/// One socket round trip per call. A hello is only needed to (re)start an unreachable host, so it
/// runs on the error path, never per poll.
fn call_with_recovery(host: &Host, method: &str, p: Value) -> Result<Value, String> {
    match freddai_core::host::call(&host.root, method, p.clone()) {
        result if method == "snapshot_since" && match &result {
            Err(e) => e.contains("Unknown host command"),
            Ok(reply) => reply["build"].as_str() != host.binary.to_str(),
        } => {
            // Polling must retry after a startup upgrade was deferred by active work.
            // Otherwise the full-database compatibility fallback can remain active forever.
            let running = result.as_ref().map_or(0, running_sessions);
            if host.retry_idle_upgrade(running)? {
                freddai_core::host::call(&host.root, method, p)
            } else {
                result
            }
        }
        Err(e) if e.contains("host is unavailable") => {
            ensure_host(host)?;
            freddai_core::host::call(&host.root, method, p)
        }
        Err(e) if method == "thread_action" && e == "Unknown thread action"
            && matches!(p["action"].as_str(), Some("purge" | "archive" | "delete" | "restore" | "unarchive" | "move")) => {
            // A preserved host can outlive the UI that introduced this action.
            // Upgrade only through the host's idle handshake; never stop active work.
            ensure_host(host)?;
            match freddai_core::host::call(&host.root, method, p) {
                Err(e) if e == "Unknown thread action" => Err(
                    "The background host needs an update before this thread can be changed. Let active work finish, save your draft, then quit and reopen Freddai and try again.".into()
                ),
                other => other,
            }
        }
        Err(e) if (method == "steer_message" && e.contains("Unknown host command"))
            || (method == "queue_action" && matches!(p["action"].as_str(), Some("steer" | "edit")) && e == "Unknown queue action") => {
            Err("The background host needs an update for steering and queue editing. Let active work finish, save your draft, then quit and reopen Freddai.".into())
        }
        other => other,
    }
}
async fn rpc(host: Host, method: &'static str, p: Value) -> Result<Value, String> {
    let called = std::time::Instant::now();
    tauri::async_runtime::spawn_blocking(move || {
        let queue_ms = freddai_core::timing::ms(called);
        if method == "snapshot" || method == "snapshot_since" {
            let call_start = std::time::Instant::now();
            let mut result = match call_with_recovery(&host, method, p.clone()) {
                // A host started by an older build has no incremental snapshot; use the full one.
                // Revision 0 and host id "legacy" make the client replace its whole state each poll.
                Err(e) if method == "snapshot_since" && e.contains("Unknown host command") => {
                    let mut full = call_with_recovery(&host, "snapshot", json!({}))?;
                    full["revision"] = json!(0);
                    full["hostId"] = json!("legacy");
                    full["full"] = json!(true);
                    full["host_update_pending"] = json!(true);
                    full
                }
                other => other?,
            };
            let call_ms = freddai_core::timing::ms(call_start);
            let mut hello_ms = 0.0;
            if method == "snapshot" {
                let h2 = std::time::Instant::now();
                let hello = freddai_core::host::call(&host.root, "hello", json!({}))?;
                hello_ms = freddai_core::timing::ms(h2);
                result["host_update_pending"] = json!(hello["build"].as_str() != host.binary.to_str());
            } else if result.get("host_update_pending").is_none() {
                result["host_update_pending"] = json!(result["build"].as_str() != host.binary.to_str());
            }
            static LAST: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
            let gap = {
                let mut last = LAST.lock().unwrap();
                let gap = last.map(|t| called.duration_since(t).as_secs_f64() * 1000.0);
                *last = Some(called);
                gap
            };
            freddai_core::timing::log(
                "app",
                format_args!(
                    "ev=tauri_snapshot method={method} total_ms={:.2} spawn_queue_ms={queue_ms:.2} snapshot_call_ms={call_ms:.2} hello_ms={hello_ms:.2} unchanged={} gap_since_prev_call_ms={}",
                    freddai_core::timing::ms(called),
                    result["unchanged"].as_bool().unwrap_or(false),
                    gap.map(|g| format!("{g:.1}")).unwrap_or_else(|| "none".into())
                ),
            );
            return Ok(result);
        }
        freddai_core::host::call(&host.root, method, p)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn git_history(path: String) -> Result<crate::git_history::GitHistory, String> {
    tauri::async_runtime::spawn_blocking(move || crate::git_history::read(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn snapshot(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "snapshot", json!({})).await
}
#[tauri::command]
async fn snapshot_since(h: State<'_, Host>, revision: u64, host_id: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "snapshot_since", json!({"revision": revision, "hostId": host_id})).await
}
#[tauri::command]
async fn detect_agents(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "detect_agents", json!({})).await
}
#[tauri::command]
async fn detect_existing_sign_ins(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "detect_existing_sign_ins", json!({})).await
}
#[tauri::command]
async fn connect_existing(h: State<'_, Host>, provider: String) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "connect_existing",
        json!({"provider":provider}),
    )
    .await
}
#[tauri::command]
async fn rename_account(h: State<'_, Host>, account: String, name: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "rename_account", json!({"account":account,"name":name})).await
}
#[tauri::command]
async fn remove_account(h: State<'_, Host>, account: String) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "remove_account",
        json!({ "account": account }),
    )
    .await
}
#[tauri::command]
async fn add_account(
    h: State<'_, Host>,
    name: String,
    provider: String,
    color: String,
) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "add_account",
        json!({"name":name,"provider":provider,"color":color}),
    )
    .await
}
#[tauri::command]
async fn import_project(h: State<'_, Host>, path: String, color: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "import_project", json!({"path":path,"color":color})).await
}
#[tauri::command]
async fn save_project(h: State<'_, Host>, project: Value) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "save_project",
        json!({"project":project}),
    )
    .await
}
#[tauri::command]
async fn save_preferences(h: State<'_, Host>, preferences: Value) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "save_preferences",
        json!({"preferences":preferences}),
    )
    .await
}
#[tauri::command]
async fn login(h: State<'_, Host>, account: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "login", json!({"account":account})).await
}
#[tauri::command]
async fn login_state(h: State<'_, Host>, account: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "login_state", json!({"account":account})).await
}
#[tauri::command]
async fn cancel_login(h: State<'_, Host>, account: String) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "cancel_login",
        json!({"account":account}),
    )
    .await
}
#[tauri::command]
async fn auth_status(h: State<'_, Host>, account: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "auth_status", json!({"account":account})).await
}
#[tauri::command]
async fn account_models(h: State<'_, Host>, account: String) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "account_models",
        json!({"account":account}),
    )
    .await
}
#[tauri::command]
async fn consume_reset(
    h: State<'_, Host>,
    account: String,
    credit_id: String,
    idempotency_key: String,
) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "consume_reset",
        json!({"account":account,"creditId":credit_id,"idempotencyKey":idempotency_key}),
    )
    .await
}
#[tauri::command]
async fn account_usage(h: State<'_, Host>, account: String) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "account_usage",
        json!({"account":account}),
    )
    .await
}
#[tauri::command]
async fn launch(
    h: State<'_, Host>,
    project: String,
    account: Option<String>,
    prompt: String,
    existing: Option<String>,
    options: Option<Value>,
) -> Result<Value, String> {
    rpc(h.inner().clone(),"launch",json!({"project":project,"account":account,"prompt":prompt,"existing":existing,"options":options})).await
}
#[tauri::command]
async fn queue_message(h: State<'_, Host>, session: String, prompt: String, options: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "queue_message", json!({"session":session,"prompt":prompt,"options":options})).await
}
#[tauri::command]
async fn steer_message(h: State<'_, Host>, session: String, prompt: String, options: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "steer_message", json!({"session":session,"prompt":prompt,"options":options})).await
}
#[tauri::command]
async fn queue_action(h: State<'_, Host>, session: String, action: String, message: Option<String>, prompt: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "queue_action", json!({"session":session,"action":action,"message":message,"prompt":prompt})).await
}
#[tauri::command]
async fn stop(h: State<'_, Host>, session: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "stop", json!({"session":session})).await
}
#[tauri::command]
async fn respond(
    h: State<'_, Host>,
    session: String,
    request_id: String,
    allow: bool,
    answers: Value,
) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "respond",
        json!({"session":session,"requestId":request_id,"allow":allow,"answers":answers}),
    )
    .await
}
#[tauri::command]
async fn stage_attachments(h: State<'_, Host>, paths: Vec<String>) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "stage_attachments",
        json!({"paths":paths}),
    )
    .await
}
#[tauri::command]
async fn preview_attachment(h: State<'_, Host>, id: String) -> Result<String, String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || freddai_core::attachments::preview(&root, &id))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn capture_screenshot(h: State<'_, Host>) -> Result<Value, String> {
    use crate::screen_grab::{self, Outcome};
    let dir = screen_grab::temp_dir()?;
    let png = dir.join(screen_grab::file_name());
    let target = png.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || screen_grab::capture(&target))
        .await
        .map_err(|e| e.to_string());
    let result = match outcome {
        Ok(Outcome::Captured) => {
            screen_grab::event("screen_grab.captured", "staging");
            // Same import as the file picker and drag-drop, so the host copies and de-duplicates it.
            let staged = rpc(h.inner().clone(), "stage_attachments", json!({"paths":[png.to_string_lossy()]})).await;
            if let Err(e) = &staged { screen_grab::event("screen_grab.stage_failed", e); }
            staged
        }
        Ok(Outcome::Cancelled) => { screen_grab::event("screen_grab.cancelled", "no file produced"); Ok(Value::Null) }
        Ok(Outcome::Failed(message)) => { screen_grab::event("screen_grab.failed", &message); Err(message) }
        Err(e) => { screen_grab::event("screen_grab.failed", &e); Err(e) }
    };
    let _ = fs::remove_dir_all(&dir);
    result
}
#[tauri::command]
async fn thread_action(h: State<'_, Host>, session: String, action: String, project: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "thread_action", json!({"session":session,"action":action,"project":project})).await
}
#[tauri::command]
async fn mark_read(h: State<'_, Host>, thread: String, at: u64) -> Result<Value, String> {
    rpc(h.inner().clone(), "mark_read", json!({"thread":thread,"at":at})).await
}
#[tauri::command]
async fn merge_read(h: State<'_, Host>, cursors: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "merge_read", json!({"cursors":cursors})).await
}
#[tauri::command]
async fn rename_session(h: State<'_, Host>, session: String, title: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "rename_session", json!({"session":session,"title":title})).await
}
#[tauri::command]
async fn remove_worktree(h: State<'_, Host>, session: String) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "remove_worktree",
        json!({"session":session}),
    )
    .await
}
#[tauri::command]
async fn save_schedule(h: State<'_, Host>, schedule: Value) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "save_schedule",
        json!({"schedule":schedule}),
    )
    .await
}
#[tauri::command]
async fn schedule_action(
    h: State<'_, Host>,
    schedule: String,
    action: String,
) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "schedule_action",
        json!({"schedule":schedule,"action":action}),
    )
    .await
}
#[tauri::command]
async fn stop_all(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "stop_all", json!({})).await
}
#[tauri::command]
fn startup_status() -> bool {
    std::env::var_os("HOME")
        .map(|h| {
            PathBuf::from(h)
                .join("Library/LaunchAgents/com.freddai.host.plist")
                .exists()
        })
        .unwrap_or(false)
}
#[tauri::command]
fn set_start_at_login(h: State<Host>, enabled: bool) -> Result<(), String> {
    configure_start_at_login(h.inner(), enabled)
}
fn configure_start_at_login(h: &Host, enabled: bool) -> Result<(), String> {
    let home = std::env::var_os("HOME").ok_or("Cannot find home directory")?;
    let dir = PathBuf::from(home).join("Library/LaunchAgents");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("com.freddai.host.plist");
    if !enabled {
        if file.exists() {
            fs::remove_file(file).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    fn xml(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }
    let bin = h.binary.clone();
    let plist=format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>Label</key><string>com.freddai.host</string><key>ProgramArguments</key><array><string>{}</string><string>--host</string><string>{}</string></array><key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string></dict></plist>",xml(&bin.to_string_lossy()),xml(&h.root.to_string_lossy()));
    fs::write(file, plist).map_err(|e| e.to_string())
}

#[tauri::command]
fn platform() -> &'static str { "desktop" }

#[tauri::command]
fn companion_devices(h: State<'_,Host>) -> Result<Value,String> {crate::companion_pairing::status(&h.root)}
#[tauri::command]
fn companion_device_action(h: State<'_,Host>, action:String, id:String) -> Result<Value,String> {crate::companion_pairing::control(&h.root,&action,&id)}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            fs::create_dir_all(&root)?;
            let binary = host_binary(&root)?;
            let host = Host::new(root, binary);
            ensure_host(&host).map_err(std::io::Error::other)?;
            if startup_status() {
                configure_start_at_login(&host, true).map_err(std::io::Error::other)?;
            }
            #[cfg(target_os = "macos")]
            crate::companion_server::ensure(host.root.clone(), host.binary.clone()).map_err(std::io::Error::other)?;
            if let Some(window) = app.get_webview_window("main") {
                crate::window_state::install(window, host.root.clone());
            }
            app.manage(host);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform,
            companion_devices,
            companion_device_action,
            git_history,
            snapshot,
            snapshot_since,
            detect_agents,
            detect_existing_sign_ins,
            connect_existing,
            add_account,
            remove_account,
            rename_account,
            save_project,
            import_project,
            save_preferences,
            login,
            login_state,
            cancel_login,
            auth_status,
            account_usage,
            consume_reset,
            account_models,
            launch,
            queue_message,
            steer_message,
            queue_action,
            stop,
            respond,
            stage_attachments,
            preview_attachment,
            capture_screenshot,
            rename_session,
            mark_read,
            merge_read,
            thread_action,
            remove_worktree,
            save_schedule,
            schedule_action,
            stop_all,
            startup_status,
            set_start_at_login
        ])
        .run(tauri::generate_context!())
        .expect("error running Freddai");
}

#[cfg(all(test, target_os = "macos"))]
mod host_cache_tests {
    use super::*;

    struct Workspace(PathBuf);
    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    struct Child(std::process::Child);
    impl Drop for Child {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn incremental_poll_retries_idle_upgrade_and_preserves_busy_host() {
        use std::os::unix::net::UnixListener;
        use std::io::{BufRead, BufReader, Write};
        let root = Workspace(std::env::temp_dir().join(format!(
            "freddai-stream-upgrade-test-{}", std::process::id()
        )));
        fs::create_dir_all(&root.0).unwrap();
        let listener = UnixListener::bind(root.0.join("host.sock")).unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            for expected in ["snapshot_since", "hello", "upgrade_idle", "snapshot_since", "snapshot_since"] {
                let deadline = std::time::Instant::now() + Duration::from_secs(2);
                let (mut stream, _) = loop {
                    if let Ok(connection) = listener.accept() { break connection; }
                    assert!(std::time::Instant::now() < deadline, "missing request {expected}");
                    std::thread::sleep(Duration::from_millis(10));
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut line = String::new();
                BufReader::new(&stream).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], expected);
                let reply = match expected {
                    "hello" => json!({"result":{"version":"2", "build":"old-host"}}),
                    "upgrade_idle" => json!({"error":"Active work prevents upgrade"}),
                    _ => json!({"error":"Unknown host command: snapshot_since"}),
                };
                writeln!(stream, "{reply}").unwrap();
            }
        });
        let host = Host::new(root.0.clone(), PathBuf::from("new-host"));
        let error = call_with_recovery(&host, "snapshot_since", json!({"revision":0,"hostId":null})).unwrap_err();
        assert!(error.contains("Unknown host command"));
        // Another immediate poll must not repeat the busy-host handshake.
        assert!(call_with_recovery(&host, "snapshot_since", json!({"revision":0,"hostId":null})).is_err());
        server.join().unwrap();
    }

    #[test]
    fn unsupported_thread_action_preserves_busy_host_and_explains_recovery() {
        use std::os::unix::net::UnixListener;
        use std::io::{BufRead, BufReader, Write};
        let root = Workspace(std::env::temp_dir().join(format!(
            "freddai-action-test-{}", std::process::id()
        )));
        fs::create_dir_all(&root.0).unwrap();
        let listener = UnixListener::bind(root.0.join("host.sock")).unwrap();
        let server = std::thread::spawn(move || {
            for expected in ["thread_action", "hello", "upgrade_idle", "thread_action"] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut line = String::new();
                BufReader::new(&stream).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], expected);
                let reply = match expected {
                    "hello" => json!({"result":{"version":"2", "build":"old-host"}}),
                    "upgrade_idle" => json!({"error":"Active work prevents upgrade"}),
                    _ => json!({"error":"Unknown thread action"}),
                };
                writeln!(stream, "{reply}").unwrap();
            }
        });
        let error = call_with_recovery(&Host::new(root.0.clone(), PathBuf::from("new-host")),
            "thread_action", json!({"session":"fixture", "action":"purge", "project":null})).unwrap_err();
        server.join().unwrap();
        assert!(error.contains("Let active work finish"), "{error}");
        assert!(error.contains("quit and reopen Freddai"), "{error}");
        assert!(!error.contains("Unknown thread action"));
    }

    #[test]
    #[ignore = "requires the installed Developer ID signed macOS app"]
    fn legacy_host_upgrades_to_installed_streaming_host() {
        use std::os::unix::net::UnixListener;
        use std::io::{BufRead, BufReader, Write};
        let root = Workspace(std::env::temp_dir().join(format!(
            "freddai-stream-installed-{}", std::process::id()
        )));
        fs::create_dir_all(&root.0).unwrap();
        // Large history, no connected accounts, credentials or provider processes.
        let history = "synthetic history ".repeat(20_000);
        let sessions: Vec<Value> = (0..45).map(|n| json!({
            "id":format!("fixture-{n}"),"project":"offline","account":"offline",
            "title":"Fixture","status":"done","updated":1,
            "messages":[{"id":"m","role":"assistant","text":history}],
            "pending":null,"error":null
        })).collect();
        fs::write(root.0.join("workspace.json"), serde_json::to_vec(&json!({
            "sessions":sessions,"accounts":[],"projects":[],
            "preferences":freddai_core::runtime::Database::default().preferences
        })).unwrap()).unwrap();
        let binary = cache_host_binary(std::path::Path::new(
            "/Applications/Freddai.app/Contents/MacOS/freddai-native"), &root.0).unwrap();
        let listener = UnixListener::bind(root.0.join("host.sock")).unwrap();
        listener.set_nonblocking(true).unwrap();
        let socket_path = root.0.join("host.sock");
        let legacy = std::thread::spawn(move || {
            for expected in ["snapshot_since", "hello", "upgrade_idle"] {
                let deadline = std::time::Instant::now() + Duration::from_secs(3);
                let (mut stream, _) = loop {
                    if let Ok(connection) = listener.accept() { break connection; }
                    assert!(std::time::Instant::now() < deadline, "missing {expected}");
                    std::thread::sleep(Duration::from_millis(5));
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut line = String::new();
                BufReader::new(&stream).read_line(&mut line).unwrap();
                assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["method"], expected);
                let reply = match expected {
                    "snapshot_since" => json!({"error":"Unknown host command: snapshot_since"}),
                    "hello" => json!({"result":{"version":"2","build":"legacy-fixture"}}),
                    _ => json!({"result":null}),
                };
                writeln!(stream, "{reply}").unwrap();
            }
            drop(listener);
            fs::remove_file(socket_path).unwrap();
        });
        let host = Host::new(root.0.clone(), binary.clone());
        let first = call_with_recovery(&host, "snapshot_since", json!({"revision":0,"hostId":null}));
        legacy.join().unwrap();
        // Always shut down the isolated host, even when an assertion below fails.
        let verification = (|| {
            let first = first?;
            assert_eq!(first["build"].as_str(), binary.to_str());
            assert_eq!(first["sessions"].as_array().unwrap().len(), 45);
            assert!(first["accounts"].as_array().unwrap().is_empty());
            let full_bytes = serde_json::to_vec(&first).unwrap().len();
            let started = std::time::Instant::now();
            let same = call_with_recovery(&host, "snapshot_since", json!({
                "revision":first["revision"],"hostId":first["hostId"]
            }))?;
            let elapsed = started.elapsed();
            let unchanged_bytes = serde_json::to_vec(&same).unwrap().len();
            assert_eq!(same["unchanged"], true);
            assert!(unchanged_bytes < 1024);
            assert!(elapsed < Duration::from_millis(250));
            eprintln!("stream verification: full_bytes={full_bytes} unchanged_bytes={unchanged_bytes} unchanged_ms={:.2}", elapsed.as_secs_f64()*1000.0);
            Ok::<(), String>(())
        })();
        let shutdown = freddai_core::host::call(&root.0, "upgrade_idle", json!({}));
        verification.unwrap();
        shutdown.unwrap();
        std::thread::sleep(Duration::from_millis(250));
    }

    #[test]
    #[ignore = "requires the installed Developer ID signed macOS app"]
    fn cached_signed_host_starts() {
        let root = Workspace(std::env::temp_dir().join(format!(
            "freddai-cache-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        )));
        let exe = cache_host_binary(
            std::path::Path::new("/Applications/Freddai.app/Contents/MacOS/freddai-native"),
            &root.0,
        )
        .unwrap();
        assert_eq!(
            exe,
            cache_host_binary(
                std::path::Path::new("/Applications/Freddai.app/Contents/MacOS/freddai-native"),
                &root.0
            )
            .unwrap()
        );
        let signature = Command::new("/usr/bin/codesign")
            .args(["--verify", "--strict", "--verbose=2"])
            .arg(&exe)
            .output()
            .unwrap();
        assert!(
            signature.status.success(),
            "Cached host lost its signature: {}",
            String::from_utf8_lossy(&signature.stderr)
        );
        let mut child = Child(
            Command::new(&exe)
                .arg("--host")
                .arg(&root.0)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap(),
        );
        for _ in 0..100 {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "Cached host exited before responding"
            );
            if let Ok(reply) = freddai_core::host::call(&root.0, "hello", json!({})) {
                assert_eq!(reply["version"], freddai_core::host::VERSION);
                assert_eq!(reply["build"].as_str(), exe.to_str());
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("Cached signed host never became ready");
    }
}

#[cfg(test)]
mod upgrade_retry_tests {
    use super::*;

    #[test]
    fn retry_waits_for_idle_and_throttles() {
        let ok = UPGRADE_RETRY_INTERVAL;
        assert!(upgrade_attempt_due(None, 0));
        assert!(upgrade_attempt_due(Some(ok), 0));
        assert!(!upgrade_attempt_due(Some(ok - Duration::from_secs(1)), 0));
        assert!(!upgrade_attempt_due(None, 1));
        assert!(!upgrade_attempt_due(Some(ok * 2), 2));
    }

    #[test]
    fn counts_busy_sessions_only() {
        let reply = json!({"sessions":[{"status":"running"},{"status":"done"},{"status":"waiting"},{"status":"failed"}]});
        assert_eq!(running_sessions(&reply), 2);
        assert_eq!(running_sessions(&json!({"error":"x"})), 0);
    }
}
