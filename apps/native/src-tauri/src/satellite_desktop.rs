//! Satellite Mac GUI runtime: the full desktop UI, with the work running on the paired host Mac.
//!
//! The webview is the normal `DesktopApp`. Commands it invokes are either handled here (things that must
//! stay on this Mac: voice, scout, updater, windows, pairing, file staging) or forwarded verbatim to the host
//! as `POST /v1/desktop {"command","args"}` over the existing companion transport (LAN, relay fallback).
//! A command is forwarded unless it is listed in `LOCAL_COMMANDS`, which is generated from the very same
//! list that feeds `generate_handler!`, so a locally registered command can never fall through.
use crate::desktop::Host;
use crate::mobile::{call, call_slow, upload_file, Companion};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{ipc::{Invoke, InvokeBody}, Emitter, Manager, State};

const ROUTE: &str = "/v1/desktop";
const PREVIEW_CHUNK: u64 = 192 * 1024;
const PREVIEW_LIMIT: u64 = 64 * 1024 * 1024;
const MAX_ATTACHMENTS: usize = 20;
const BUG_WALK_UNAVAILABLE: &str = "Bug Walk from a satellite Mac isn't available yet; record on your original Mac.";

macro_rules! last_ident {
    ($i:ident) => { stringify!($i) };
    ($h:ident :: $($t:tt)+) => { last_ident!($($t)+) };
}
/// One source list for both the handler and `LOCAL_COMMANDS`.
macro_rules! local_commands {
    ($($($seg:ident)::+),+ $(,)?) => {
        /// Command names answered on this Mac. Everything else is forwarded to the host.
        const LOCAL_COMMANDS: &[&str] = &[$(last_ident!($($seg)::+)),+];
        fn local_handler() -> impl Fn(Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$($($seg)::+),+]
        }
    };
}

local_commands![
    platform, vscode_available, open_project_vscode, open_thread_window,
    crate::desktop::open_app_window, crate::desktop::focus_main_window,
    startup_status, set_start_at_login,
    crate::satellite::satellite_mode, crate::satellite::satellite_set_mode,
    crate::satellite::satellite_onboarding_needed, crate::satellite::satellite_finish_onboarding,
    crate::updater::updater_state, crate::updater::check_for_updates, crate::updater::install_update,
    crate::updater::restart_app, crate::updater::open_release_page,
    crate::browser::browser_view,
    crate::mobile::companion_pairing_status, crate::mobile::companion_pair, crate::mobile::companion_pair_claim,
    crate::mobile::companion_composer, crate::mobile::companion_upload_path, crate::mobile::companion_snapshot,
    crate::mobile::companion_wake_refresh, crate::mobile::companion_wake_info, crate::mobile::companion_wake,
    crate::mobile::companion_bug_walk_send, crate::mobile::companion_bug_walk_status,
    crate::mobile::preview_open,
    crate::desktop::voice_connection, crate::desktop::voice_status, crate::desktop::voice_update_settings,
    crate::desktop::voice_download_model, crate::desktop::voice_cancel_download, crate::desktop::voice_delete_model,
    crate::desktop::voice_start_recording, crate::desktop::voice_stop_recording, crate::desktop::voice_cancel_recording,
    crate::desktop::voice_recording_level, crate::desktop::voice_call_start, crate::desktop::voice_call_stop,
    crate::desktop::voice_call_set_listening, crate::desktop::voice_speak, crate::desktop::voice_stop_speaking,
    crate::desktop::voice_list_voices,
    crate::scout::scout_state, crate::scout::scout_detect_connections, crate::scout::scout_detect_account_connectors,
    crate::scout::scout_workspace_save, crate::scout::scout_workspace_delete, crate::scout::scout_workspace_reorder,
    crate::scout::scout_project_save, crate::scout::scout_project_delete, crate::scout::scout_project_move,
    crate::scout::scout_item_save, crate::scout::scout_item_delete, crate::scout::scout_item_move,
    crate::scout::scout_rule_save, crate::scout::scout_rule_delete, crate::scout::scout_source_save,
    crate::scout::scout_source_delete, crate::scout::scout_settings_save, crate::scout::scout_import_freddai,
    crate::scout::scout_sample_data,
    stage_attachments, capture_screenshot, preview_file_url,
    terminal_open, terminal_close,
    bug_walk_start, bug_walk_stop, bug_walk_cancel, bug_walk_send, bug_walk_send_transcript,
    bug_walk_orphans, bug_walk_settings_get, bug_walk_settings_set,
];

fn is_local(command: &str) -> bool { LOCAL_COMMANDS.contains(&command) }

// ---------------------------------------------------------------- forwarding

/// The exact body the host's `/v1/desktop` route expects.
fn forward_body(command: &str, args: Value) -> Value { json!({"command": command, "args": args}) }

/// Polled or tiny commands keep the default transport limits; everything else may legitimately take
/// seconds on the host (git push, sign-in checks, thread starts), so it gets a longer budget.
fn forward_limits(command: &str) -> Option<(Duration, u32)> {
    const QUICK: &[&str] = &["snapshot_since", "snapshot", "terminal_poll", "terminal_write", "terminal_resize", "mark_read", "merge_read"];
    if QUICK.contains(&command) { None } else { Some((Duration::from_secs(120), 120)) }
}

async fn forward(c: &Companion, command: &str, args: Value) -> Result<Value, String> {
    let body = forward_body(command, args);
    match forward_limits(command) {
        None => call(c, ROUTE, body).await,
        Some((timeout, polls)) => call_slow(c, ROUTE, body, Some(timeout), polls).await,
    }
}

/// Failure logging is rate-limited to one line per command per interval.
fn should_log(last: &mut HashMap<String, Instant>, command: &str, now: Instant, interval: Duration) -> bool {
    match last.get(command) {
        Some(prev) if now.duration_since(*prev) < interval => false,
        _ => { last.insert(command.to_string(), now); true }
    }
}
static LAST_FAILURE_LOG: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
fn log_forward_failure(command: &str, error: &str) {
    let due = LAST_FAILURE_LOG.lock().map(|mut g| should_log(g.get_or_insert_with(HashMap::new), command, Instant::now(), Duration::from_secs(5))).unwrap_or(true);
    if due { eprintln!("{}", json!({"event": "satellite.forward_failed", "command": command, "error": error})); }
}

/// Handler installed on the Builder: local commands go to `generate_handler!`, the rest to the host.
fn dispatch(local: &impl Fn(Invoke<tauri::Wry>) -> bool, invoke: Invoke<tauri::Wry>) -> bool {
    if is_local(invoke.message.command()) { return local(invoke); }
    let Invoke { message, resolver, .. } = invoke;
    let command = message.command().to_string();
    let args = match message.payload() {
        InvokeBody::Json(value) => value.clone(),
        InvokeBody::Raw(_) => {
            resolver.reject("Binary payloads can't be forwarded to the host");
            return true;
        }
    };
    let app = message.webview().app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let companion = app.state::<Companion>();
        match forward(&companion, &command, args).await {
            Ok(value) => resolver.resolve(value),
            Err(error) => { log_forward_failure(&command, &error); resolver.reject(error) }
        }
    });
    true
}

// ---------------------------------------------------------------- simple local commands

#[tauri::command]
fn platform() -> &'static str { "desktop" }
#[tauri::command]
fn vscode_available() -> bool { false }
#[tauri::command]
fn open_project_vscode(_project: String) -> Result<(), String> { Err("VS Code can only be opened on your original Mac.".into()) }
#[tauri::command]
fn startup_status() -> bool { crate::desktop::startup_status() }
#[tauri::command]
fn set_start_at_login(_enabled: bool) -> Result<(), String> { Err("Start at login is configured on your original Mac.".into()) }

#[tauri::command]
async fn open_thread_window(app: tauri::AppHandle, c: State<'_, Companion>, session: String) -> Result<(), String> {
    let snapshot = forward(&c, "snapshot", Value::Null).await?;
    let thread = snapshot["sessions"].as_array()
        .and_then(|sessions| sessions.iter().find(|t| t["id"].as_str() == Some(session.as_str())))
        .ok_or("Thread no longer exists")?;
    let base = app.config().app.windows.first().cloned().ok_or("Missing window configuration")?;
    crate::thread_windows::open(app, base, session, thread["title"].as_str().unwrap_or("Thread")).await
}

// ---------------------------------------------------------------- bug walk (not available on a satellite yet)

#[tauri::command] fn bug_walk_start() -> Result<Value, String> { Err(BUG_WALK_UNAVAILABLE.into()) }
#[tauri::command] fn bug_walk_stop() -> Result<Value, String> { Err(BUG_WALK_UNAVAILABLE.into()) }
#[tauri::command] fn bug_walk_cancel() -> Result<(), String> { Err(BUG_WALK_UNAVAILABLE.into()) }
#[tauri::command] fn bug_walk_send() -> Result<(), String> { Err(BUG_WALK_UNAVAILABLE.into()) }
#[tauri::command] fn bug_walk_send_transcript() -> Result<(), String> { Err(BUG_WALK_UNAVAILABLE.into()) }
/// Nothing can be recorded here, so there is nothing to recover.
#[tauri::command] fn bug_walk_orphans() -> Result<Vec<Value>, String> { Ok(vec![]) }
#[tauri::command] fn bug_walk_settings_get() -> Result<Value, String> { Err(BUG_WALK_UNAVAILABLE.into()) }
#[tauri::command] fn bug_walk_settings_set() -> Result<Value, String> { Err(BUG_WALK_UNAVAILABLE.into()) }

// ---------------------------------------------------------------- attachments

/// Uploads each local file to the host. The host's `upload` finish step returns the same `Attachment`
/// the host's own `stage_attachments` produces for one path, so the list matches that command's reply.
async fn stage_local_files(c: &Companion, paths: &[String]) -> Result<Value, String> {
    if paths.len() > MAX_ATTACHMENTS { return Err("Attach at most 20 files per message".into()); }
    let mut staged = Vec::with_capacity(paths.len());
    for path in paths {
        let file = std::fs::canonicalize(path).map_err(|e| format!("Cannot read {path}: {e}"))?;
        if !file.is_file() { return Err(format!("Only regular files can be attached: {path}")); }
        let name = file.file_name().and_then(|n| n.to_str()).ok_or_else(|| format!("Invalid file name: {path}"))?.to_string();
        staged.push(upload_file(c, &file, &name).await.map_err(|e| format!("Could not send {name} to your Mac: {e}"))?);
    }
    Ok(Value::Array(staged))
}
#[tauri::command]
async fn stage_attachments(c: State<'_, Companion>, paths: Vec<String>) -> Result<Value, String> {
    stage_local_files(&c, &paths).await
}
#[tauri::command]
async fn capture_screenshot(c: State<'_, Companion>) -> Result<Value, String> {
    use crate::screen_grab::{self, Outcome};
    let dir = screen_grab::temp_dir()?;
    let png = dir.join(screen_grab::file_name());
    let target = png.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || screen_grab::capture(&target)).await.map_err(|e| e.to_string());
    let result = match outcome {
        Ok(Outcome::Captured) => {
            screen_grab::event("screen_grab.captured", "uploading to host");
            let staged = stage_local_files(&c, &[png.to_string_lossy().into_owned()]).await;
            if let Err(e) = &staged { screen_grab::event("screen_grab.stage_failed", e); }
            staged
        }
        Ok(Outcome::Cancelled) => { screen_grab::event("screen_grab.cancelled", "no file produced"); Ok(Value::Null) }
        Ok(Outcome::Failed(message)) => { screen_grab::event("screen_grab.failed", &message); Err(message) }
        Err(e) => { screen_grab::event("screen_grab.failed", &e); Err(e) }
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

// ---------------------------------------------------------------- HTML preview

/// `<root>/satellite-previews/<sha of host path>/<basename>`; the basename never carries a path component.
fn preview_target(root: &Path, host_path: &str) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    let name = Path::new(host_path).file_name().and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && !n.starts_with('.') && !n.contains(['/', '\\', '\0']))
        .ok_or("The host returned an invalid preview file name")?;
    let digest = hex::encode(Sha256::digest(host_path.as_bytes()));
    Ok(root.join("satellite-previews").join(&digest[..32]).join(name))
}
fn is_html_path(path: &str) -> bool {
    matches!(Path::new(path).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("html" | "htm"))
}
#[tauri::command]
async fn preview_file_url(c: State<'_, Companion>, h: State<'_, Host>, thread: String, href: String) -> Result<Value, String> {
    use base64::Engine;
    let chunk = |offset: u64| forward(&c, "generated_file", json!({"thread": thread, "href": href, "offset": offset, "length": PREVIEW_CHUNK}));
    let first = chunk(0).await?;
    let host_path = first["path"].as_str().ok_or("Restart Freddai on your original Mac so its background host can resolve file paths")?.to_string();
    if !is_html_path(&host_path) { return Err("Only HTML files can open in the browser panel".into()); }
    let size = first["size"].as_u64().ok_or("The host did not report the file size")?;
    if size > PREVIEW_LIMIT { return Err(format!("Preview file is too large to copy from your Mac ({} MB limit)", PREVIEW_LIMIT / 1024 / 1024)); }
    let mut bytes = Vec::with_capacity(size as usize);
    let mut part = first;
    loop {
        let data = base64::engine::general_purpose::STANDARD.decode(part["data"].as_str().unwrap_or("")).map_err(|_| "The host sent an invalid preview chunk")?;
        if data.is_empty() && (bytes.len() as u64) < size { return Err("The preview download from your Mac ended early".into()); }
        bytes.extend_from_slice(&data);
        if bytes.len() as u64 > PREVIEW_LIMIT { return Err("Preview file is too large to copy from your Mac".into()); }
        if bytes.len() as u64 >= size { break; }
        part = chunk(bytes.len() as u64).await?;
    }
    let file = preview_target(&h.root, &host_path)?;
    let dir = file.parent().ok_or("Invalid preview folder")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create preview folder: {e}"))?;
    std::fs::write(&file, &bytes).map_err(|e| format!("Cannot save preview: {e}"))?;
    let url = crate::local_preview::register(&file)?;
    Ok(json!({"url": url, "path": host_path}))
}

// ---------------------------------------------------------------- terminals

/// Poll tasks by host terminal id, so closing a terminal stops its loop.
#[derive(Default)]
pub(crate) struct SatelliteTerminals(Mutex<HashMap<u32, tauri::async_runtime::JoinHandle<()>>>);

const POLL_FAST: Duration = Duration::from_millis(150);
const POLL_SLOW: Duration = Duration::from_millis(1000);
const POLL_BACKOFF_AFTER: u32 = 20;
const POLL_GIVE_UP_AFTER_ERRORS: u32 = 30;
/// Delay before the next poll: fast while output flows, slow after a long quiet spell.
fn poll_delay(consecutive_empty: u32) -> Duration { if consecutive_empty >= POLL_BACKOFF_AFTER { POLL_SLOW } else { POLL_FAST } }

/// True when the host says the terminal session no longer exists, so retrying can never succeed.
fn poll_error_is_terminal(err: &str) -> bool { err.contains("is not running") || err.contains("Unknown terminal") }

#[derive(Deserialize, Default)]
struct PollReply {
    #[serde(default)] chunks: Vec<PollChunk>,
    #[serde(default)] next: u64,
    #[serde(default)] exited: bool,
    #[serde(default)] code: Option<u32>,
    #[serde(default)] truncated: bool,
}
#[derive(Deserialize)]
struct PollChunk { data: String }

async fn poll_terminal(app: tauri::AppHandle, id: u32) {
    let (mut after, mut empty, mut errors) = (0u64, 0u32, 0u32);
    let output = |data: String| { let _ = app.emit("terminal-output", json!({"id": id, "data": data})); };
    loop {
        tokio::time::sleep(if errors > 0 { POLL_SLOW } else { poll_delay(empty) }).await;
        let companion = app.state::<Companion>();
        let reply = forward(&companion, "terminal_poll", json!({"id": id, "after": after})).await
            .and_then(|v| serde_json::from_value::<PollReply>(v).map_err(|e| format!("Invalid terminal reply from host: {e}")));
        match reply {
            Ok(reply) => {
                errors = 0;
                if reply.truncated { output("\r\n[satellite] host terminal history truncated\r\n".into()); }
                empty = if reply.chunks.is_empty() && !reply.truncated { empty.saturating_add(1) } else { 0 };
                for chunk in reply.chunks { output(chunk.data); }
                after = reply.next.max(after);
                if reply.exited {
                    let _ = app.emit("terminal-exit", json!({"id": id, "code": reply.code}));
                    break;
                }
            }
            Err(error) => {
                errors += 1;
                log_forward_failure("terminal_poll", &error);
                if poll_error_is_terminal(&error) {
                    output(format!("\r\n[satellite] host terminal ended: {error}\r\n"));
                    let _ = app.emit("terminal-exit", json!({"id": id, "code": Value::Null}));
                    break;
                }
                if errors == 1 { output(format!("\r\n[satellite] lost contact with the host terminal: {error}\r\n")); }
                if errors >= POLL_GIVE_UP_AFTER_ERRORS {
                    output("\r\n[satellite] giving up on the host terminal\r\n".into());
                    let _ = app.emit("terminal-exit", json!({"id": id, "code": Value::Null}));
                    break;
                }
            }
        }
    }
    if let Some(t) = app.try_state::<SatelliteTerminals>() { if let Ok(mut map) = t.0.lock() { map.remove(&id); } }
}

#[tauri::command]
async fn terminal_open(app: tauri::AppHandle, c: State<'_, Companion>, t: State<'_, SatelliteTerminals>, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    let reply = forward(&c, "terminal_open", json!({"cwd": cwd, "cols": cols, "rows": rows})).await?;
    let id = reply.as_u64().or_else(|| reply["id"].as_u64()).and_then(|n| u32::try_from(n).ok())
        .ok_or("The host returned an invalid terminal id")?;
    let task = tauri::async_runtime::spawn(poll_terminal(app, id));
    if let Some(old) = t.0.lock().map_err(|_| "terminal state poisoned")?.insert(id, task) { old.abort(); }
    Ok(id)
}
#[tauri::command]
async fn terminal_close(c: State<'_, Companion>, t: State<'_, SatelliteTerminals>, id: u32) -> Result<(), String> {
    if let Some(task) = t.0.lock().map_err(|_| "terminal state poisoned")?.remove(&id) { task.abort(); }
    forward(&c, "terminal_close", json!({"id": id})).await.map(|_| ())
}

// ---------------------------------------------------------------- runtime

pub fn run(context: tauri::Context<tauri::Wry>) {
    let local = local_handler();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol(crate::local_preview::SCHEME, |_, request| crate::local_preview::respond(request.uri().path()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(&root)?;
            // Only used for the local voice/scout/bug-walk roots; a satellite never spawns or upgrades a host.
            let binary = std::env::current_exe()?;
            let host = Host::new(root.clone(), binary);
            let window_config = app.config().app.windows.first().cloned().ok_or_else(|| std::io::Error::other("tauri.conf.json defines no window"))?;
            let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?;
            let builder = builder.with_webview_configuration(crate::writing_tools::configuration());
            let window = builder.build()?;
            crate::writing_tools::install(&window)?;
            crate::window_state::install(window, root.clone());
            app.manage(host);
            app.manage(crate::mobile::build_companion(app.handle()));
            let scout = scout_core::store::ScoutStore::load(root.join("scout/state.json")).map_err(|e| e.to_string());
            if let Err(error) = &scout { eprintln!("{}", json!({"event": "scout.load_failed", "error": error})); }
            app.manage(crate::scout::Scout(Mutex::new(scout)));
            app.manage(SatelliteTerminals::default());
            crate::updater::start(app.handle());
            crate::updater::install_menu(app)?;
            Ok(())
        })
        .invoke_handler(move |invoke| dispatch(&local, invoke))
        .build(context)
        .expect("error building Freddai satellite")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(t) = app.try_state::<SatelliteTerminals>() {
                    if let Ok(mut map) = t.0.lock() { for (_, task) in map.drain() { task.abort(); } }
                }
                crate::voice::transcribe::unload_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poll_error_classifier_separates_ended_sessions_from_connection_errors() {
        assert!(poll_error_is_terminal("Terminal 7 is not running"));
        assert!(poll_error_is_terminal("Unknown terminal 7"));
        assert!(!poll_error_is_terminal("connection refused"));
        assert!(!poll_error_is_terminal("Invalid terminal reply from host: eof"));
    }

    #[test]
    fn local_commands_are_unique_and_include_the_critical_ones() {
        let mut seen = std::collections::HashSet::new();
        for name in LOCAL_COMMANDS { assert!(seen.insert(*name), "duplicate local command {name}"); }
        for name in ["platform", "preview_file_url", "stage_attachments", "terminal_open", "terminal_close", "satellite_mode", "voice_status", "scout_state", "companion_pair", "preview_open", "browser_view", "updater_state"] {
            assert!(is_local(name), "{name} must be local");
        }
        // The desktop-only variants must reach the host, never a local handler.
        for name in ["snapshot_since", "terminal_write", "terminal_resize", "generated_file", "git_status", "save_project"] {
            assert!(!is_local(name), "{name} must be forwarded");
        }
        assert!(LOCAL_COMMANDS.iter().all(|n| !n.contains("::") && !n.is_empty()));
    }

    #[test]
    fn forward_body_has_command_and_args() {
        assert_eq!(forward_body("snapshot_since", json!({"revision": 3})), json!({"command": "snapshot_since", "args": {"revision": 3}}));
        assert_eq!(forward_body("detect_agents", Value::Null), json!({"command": "detect_agents", "args": null}));
    }

    #[test]
    fn polled_commands_keep_default_limits() {
        assert!(forward_limits("snapshot_since").is_none());
        assert!(forward_limits("terminal_poll").is_none());
        assert_eq!(forward_limits("git_push"), Some((Duration::from_secs(120), 120)));
    }

    #[test]
    fn failure_log_is_rate_limited_per_command() {
        let mut last = HashMap::new();
        let t0 = Instant::now();
        let gap = Duration::from_secs(5);
        assert!(should_log(&mut last, "a", t0, gap));
        assert!(!should_log(&mut last, "a", t0 + Duration::from_secs(4), gap));
        assert!(should_log(&mut last, "b", t0 + Duration::from_secs(4), gap));
        assert!(should_log(&mut last, "a", t0 + Duration::from_secs(5), gap));
    }

    #[test]
    fn poll_backs_off_after_twenty_empty_polls_and_resets() {
        assert_eq!(poll_delay(0), Duration::from_millis(150));
        assert_eq!(poll_delay(19), Duration::from_millis(150));
        assert_eq!(poll_delay(20), Duration::from_millis(1000));
        assert_eq!(poll_delay(500), Duration::from_millis(1000));
        assert_eq!(poll_delay(0), Duration::from_millis(150));
    }

    #[test]
    fn poll_reply_parses_host_shape() {
        let reply: PollReply = serde_json::from_value(json!({"chunks":[{"seq":4,"data":"hi"}],"next":5,"exited":true,"code":0,"truncated":true})).unwrap();
        assert_eq!((reply.chunks.len(), reply.next, reply.exited, reply.code, reply.truncated), (1, 5, true, Some(0), true));
        assert_eq!(reply.chunks[0].data, "hi");
    }

    #[test]
    fn preview_target_is_inside_the_private_folder_and_stable() {
        let root = Path::new("/tmp/app");
        let a = preview_target(root, "/Users/me/site/index.html").unwrap();
        assert_eq!(a, preview_target(root, "/Users/me/site/index.html").unwrap());
        assert_ne!(a, preview_target(root, "/Users/me/other/index.html").unwrap());
        assert!(a.starts_with("/tmp/app/satellite-previews"));
        assert_eq!(a.file_name().unwrap(), "index.html");
        assert!(preview_target(root, "/").is_err());
        assert!(preview_target(root, "/x/..").is_err());
        assert!(preview_target(root, "/x/.hidden.html").is_err());
        assert!(is_html_path("/a/b.HTML") && is_html_path("c.htm") && !is_html_path("/a/b.png"));
    }
}
