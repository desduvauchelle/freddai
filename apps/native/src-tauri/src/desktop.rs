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
    let target = dir.join(if cfg!(windows) { format!("{name}.exe") } else { name });
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
// Windows GetModuleFileName (current_exe) and canonicalize can spell the same
// executable differently (notably the \\?\ prefix). Compare resolved paths there.
fn host_build_matches(build: Option<&str>, binary: &std::path::Path) -> bool {
    if build == binary.to_str() { return true; }
    #[cfg(windows)]
    if let Some(build) = build {
        if let (Ok(actual), Ok(expected)) = (fs::canonicalize(build), fs::canonicalize(binary)) {
            return actual == expected;
        }
    }
    false
}
#[cfg(all(test, windows))]
mod windows_host_identity_tests {
    use super::*;
    #[test]
    fn extended_and_regular_executable_paths_identify_the_same_host() {
        let exe = std::env::current_exe().unwrap();
        let canonical = fs::canonicalize(&exe).unwrap();
        let extended = canonical.to_str().unwrap();
        let regular = extended.strip_prefix(r"\\?\").expect("Windows canonical path prefix");
        assert!(host_build_matches(Some(regular), &canonical));
        assert!(host_build_matches(Some(extended), std::path::Path::new(regular)));
        assert!(!host_build_matches(None, &canonical));
        assert!(!host_build_matches(Some("missing-other-build.exe"), &canonical));
    }
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
    if let Ok(reply) = freddai_core::host::call(&host.root, "hello", json!({})) {
        if reply["version"] == freddai_core::host::VERSION && host_build_matches(reply["build"].as_str(), &binary) {
            host.upgrade_resolved();
            return Ok(());
        }
        if let Err(e) = freddai_core::host::call(&host.root, "upgrade_idle", json!({})) {
            host.log_upgrade("host_upgrade.deferred", &e, running);
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    let mut cmd = freddai_core::platform::quiet_command(binary);
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
    #[cfg(windows)]
    {
        let log_path = host.root.join("host.log");
        let log = fs::OpenOptions::new().create(true).append(true).open(log_path).map_err(|e| e.to_string())?;
        cmd.stderr(Stdio::from(log));
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    for _ in 0..50 {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("Background host exited during startup ({status}). {}", if cfg!(windows) { format!("See {} for details.", host.root.join("host.log").display()) } else { "See ~/Library/Logs/Freddai/native.log for details.".into() }));
        }
        if freddai_core::host::call(&host.root, "hello", json!({}))
            .is_ok_and(|reply| host_build_matches(reply["build"].as_str(), &host.binary)) {
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
/// Apply a pending host update now, interrupting running threads. The host stops and persists its
/// sessions (resumable by a new message), exits, and the installed binary is started in its place.
fn force_upgrade_host(host: &Host) -> Result<usize, String> {
    let result = (|| {
        let reply = freddai_core::host::call(&host.root, "upgrade_force", json!({})).map_err(|e| {
            if e.contains("Unknown host command") {
                "The running background host predates forced restart. Quit Freddai (⌘Q) and reopen it from Applications.".to_string()
            } else { e }
        })?;
        let interrupted = reply["interrupted"].as_u64().unwrap_or(0) as usize;
        // Wait for the old host to release its socket before starting the installed one.
        for _ in 0..50 {
            if freddai_core::host::call(&host.root, "hello", json!({})).is_err() { break; }
            std::thread::sleep(Duration::from_millis(100));
        }
        ensure_host_inner(host, None)?;
        Ok(interrupted)
    })();
    match &result {
        Ok(n) => eprintln!("{}", json!({"event": "host_upgrade.forced", "interrupted": n})),
        Err(e) => eprintln!("{}", json!({"event": "host_upgrade.force_failed", "reason": e})),
    }
    result
}
#[tauri::command]
async fn restart_host_now(h: State<'_, Host>) -> Result<usize, String> {
    let host = h.inner().clone();
    tauri::async_runtime::spawn_blocking(move || force_upgrade_host(&host))
        .await
        .map_err(|e| e.to_string())?
}
/// One socket round trip per call. A hello is only needed to (re)start an unreachable host, so it
/// runs on the error path, never per poll.
fn call_with_recovery(host: &Host, method: &str, p: Value) -> Result<Value, String> {
    match freddai_core::host::call(&host.root, method, p.clone()) {
        result if method == "snapshot_since" && match &result {
            Err(e) => e.contains("Unknown host command"),
            Ok(reply) => !host_build_matches(reply["build"].as_str(), &host.binary),
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
            && matches!(p["action"].as_str(), Some("purge" | "archive" | "delete" | "restore" | "unarchive" | "move" | "pin" | "unpin")) => {
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
                    let mut full = call_with_recovery(&host, "snapshot", p.clone())?;
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
                result["host_update_pending"] = json!(!host_build_matches(hello["build"].as_str(), &host.binary));
            } else if result.get("host_update_pending").is_none() {
                result["host_update_pending"] = json!(!host_build_matches(result["build"].as_str(), &host.binary));
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
            if result["desktopProjection"] != true {
                if let Some(open) = p.get("openThreads").filter(|v| v.is_array()) {
                    let ids: Vec<String> = serde_json::from_value(open.clone()).map_err(|e| e.to_string())?;
                    freddai_core::desktop_snapshot::project_legacy(&mut result, &ids);
                }
            }
            return Ok(result);
        }
        freddai_core::host::call(&host.root, method, p)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn agent_config(h: State<'_, Host>, request: Value) -> Result<Value, String> {
    let request: freddai_core::agent_config::Request = serde_json::from_value(request).map_err(|e| format!("agent config request: {e}"))?;
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || freddai_core::agent_config::handle(&root, request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn git_history(path: String) -> Result<crate::git_history::GitHistory, String> {
    tauri::async_runtime::spawn_blocking(move || crate::git_history::read(&path))
        .await
        .map_err(|e| e.to_string())?
}
async fn git_blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn git_status(path: String) -> Result<crate::git_actions::GitStatusSummary, String> {
    git_blocking(move || crate::git_actions::status(&path)).await
}
#[tauri::command]
async fn git_diff_file(path: String, file: String, group: String) -> Result<String, String> {
    git_blocking(move || crate::git_actions::diff_file(&path, &file, &group)).await
}
#[tauri::command]
async fn git_stage(path: String, files: Option<Vec<String>>) -> Result<(), String> {
    git_blocking(move || match files { Some(f) => crate::git_actions::stage(&path, &f), None => crate::git_actions::stage_all(&path) }).await
}
#[tauri::command]
async fn git_unstage(path: String, files: Option<Vec<String>>) -> Result<(), String> {
    git_blocking(move || match files { Some(f) => crate::git_actions::unstage(&path, &f), None => crate::git_actions::unstage_all(&path) }).await
}
#[tauri::command]
async fn git_discard(path: String, file: String, group: String, code: String) -> Result<(), String> {
    git_blocking(move || crate::git_actions::discard(&path, &file, &group, &code)).await
}
#[tauri::command]
async fn git_commit(path: String, message: String, all: Option<bool>) -> Result<String, String> {
    git_blocking(move || crate::git_actions::commit(&path, &message, all.unwrap_or(false))).await
}
#[tauri::command]
async fn git_push(path: String) -> Result<String, String> {
    git_blocking(move || crate::git_actions::push(&path)).await
}
#[tauri::command]
async fn git_pull(path: String) -> Result<String, String> {
    git_blocking(move || crate::git_actions::pull(&path)).await
}
#[tauri::command]
async fn git_branches(path: String) -> Result<crate::git_actions::BranchList, String> {
    git_blocking(move || crate::git_actions::branches(&path)).await
}
#[tauri::command]
async fn git_switch_branch(path: String, name: String, create: Option<bool>) -> Result<(), String> {
    git_blocking(move || crate::git_actions::switch_branch(&path, &name, create.unwrap_or(false))).await
}
#[tauri::command]
async fn git_pr_status(path: String) -> Result<crate::git_actions::PrStatus, String> {
    git_blocking(move || Ok(crate::git_actions::pr_status(&path))).await
}
#[tauri::command]
async fn git_create_pr(path: String, title: String, body: String) -> Result<String, String> {
    git_blocking(move || crate::git_actions::create_pr(&path, &title, &body)).await
}
#[tauri::command]
async fn git_ship_preview(path: String) -> Result<crate::git_actions::ShipPreview, String> {
    git_blocking(move || crate::git_actions::ship_preview(&path)).await
}
/// Starts an AI commit-message suggestion (project's default agent, side request); poll the state.
#[tauri::command]
async fn git_commit_message_start(h: State<'_, Host>, project: String, stat: String, diff: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "commit_message_start", json!({"project":project,"stat":stat,"diff":diff})).await
}
#[tauri::command]
async fn git_commit_message_state(h: State<'_, Host>, project: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "commit_message_state", json!({"project":project})).await
}
/// Each thread gets one workspace webview backed by the same host, never a new agent.
#[tauri::command]
async fn open_thread_window(app: tauri::AppHandle, h: State<'_, Host>, session: String) -> Result<(), String> {
    let snapshot = rpc(h.inner().clone(), "snapshot", json!({})).await?;
    let thread = snapshot["sessions"].as_array()
        .and_then(|sessions| sessions.iter().find(|t| t["id"].as_str() == Some(session.as_str())))
        .ok_or("Thread no longer exists")?;
    let base = app.config().app.windows.first().cloned().ok_or("Missing window configuration")?;
    crate::thread_windows::open(app, base, session, thread["title"].as_str().unwrap_or("Thread")).await
}

#[tauri::command]
async fn snapshot(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "snapshot", json!({})).await
}
#[tauri::command]
async fn snapshot_since(h: State<'_, Host>, revision: u64, host_id: Option<String>, open_threads: Option<Vec<String>>) -> Result<Value, String> {
    // Older hosts ignore openThreads; request whole changed sessions so compatibility projection is lossless.
    rpc(h.inner().clone(), "snapshot_since", json!({"revision": revision, "hostId": host_id, "messageDeltas": open_threads.is_none(), "openThreads":open_threads})).await
}
#[tauri::command]
async fn tool_text(h: State<'_, Host>, thread: String, message: String, offset: u64, hash: Option<String>) -> Result<Value, String> {
    let host = h.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        match call_with_recovery(&host, "tool_text", json!({"thread":thread,"message":message,"offset":offset,"hash":hash})) {
            Err(e) if e.contains("Unknown host command") => {
                let db = call_with_recovery(&host, "snapshot", json!({}))?;
                let text = db["sessions"].as_array().and_then(|sessions| sessions.iter().find(|s| s["id"] == thread))
                    .and_then(|s| s["messages"].as_array()).and_then(|messages| messages.iter().find(|m| m["id"] == message && m["role"] == "tool"))
                    .and_then(|m| m["text"].as_str()).ok_or("Tool output unavailable")?;
                freddai_core::desktop_snapshot::text_chunk(text, offset as usize, hash.as_deref())
            }
            other => other,
        }
    }).await.map_err(|e| e.to_string())?
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
async fn import_candidates(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "import_candidates", json!({})).await
}
#[tauri::command]
async fn import_sessions(h: State<'_, Host>, sessions: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "import_sessions", json!({"sessions":sessions})).await
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
async fn commander_state(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_state", json!({})).await
}
#[tauri::command]
async fn commander_todos(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_todos", json!({})).await
}
#[tauri::command]
async fn commander_todo_save(h: State<'_, Host>, todo: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_todo_save", json!({"todo":todo})).await
}
#[tauri::command]
async fn commander_notes(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_notes", json!({})).await
}
#[tauri::command]
async fn commander_note_read(h: State<'_, Host>, name: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_note_read", json!({"name":name})).await
}
#[tauri::command]
async fn commander_note_write(h: State<'_, Host>, name: String, body: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_note_write", json!({"name":name,"body":body})).await
}
#[tauri::command]
async fn commander_proposals(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_proposals", json!({})).await
}
#[tauri::command]
async fn commander_proposal_respond(h: State<'_, Host>, id: String, approve: bool, prompt: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_proposal_respond", json!({"id":id,"approve":approve,"prompt":prompt})).await
}
#[tauri::command]
async fn commander_settings_get(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_settings_get", json!({})).await
}
#[tauri::command]
async fn commander_settings_save(h: State<'_, Host>, settings: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_settings_save", json!({"settings":settings})).await
}
#[tauri::command]
async fn commander_profile(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_profile", json!({})).await
}
#[tauri::command]
async fn commander_profile_save(h: State<'_, Host>, name: Option<String>, soul: Option<String>, user: Option<String>, reason: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_profile_save", json!({"name":name,"soul":soul,"user":user,"reason":reason})).await
}
#[tauri::command]
async fn commander_revision_restore(h: State<'_, Host>, file: String, at: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_revision_restore", json!({"file":file,"at":at})).await
}
#[tauri::command]
async fn commander_memory(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_memory", json!({})).await
}
#[tauri::command]
async fn commander_memory_save(h: State<'_, Host>, memory: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "commander_memory_save", json!({"memory":memory})).await
}
#[tauri::command]
async fn project_objective_set(h: State<'_, Host>, project: String, objective: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "project_objective_set", json!({"project":project,"objective":objective})).await
}
#[tauri::command]
async fn commander_settings_set(h: State<'_, Host>, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    // Read the raw body: an explicit `null` clears a setting, an absent key leaves it alone.
    let tauri::ipc::InvokeBody::Json(body) = request.body() else {
        return Err("commander_settings_set expects a JSON object".into());
    };
    let mut p = serde_json::Map::new();
    for key in ["account", "model"] {
        if let Some(value) = body.get(key) {
            p.insert(key.into(), value.clone());
        }
    }
    rpc(h.inner().clone(), "commander_settings_set", Value::Object(p)).await
}
#[tauri::command]
async fn load_project_order(h: State<'_, Host>) -> Result<Option<Vec<String>>, String> {
    crate::thread_list_settings::project_order(&h.root)
}
#[tauri::command]
async fn save_project_order(h: State<'_, Host>, order: Vec<String>) -> Result<(), String> {
    crate::thread_list_settings::save_project_order(&h.root, &order)
}
#[tauri::command]
async fn save_thread_list(h: State<'_, Host>, settings: crate::thread_list_settings::ThreadListSettings) -> Result<(), String> {
    let dir = h.root.join("companion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("thread-list.json");
    let temporary = dir.join("thread-list.json.tmp");
    std::fs::write(&temporary, serde_json::to_vec(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, path).map_err(|e| e.to_string())
}
#[tauri::command]
async fn save_preferences(h: State<'_, Host>, preferences: Option<Value>, patch: Option<Value>) -> Result<Value, String> {
    rpc(
        h.inner().clone(),
        "save_preferences",
        json!({"preferences":preferences,"patch":patch}),
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
async fn day_summary(h: State<'_, Host>, date: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "day_summary", json!({"date":date})).await
}
#[tauri::command]
async fn summarize_day(h: State<'_, Host>, date: String, force: Option<bool>) -> Result<Value, String> {
    rpc(h.inner().clone(), "summarize_day", json!({"date":date,"force":force.unwrap_or(false)})).await
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
async fn list_slash_commands(h: State<'_, Host>, session: Option<String>, project: Option<String>, account: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "list_slash_commands", json!({"session":session,"project":project,"account":account})).await
}
#[tauri::command]
async fn list_project_files(h: State<'_, Host>, session: Option<String>, project: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "list_project_files", json!({"session":session,"project":project})).await
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
async fn generated_file(h: State<'_, Host>, thread: String, href: String, offset: u64) -> Result<Value, String> {
    generated_chunk(h.inner().clone(), thread, href, offset).await
}
/// Opens a thread-referenced local HTML file in the browser panel: validated by the host reader, then served by `local_preview`.
#[tauri::command]
async fn preview_file_url(h: State<'_, Host>, thread: String, href: String) -> Result<Value, String> {
    let part = generated_chunk(h.inner().clone(), thread, href, 0).await?;
    let path = part["path"].as_str().ok_or("Restart Freddai so the background host can resolve file paths")?.to_string();
    let url = crate::local_preview::register(std::path::Path::new(&path))?;
    Ok(json!({"url":url,"path":path}))
}
async fn generated_chunk(h: Host, thread: String, href: String, offset: u64) -> Result<Value, String> {
    match rpc(h.clone(), "generated_file", json!({"thread":thread,"href":href,"offset":offset})).await {
        Err(e) if e.contains("Unknown host command") => {}, // preserved older host: retain existing preview compatibility
        other => return other,
    }
    let db: freddai_core::runtime::Database = serde_json::from_value(rpc(h.clone(), "snapshot", json!({})).await?).map_err(|e|e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || freddai_core::generated_files::chunk(&db, &thread, &href, offset)).await.map_err(|e|e.to_string())?
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
fn require_schedule_end_support(hello: &Value) -> Result<(), String> {
    if hello["schedule_end_dates"] == true { return Ok(()) }
    Err("The background host needs its update to enforce end dates. Let active work finish so it can update, then save again.".into())
}
#[cfg(test)]
#[test]
fn schedule_end_support_rejects_older_hosts() {
    assert!(require_schedule_end_support(&json!({"version":"2"})).is_err());
    assert!(require_schedule_end_support(&json!({"schedule_end_dates":false})).is_err());
    assert!(require_schedule_end_support(&json!({"schedule_end_dates":true})).is_ok());
}
fn require_schedule_run_limit_support(hello: &Value) -> Result<(), String> {
    if hello["schedule_run_limits"] == true { return Ok(()) }
    Err("The background host needs its update to enforce run limits. Let active work finish so it can update, then save again.".into())
}
#[cfg(test)]
#[test]
fn schedule_run_limit_support_rejects_older_hosts() {
    assert!(require_schedule_run_limit_support(&json!({"schedule_end_dates":true})).is_err());
    assert!(require_schedule_run_limit_support(&json!({"schedule_run_limits":true})).is_ok());
}
fn require_schedule_delivery_support(hello: &Value) -> Result<(), String> {
    if hello["schedule_delivery"] == true { return Ok(()) }
    Err("The background host needs its update for routine notifications and thread reuse. Let active work finish so it can update, then save again.".into())
}
#[cfg(test)]
#[test]
fn schedule_delivery_support_rejects_older_hosts() {
    assert!(require_schedule_delivery_support(&json!({"schedule_run_limits":true})).is_err());
    assert!(require_schedule_delivery_support(&json!({"schedule_delivery":false})).is_err());
    assert!(require_schedule_delivery_support(&json!({"schedule_delivery":true})).is_ok());
}
#[tauri::command]
async fn save_schedule(h: State<'_, Host>, schedule: Value) -> Result<Value, String> {
    // Old hosts ignore unknown JSON fields; never silently discard routine controls.
    if !schedule["end_date"].is_null() || !schedule["max_runs"].is_null() || schedule["new_chat"] == false || !schedule["notifications"].is_null() {
        let hello = rpc(h.inner().clone(), "hello", json!({})).await?;
        if !schedule["end_date"].is_null() { require_schedule_end_support(&hello)?; }
        if !schedule["max_runs"].is_null() { require_schedule_run_limit_support(&hello)?; }
        if schedule["new_chat"] == false || !schedule["notifications"].is_null() {
            require_schedule_delivery_support(&hello)?;
        }
    }
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
async fn google_capability(h: State<'_, Host>) -> Result<Value, String> {
    let hello = rpc(h.inner().clone(), "hello", json!({})).await?;
    Ok(crate::companion_operations::google_capability(&hello))
}
#[tauri::command]
async fn google_config_get(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_config_get", json!({})).await
}
#[tauri::command]
async fn google_config_set(h: State<'_, Host>, client_id: String, client_secret: Option<String>) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_config_set", json!({"clientId":client_id,"clientSecret":client_secret})).await
}
#[tauri::command]
async fn google_connect_start(h: State<'_, Host>, services: Option<Vec<String>>) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_connect_start", json!({"services":services})).await
}
#[tauri::command]
async fn google_connect_status(h: State<'_, Host>, flow_id: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_connect_status", json!({"flowId":flow_id})).await
}
#[tauri::command]
async fn google_accounts(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_accounts", json!({})).await
}
#[tauri::command]
async fn google_disconnect(h: State<'_, Host>, email: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_disconnect", json!({"email":email})).await
}
#[tauri::command]
async fn google_triggers(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_triggers", json!({})).await
}
#[tauri::command]
async fn google_trigger_save(h: State<'_, Host>, trigger: Value) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_trigger_save", json!({"trigger":trigger})).await
}
#[tauri::command]
async fn google_trigger_delete(h: State<'_, Host>, id: String) -> Result<Value, String> {
    rpc(h.inner().clone(), "google_trigger_delete", json!({"id":id})).await
}
#[tauri::command]
async fn stop_all(h: State<'_, Host>) -> Result<Value, String> {
    rpc(h.inner().clone(), "stop_all", json!({})).await
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_status(h: State<'_, Host>) -> Result<crate::voice::VoiceStatus, String> {
    Ok(crate::voice::status(&h.root))
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_update_settings(h: State<'_, Host>, settings: crate::voice::settings::SettingsPatch) -> Result<crate::voice::VoiceStatus, String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || crate::voice::update_settings(&root, settings))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_download_model(h: State<'_, Host>, id: String) -> Result<crate::voice::VoiceStatus, String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || crate::voice::download_model(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_cancel_download(h: State<'_, Host>, id: String) -> Result<crate::voice::VoiceStatus, String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || crate::voice::cancel_download(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_delete_model(h: State<'_, Host>, id: String) -> Result<crate::voice::VoiceStatus, String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || crate::voice::delete_model(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_start_recording(h: State<'_, Host>) -> Result<(), String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || crate::voice::start_recording(&root))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_stop_recording(h: State<'_, Host>) -> Result<crate::voice::Transcript, String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || crate::voice::stop_recording(&root))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
fn voice_recording_level() -> f32 {
    crate::voice::recorder::level()
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_cancel_recording() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(crate::voice::cancel_recording)
        .await
        .map_err(|e| e.to_string())
}
#[cfg(target_os = "macos")]
fn voice_emitter(app: &tauri::AppHandle) -> crate::voice::call::Emit {
    let app = app.clone();
    std::sync::Arc::new(move |event: &str, payload: Value| {
        if let Err(e) = tauri::Emitter::emit(&app, event, payload) {
            eprintln!("voice.emit.failed event={event} error={e}");
        }
    })
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_call_start(app: tauri::AppHandle, h: State<'_, Host>, silence_ms: Option<u32>, min_speech_ms: Option<u32>) -> Result<(), String> {
    let (root, emit) = (h.root.clone(), voice_emitter(&app));
    tauri::async_runtime::spawn_blocking(move || crate::voice::call::start(&root, emit, silence_ms, min_speech_ms))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_call_stop() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(crate::voice::call::stop).await.map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_call_set_listening(listening: bool) -> Result<(), String> {
    crate::voice::call::set_listening(listening)
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_speak(app: tauri::AppHandle, text: String, voice: Option<String>, rate: Option<u32>) -> Result<(), String> {
    let emit = voice_emitter(&app);
    tauri::async_runtime::spawn_blocking(move || crate::voice::tts::speak(&emit, &text, voice.as_deref(), rate))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_stop_speaking(app: tauri::AppHandle) -> Result<(), String> {
    let emit = voice_emitter(&app);
    tauri::async_runtime::spawn_blocking(move || crate::voice::tts::stop(&emit)).await.map_err(|e| e.to_string())
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn voice_list_voices() -> Result<Vec<crate::voice::tts::Voice>, String> {
    tauri::async_runtime::spawn_blocking(crate::voice::tts::list_voices).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn startup_status() -> bool {
    #[cfg(windows)]
    return crate::windows_startup::enabled();
    #[cfg(not(windows))]
    {
    std::env::var_os("HOME")
        .map(|h| {
            PathBuf::from(h)
                .join("Library/LaunchAgents/com.freddai.host.plist")
                .exists()
        })
        .unwrap_or(false)
}
}
#[tauri::command]
fn set_start_at_login(h: State<Host>, enabled: bool) -> Result<(), String> {
    configure_start_at_login(h.inner(), enabled)
}
fn configure_start_at_login(h: &Host, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    return crate::windows_startup::configure(&h.binary, &h.root, enabled);
    #[cfg(not(windows))]
    {
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
}

#[tauri::command]
fn platform() -> &'static str { "desktop" }

#[tauri::command]
fn companion_devices(h: State<'_,Host>) -> Result<Value,String> {crate::companion_pairing::status(&h.root)}
#[tauri::command]
fn companion_device_action(h: State<'_,Host>, action:String, id:String) -> Result<Value,String> {
    #[cfg(target_os = "macos")]
    if action=="begin" {
        crate::companion_pairing::provision(&h.root)?;
        crate::companion_server::ensure(h.root.clone(),h.binary.clone())?;
    }
    crate::companion_pairing::control(&h.root,&action,&id)
}
#[cfg(target_os = "macos")]
#[tauri::command]
fn awake_status(h: State<'_,Host>) -> Result<Value,String> {crate::awake::status(&h.root)}
#[cfg(target_os = "macos")]
#[tauri::command]
fn awake_set_settings(h: State<'_,Host>, while_working:bool, while_paired:bool) -> Result<Value,String> {
    crate::awake::save_settings(&h.root,&crate::awake::AwakeSettings{while_working,while_paired})?;
    crate::awake::status(&h.root)
}


pub fn run(context: tauri::Context<tauri::Wry>) {
    tauri::Builder::default().plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol(crate::local_preview::SCHEME, |_, request| crate::local_preview::respond(request.uri().path()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
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
            let window_config = app.config().app.windows.first().cloned().ok_or_else(|| std::io::Error::other("tauri.conf.json defines no window"))?;
            let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?;
            #[cfg(target_os = "macos")]
            let builder = builder.with_webview_configuration(crate::writing_tools::configuration());
            let window = builder.build()?;
            #[cfg(target_os = "macos")]
            crate::writing_tools::install(&window)?;
            crate::window_state::install(window, host.root.clone());
            app.manage(host);
            app.manage(crate::terminal::Terminals::default());
            crate::updater::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(target_os = "macos")] crate::satellite::satellite_mode,
            #[cfg(target_os = "macos")] crate::satellite::satellite_set_mode,
            crate::browser::browser_view,
            platform,
            open_thread_window,
            companion_devices,
            companion_device_action,
            #[cfg(target_os = "macos")]
            awake_status,
            #[cfg(target_os = "macos")]
            awake_set_settings,
            git_history,
            agent_config,
            git_status,
            git_diff_file,
            git_stage,
            git_unstage,
            git_discard,
            git_commit,
            git_push,
            git_pull,
            git_branches,
            git_switch_branch,
            git_pr_status,
            git_create_pr,
            git_ship_preview,
            git_commit_message_start,
            git_commit_message_state,
            crate::terminal::terminal_open,
            crate::terminal::terminal_write,
            crate::terminal::terminal_resize,
            crate::terminal::terminal_close,
            snapshot,
            snapshot_since,
            tool_text,
            detect_agents,
            detect_existing_sign_ins,
            connect_existing,
            add_account,
            remove_account,
            rename_account,
            save_project,
            import_project,
            import_candidates,
            import_sessions,
            save_preferences,
            save_thread_list,
            load_project_order,
            save_project_order,
            commander_state,
            commander_todos,
            commander_todo_save,
            commander_notes,
            commander_note_read,
            commander_note_write,
            commander_proposals,
            commander_proposal_respond,
            commander_profile,
            commander_settings_get,
            commander_settings_save,
            commander_profile_save,
            commander_revision_restore,
            commander_memory,
            commander_memory_save,
            project_objective_set,
            commander_settings_set,
            login,
            login_state,
            cancel_login,
            auth_status,
            account_usage,
            consume_reset,
            account_models,
            day_summary,
            summarize_day,
            launch,
            queue_message,
            list_slash_commands,
            list_project_files,
            steer_message,
            queue_action,
            stop,
            respond,
            stage_attachments,
            preview_attachment,
            generated_file,
            preview_file_url,
            capture_screenshot,
            rename_session,
            mark_read,
            merge_read,
            thread_action,
            remove_worktree,
            save_schedule,
            schedule_action,
            google_capability,
            google_config_get,
            google_config_set,
            google_connect_start,
            google_connect_status,
            google_accounts,
            google_disconnect,
            google_triggers,
            google_trigger_save,
            google_trigger_delete,
            stop_all,
            restart_host_now,
            startup_status,
            set_start_at_login,
            crate::updater::updater_state,
            crate::updater::check_for_updates,
            crate::updater::install_update,
            crate::updater::restart_app,
            crate::updater::open_release_page,
            #[cfg(target_os = "macos")]
            voice_status,
            #[cfg(target_os = "macos")]
            voice_update_settings,
            #[cfg(target_os = "macos")]
            voice_download_model,
            #[cfg(target_os = "macos")]
            voice_cancel_download,
            #[cfg(target_os = "macos")]
            voice_delete_model,
            #[cfg(target_os = "macos")]
            voice_start_recording,
            #[cfg(target_os = "macos")]
            voice_stop_recording,
            #[cfg(target_os = "macos")]
            voice_cancel_recording,
            #[cfg(target_os = "macos")]
            voice_recording_level,
            #[cfg(target_os = "macos")]
            voice_call_start,
            #[cfg(target_os = "macos")]
            voice_call_stop,
            #[cfg(target_os = "macos")]
            voice_call_set_listening,
            #[cfg(target_os = "macos")]
            voice_speak,
            #[cfg(target_os = "macos")]
            voice_stop_speaking,
            #[cfg(target_os = "macos")]
            voice_list_voices
        ])
        .build(context)
        .expect("error building Freddai")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(t) = app.try_state::<crate::terminal::Terminals>() { t.close_all(); }
            }
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Exit) {
                crate::voice::transcribe::unload_all();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = event;
        });
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
    fn thread_window_routes_exact_id_and_preserves_native_chrome() {
        let mut base = tauri::utils::config::WindowConfig::default();
        base.visible = false;
        base.min_width = Some(640.);
        let id = "thread / ?&=# café";
        let config = crate::thread_windows::window_config(base, "thread-test".into(), id, "Focused task").unwrap();
        assert_eq!(config.label, "thread-test");
        assert_eq!(config.title, "Focused task — Freddai");
        assert!(config.visible);
        assert_eq!(config.min_width, Some(640.));
        let tauri::WebviewUrl::App(path) = config.url else { panic!("Expected bundled app URL") };
        let url = tauri::Url::parse(&format!("http://localhost/{}", path.display())).unwrap();
        assert_eq!(url.path(), "/index.html");
        assert_eq!(url.query_pairs().collect::<Vec<_>>(), vec![("thread".into(), id.into())]);
        assert_eq!(url.fragment(), None);
    }

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

    #[cfg(unix)]
    #[test]
    fn forced_restart_on_legacy_host_fails_loudly() {
        use std::os::unix::net::UnixListener;
        use std::io::{BufRead, BufReader, Write};
        let root = std::env::temp_dir().join(format!("freddai-force-legacy-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let listener = UnixListener::bind(root.join("host.sock")).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(&stream).read_line(&mut line).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["method"], "upgrade_force");
            writeln!(stream, "{}", json!({"error":"Unknown host command: upgrade_force"})).unwrap();
        });
        let error = force_upgrade_host(&Host::new(root.clone(), PathBuf::from("new-host"))).unwrap_err();
        server.join().unwrap();
        let _ = fs::remove_dir_all(&root);
        assert!(error.contains("Quit Freddai"), "{error}");
    }
}
