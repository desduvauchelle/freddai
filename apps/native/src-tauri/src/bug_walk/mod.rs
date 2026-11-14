//! Bug walk (docs/spec.md "Bug walk"): record a screen region plus voice through `bugwalk-helper`, transcribe locally,
//! have a hidden analysis thread turn the transcript into a bug list, grab frames and start a fix thread. The walk
//! directory (`<app_data>/bug-walks/<id>/`) is deleted as soon as the fix thread exists. macOS only.

pub mod analysis;
pub mod companion;
pub mod helper;
pub mod intake;
pub mod settings;
pub mod tray;

use crate::desktop::{rpc, Host};
use analysis::{FrameKind, Item, PlannedFrame};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use settings::BugWalkSettings;
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{ChildStdin, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const STATE_EVENT: &str = "bug-walk://state";
const HOTKEY_EVENT: &str = "bug-walk://hotkey";
const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(180);

/// What `select` picked. Walks written before window mode have no `kind`: they are regions.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    #[default]
    Region,
    Window,
}

/// The recorded target: a display region (`kind: region`) or an app window (`kind: window`, plus the window fields).
/// For windows `x`/`y`/`width`/`height` are the window frame at selection time (the recording size stays fixed).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Region {
    #[serde(default)]
    pub kind: TargetKind,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_id: Option<u64>,
    /// Global logical points (top-left origin); `x`/`y` stay display-local because `record` wants those.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}
impl Region {
    /// What the UI sees: global x/y (local when the helper predates global coordinates), no display id.
    fn public(&self) -> Region {
        Region { x: self.global_x.unwrap_or(self.x), y: self.global_y.unwrap_or(self.y), display_id: None, global_x: None, global_y: None, ..self.clone() }
    }

    /// `record` arguments for this target (after `record`, before `--out`).
    fn record_args(&self) -> Vec<String> {
        let display = self.display_id.unwrap_or(0).to_string();
        match (self.kind, self.window_id) {
            (TargetKind::Window, Some(w)) => vec!["--window-id".into(), w.to_string(), "--display-id".into(), display],
            _ => vec!["--display-id".into(), display, "--x".into(), self.x.to_string(), "--y".into(), self.y.to_string(), "--width".into(), self.width.to_string(), "--height".into(), self.height.to_string()],
        }
    }
}

/// Parses the last JSON line `select` printed. Missing `kind` (older helper) is a region.
fn parse_selection(stdout: &str) -> Result<Region, String> {
    let line = stdout.lines().rev().find(|l| l.trim_start().starts_with('{')).ok_or("bugwalk-helper select returned no region")?;
    let v: Value = serde_json::from_str(line).map_err(|e| format!("bugwalk-helper select output was not JSON: {e}"))?;
    if !v["display_id"].is_number() { return Err("bugwalk-helper select returned no region".into()); }
    let kind = match v["kind"].as_str() {
        None | Some("region") => TargetKind::Region,
        Some("window") => TargetKind::Window,
        Some(other) => return Err(format!("bugwalk-helper select returned unknown kind \"{other}\"")),
    };
    let window_id = v["window_id"].as_u64().and_then(|n| u32::try_from(n).ok());
    if kind == TargetKind::Window && window_id.is_none() { return Err("bugwalk-helper select returned a window without window_id".into()); }
    let text = |k: &str| v[k].as_str().map(str::to_owned);
    Ok(Region {
        kind,
        x: v["x"].as_f64().unwrap_or(0.0),
        y: v["y"].as_f64().unwrap_or(0.0),
        width: v["width"].as_f64().unwrap_or(0.0),
        height: v["height"].as_f64().unwrap_or(0.0),
        scale: v["scale"].as_f64().unwrap_or(1.0),
        display_id: v["display_id"].as_u64(),
        global_x: v["global_x"].as_f64(),
        global_y: v["global_y"].as_f64(),
        window_id,
        bundle_id: text("bundle_id"),
        app_name: text("app_name"),
        title: text("title"),
    })
}

/// `bug_walk_start` mode: "zone" (drag a region, the default) or "app" (pick a window).
fn select_mode_arg(mode: &str) -> Result<&'static str, String> {
    match mode {
        "zone" => Ok("region"),
        "app" => Ok("window"),
        other => Err(format!("Unknown bug walk mode \"{other}\" (expected zone or app)")),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Origin {
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub thread: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Walk {
    pub id: String,
    pub started_at: u64,
    pub origin: Origin,
    pub region: Region,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_s: Option<f64>,
    pub phase: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<i32>,
    /// Why the walk left `recording` without a clean stop (recorder died, app exited, stop timed out).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Where the recording came from: None for the Mac recorder, "companion" for a video uploaded from an iPhone/iPad.
    /// Companion walks keep their dir after the pipeline finishes so the phone can poll the outcome.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Thread ids launched by the pipeline (set on `done`; companion walks only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sessions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendOpts {
    pub project: String,
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    pub permission_mode: String,
    #[serde(default)]
    pub reply_to_thread: Option<String>,
    /// "single" (default) or "per_item": one fix thread per analysis item. Ignored when `reply_to_thread` is set.
    #[serde(default = "default_split")]
    pub split: String,
}

fn default_split() -> String {
    "single".into()
}

impl SendOpts {
    fn per_item(&self) -> bool {
        self.split == "per_item" && self.reply_to_thread.is_none()
    }
}

#[derive(Debug, Serialize)]
pub struct Orphan {
    pub id: String,
    pub started_at: u64,
    pub duration_s: f64,
}

#[derive(Default, Serialize, Clone)]
struct StatePayload {
    id: String,
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    region: Option<Region>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elapsed_s: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    /// All launched thread ids (`done`); `session_id` is the first.
    #[serde(skip_serializing_if = "Option::is_none")]
    session_ids: Option<Vec<String>>,
    /// `launching` progress for "One per bug".
    #[serde(skip_serializing_if = "Option::is_none")]
    launched: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript: Option<String>,
    /// `max-duration` when the recorder stopped itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

fn emit(app: &AppHandle, p: StatePayload) {
    // Phase names only: transcripts and paths are never logged.
    eprintln!("{}", json!({"event":"bug_walk.state","id":p.id,"phase":p.phase,"error":p.error}));
    tray::sync(app, p.phase, &p.id, p.elapsed_s);
    let _ = app.emit(STATE_EVENT, p);
}

fn state(id: &str, phase: &'static str) -> StatePayload {
    StatePayload { id: id.into(), phase, ..Default::default() }
}

enum Ev {
    Started,
    Stopped { duration_s: f64 },
    Exited(String),
}

struct Active {
    id: String,
    pid: i32,
    selecting: bool,
    stdin: Option<ChildStdin>,
    events: Option<mpsc::Receiver<Ev>>,
    /// Set by the reader thread once the recorder is done (stopped or exited).
    finished: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct BugWalks {
    active: Mutex<Option<Active>>,
    /// Walks created by this process; everything else in `bug-walks/` that is mid-recording is an orphan.
    live: Mutex<HashSet<String>>,
    cancelled: Mutex<HashSet<String>>,
    shortcut_error: Mutex<Option<String>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

// ---- walk directory -------------------------------------------------------------------------------------------

pub(crate) fn walks_root(root: &Path) -> PathBuf {
    root.join("bug-walks")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub(crate) fn walk_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid bug walk id".into());
    }
    Ok(walks_root(root).join(id))
}

pub(crate) fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub(crate) fn write_walk(dir: &Path, walk: &Walk) -> Result<(), String> {
    let tmp = dir.join("walk.json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(walk).unwrap()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("walk.json")).map_err(|e| e.to_string())
}

pub(crate) fn read_walk(dir: &Path) -> Result<Walk, String> {
    let b = fs::read(dir.join("walk.json")).map_err(|_| "Bug walk not found (it may already have been sent or discarded)".to_string())?;
    serde_json::from_slice(&b).map_err(|e| format!("walk.json is corrupt: {e}"))
}

fn update_walk(dir: &Path, f: impl FnOnce(&mut Walk)) {
    match read_walk(dir) {
        Ok(mut w) => {
            f(&mut w);
            if let Err(e) = write_walk(dir, &w) { eprintln!("{}", json!({"event":"bug_walk.walk_json_write_failed","error":e})); }
        }
        Err(e) => eprintln!("{}", json!({"event":"bug_walk.walk_json_read_failed","error":e})),
    }
}

/// 16 kHz mono pcm16 with a 44-byte header.
fn wav_duration(dir: &Path) -> Option<f64> {
    let len = fs::metadata(dir.join("audio.wav")).ok()?.len();
    (len > 44).then(|| (len - 44) as f64 / 32_000.0)
}

fn duration_of(dir: &Path, walk: &Walk) -> f64 {
    walk.duration_s.or_else(|| wav_duration(dir)).unwrap_or(0.0)
}

fn pid_alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks existence.
    if unsafe { libc::kill(pid, 0) } != 0 { return false; }
    // A recycled pid must not hide an orphan: only a live bugwalk-helper counts as the recorder.
    let mut buf = [0u8; 4096];
    // SAFETY: proc_pidpath writes at most `buf.len()` bytes into our buffer.
    let n = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32) };
    if n <= 0 { return true; } // cannot tell: assume it is still the recorder
    String::from_utf8_lossy(&buf[..n as usize]).ends_with("bugwalk-helper")
}

/// A walk must never stay `recording` on disk once its recorder is gone. Audio that exists makes it `stopped` (the
/// orphan prompt can then offer it); no audio makes it `error`. Returns true when the walk is recoverable.
fn recover_walk(dir: &Path, reason: &str) -> bool {
    let audio = wav_duration(dir);
    let mut recovered = false;
    update_walk(dir, |w| {
        if w.phase != "recording" { recovered = w.phase == "stopped"; return; }
        w.reason = Some(reason.to_string());
        match audio {
            Some(d) => { w.phase = "stopped".into(); w.duration_s = Some(d); recovered = true; }
            None => w.phase = "error".into(),
        }
    });
    eprintln!("{}", json!({"event":"bug_walk.recovered","reason":reason,"audio_s":audio,"recoverable":recovered}));
    recovered
}

/// SIGTERM (helper finalizes its files) then wait up to `grace`, then SIGKILL.
fn terminate(pid: i32, grace: Duration) {
    // SAFETY: plain signal to the recorder child we spawned.
    unsafe { libc::kill(pid, libc::SIGTERM); }
    let deadline = Instant::now() + grace;
    while pid_alive(pid) && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(100)); }
    if pid_alive(pid) { eprintln!("{}", json!({"event":"bug_walk.helper_sigkill","pid":pid})); kill(pid); }
}

/// App exit (`RunEvent::Exit`): ask a running recorder to stop so recording.mov and audio.wav are finalized, then make
/// sure walk.json does not stay `recording`.
pub fn shutdown(app: &AppHandle) {
    let Some(walks) = app.try_state::<BugWalks>() else { return };
    let Some(mut a) = lock(&walks.active).take() else { return };
    if a.selecting || a.finished.load(Ordering::SeqCst) { if a.selecting { kill(a.pid); } return; }
    eprintln!("{}", json!({"event":"bug_walk.shutdown_stop","id":a.id,"pid":a.pid}));
    if let Some(mut stdin) = a.stdin.take() { let _ = stdin.write_all(b"stop\n").and_then(|_| stdin.flush()); }
    terminate(a.pid, Duration::from_secs(8));
    if let Some(h) = app.try_state::<Host>() {
        if let Ok(dir) = walk_dir(&h.root, &a.id) { recover_walk(&dir, "app-exit"); }
    }
}

/// Walk dirs left in phase recording/stopped with no live owner. `alive` reports whether a recorder pid still runs.
fn scan_orphans(root: &Path, live: &HashSet<String>, alive: impl Fn(i32) -> bool) -> Vec<Orphan> {
    let Ok(entries) = fs::read_dir(walks_root(root)) else { return vec![] };
    let mut out: Vec<Orphan> = entries
        .flatten()
        .filter_map(|e| {
            let dir = e.path();
            let walk = read_walk(&dir).ok()?;
            if walk.source.as_deref() == Some("companion") { return None; } // owned by bug_walk::intake
            let id = e.file_name().to_string_lossy().to_string();
            if live.contains(&id) || !matches!(walk.phase.as_str(), "recording" | "stopped") || walk.pid.is_some_and(&alive) {
                return None;
            }
            // Nothing to send without audio: leave such a dir alone (recover_walk marks it `error`).
            wav_duration(&dir)?;
            Some(Orphan { id, started_at: walk.started_at, duration_s: duration_of(&dir, &walk) })
        })
        .collect();
    out.sort_by_key(|o| o.started_at);
    out
}

fn remove_dir(dir: &Path) {
    if let Err(e) = fs::remove_dir_all(dir) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("{}", json!({"event":"bug_walk.cleanup_failed","error":e.to_string()}));
        }
    }
}

fn local_label(unix: u64) -> String {
    let t = unix as libc::time_t;
    // SAFETY: localtime_r/strftime write only into the buffers we own.
    unsafe {
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&t, &mut tm).is_null() { return unix.to_string(); }
        let mut buf = [0u8; 32];
        let n = libc::strftime(buf.as_mut_ptr() as *mut libc::c_char, buf.len(), c"%Y-%m-%d %H:%M".as_ptr(), &tm);
        String::from_utf8_lossy(&buf[..n]).to_string()
    }
}

// ---- recording ------------------------------------------------------------------------------------------------

fn start_blocking(app: AppHandle, root: PathBuf, id: String, origin: Origin, mode: &'static str) -> Result<Value, String> {
    let walks = app.state::<BugWalks>();
    {
        let mut active = lock(&walks.active);
        if active.as_ref().is_some_and(|a| !a.finished.load(Ordering::SeqCst)) {
            return Err("A bug walk is already running".into());
        }
        *active = None;
    }
    let fail = |e: String| -> Result<Value, String> {
        lock(&walks.live).remove(&id);
        emit(&app, StatePayload { error: Some(e.clone()), ..state(&id, "error") });
        Err(e)
    };
    let helper = match helper::locate().and_then(|h| helper::preflight(&h).map(|_| h)) {
        Ok(h) => h,
        Err(e) => return fail(e),
    };
    lock(&walks.live).insert(id.clone());
    emit(&app, state(&id, "selecting"));
    let mut select = match Command::new(&helper).args(["select", "--mode", mode]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => return fail(format!("Could not run bugwalk-helper: {e}")),
    };
    *lock(&walks.active) = Some(Active { id: id.clone(), pid: select.id() as i32, selecting: true, stdin: None, events: None, finished: Arc::new(AtomicBool::new(false)) });
    let (mut so, mut se) = (select.stdout.take().unwrap(), select.stderr.take().unwrap());
    let err_thread = std::thread::spawn(move || { let mut s = String::new(); let _ = se.read_to_string(&mut s); s });
    let mut out = String::new();
    let _ = so.read_to_string(&mut out);
    let status = select.wait().map_err(|e| e.to_string());
    let stderr = err_thread.join().unwrap_or_default();
    *lock(&walks.active) = None;
    let was_cancelled = lock(&walks.cancelled).remove(&id);
    let code = status.as_ref().ok().and_then(|s| s.code());
    if was_cancelled || code == Some(2) || (code.is_none() && stderr.trim().is_empty()) {
        lock(&walks.live).remove(&id);
        emit(&app, state(&id, "cancelled"));
        return Ok(json!({"id":id,"cancelled":true}));
    }
    if code != Some(0) {
        return fail(helper::error_from_stderr(&stderr, "region selection failed"));
    }
    let region = match parse_selection(&out) {
        Ok(r) => r,
        Err(e) => return fail(e),
    };
    eprintln!("{}", json!({"event":"bug_walk.selected","id":id,"kind":region.kind,"window_id":region.window_id,"bundle_id":region.bundle_id,"width":region.width,"height":region.height}));
    if region.global_x.is_none() || region.global_y.is_none() {
        eprintln!("{}", json!({"event":"bug_walk.warning","detail":"select output has no global_x/global_y (old helper build); using display-local coordinates"}));
    }
    let dir = walk_dir(&root, &id)?;
    if let Err(e) = fs::create_dir_all(&dir) { return fail(e.to_string()); }
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let mut walk = Walk { id: id.clone(), started_at: now_s(), origin, region: region.clone(), duration_s: None, phase: "recording".into(), pid: None, reason: None, source: None, sessions: None };
    if let Err(e) = write_walk(&dir, &walk) { remove_dir(&dir); return fail(e); }
    let mut rec = match Command::new(&helper)
        .arg("record")
        .args(region.record_args())
        .arg("--out").arg(&dir)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => { remove_dir(&dir); return fail(format!("Could not run bugwalk-helper: {e}")); }
    };
    walk.pid = Some(rec.id() as i32);
    let _ = write_walk(&dir, &walk);
    let (tx, rx) = mpsc::channel();
    let finished = Arc::new(AtomicBool::new(false));
    *lock(&walks.active) = Some(Active { id: id.clone(), pid: rec.id() as i32, selecting: false, stdin: rec.stdin.take(), events: None, finished: finished.clone() });
    let (stdout, mut stderr_pipe) = (rec.stdout.take().unwrap(), rec.stderr.take().unwrap());
    let err_thread = std::thread::spawn(move || { let mut s = String::new(); let _ = stderr_pipe.read_to_string(&mut s); s });
    {
        let (app, id, dir, region) = (app.clone(), id.clone(), dir.clone(), region.public());
        std::thread::spawn(move || {
            let mut started: Option<Instant> = None;
            let mut stopped = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                match v["event"].as_str() {
                    Some("started") => { started = Some(Instant::now()); let _ = tx.send(Ev::Started); }
                    Some("level") => emit_quiet(&app, StatePayload {
                        region: Some(region.clone()),
                        elapsed_s: started.map(|s| s.elapsed().as_secs_f64()),
                        level: v["rms"].as_f64(),
                        ..state(&id, "recording")
                    }),
                    Some("warning") => {
                        // The video writer died mid-recording: say so now, not after the walk is gone.
                        let detail = v["detail"].as_str().unwrap_or("unknown").to_string();
                        eprintln!("{}", json!({"event":"bug_walk.helper_warning","id":id,"code":v["code"],"detail":detail}));
                        let _ = app.emit(STATE_EVENT, StatePayload {
                            region: Some(region.clone()),
                            error: Some(format!("The screen video stopped recording ({detail}). Audio is still being captured.")),
                            ..state(&id, "recording")
                        });
                    }
                    Some("stopped") => {
                        stopped = true;
                        if v["partial"].as_bool() == Some(true) { eprintln!("{}", json!({"event":"bug_walk.partial_stop","id":id,"reason":v["reason"],"detail":v["detail"]})); }
                        let duration_s = v["duration_s"].as_f64().unwrap_or_else(|| started.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0));
                        update_walk(&dir, |w| { w.phase = "stopped".into(); w.duration_s = Some(duration_s); });
                        emit(&app, StatePayload { region: Some(region.clone()), elapsed_s: Some(duration_s), reason: v["reason"].as_str().map(str::to_owned), ..state(&id, "stopped") });
                        finished.store(true, Ordering::SeqCst);
                        let _ = tx.send(Ev::Stopped { duration_s });
                    }
                    _ => {}
                }
            }
            let status = rec.wait();
            let stderr = err_thread.join().unwrap_or_default();
            finished.store(true, Ordering::SeqCst);
            // Helper breadcrumbs (`{"log":...}`) and its exit status, so a lost walk can be diagnosed from the app log.
            eprintln!("{}", json!({"event":"bug_walk.helper_exit","id":id,"status":status.as_ref().map(|s| s.to_string()).unwrap_or_else(|e| e.to_string()),"stopped_event":stopped,"helper_stderr":stderr.chars().rev().take(2000).collect::<String>().chars().rev().collect::<String>()}));
            if !stopped {
                let mut msg = helper::error_from_stderr(&stderr, "The recorder exited unexpectedly");
                let was_cancelled = lock(&app.state::<BugWalks>().cancelled).contains(&id);
                if !was_cancelled {
                    // Never leave the walk at `recording` on disk; keep whatever audio exists as a recoverable walk.
                    if recover_walk(&dir, &msg) {
                        lock(&app.state::<BugWalks>().live).remove(&id);
                        msg.push_str(" The audio was saved: dismiss this and it is offered as an unfinished walk.");
                    }
                    emit(&app, StatePayload { error: Some(msg.clone()), ..state(&id, "error") });
                }
                let _ = tx.send(Ev::Exited(msg));
            }
        });
    }
    if let Some(a) = lock(&walks.active).as_mut() { a.events = Some(rx); }
    // Wait for the recorder to confirm it is running.
    let first = { let g = lock(&walks.active); g.as_ref().and_then(|a| a.events.as_ref().map(|r| r.recv_timeout(Duration::from_secs(15)))) };
    match first {
        Some(Ok(Ev::Started)) => {}
        other => {
            let msg = match other { Some(Ok(Ev::Exited(m))) => m, Some(Ok(Ev::Stopped { .. })) => "The recorder stopped immediately".into(), _ => "The recorder did not start within 15 seconds".into() };
            if let Some(a) = lock(&walks.active).take() { kill(a.pid); }
            remove_dir(&dir);
            return fail(msg);
        }
    }
    emit(&app, StatePayload { region: Some(region.public()), elapsed_s: Some(0.0), ..state(&id, "recording") });
    Ok(json!({"id":id}))
}

/// Level events arrive every 200 ms: skip the log line, keep the event.
fn emit_quiet(app: &AppHandle, p: StatePayload) {
    tray::sync(app, p.phase, &p.id, p.elapsed_s);
    let _ = app.emit(STATE_EVENT, p);
}

fn kill(pid: i32) {
    // SAFETY: plain signal to a child we spawned.
    unsafe { libc::kill(pid, libc::SIGKILL); }
}

fn stop_blocking(app: AppHandle, root: PathBuf, id: String) -> Result<Value, String> {
    let walks = app.state::<BugWalks>();
    let mut active = {
        let mut g = lock(&walks.active);
        match g.take() {
            Some(a) if a.id == id && !a.selecting => a,
            other => { *g = other; return Err("No recording is running for this bug walk".into()); }
        }
    };
    if let Some(mut stdin) = active.stdin.take() {
        // A broken pipe means the recorder already stopped itself (30-minute limit); the Stopped event is queued.
        let _ = stdin.write_all(b"stop\n").and_then(|_| stdin.flush());
        drop(stdin);
    }
    let rx = active.events.take().ok_or("Recorder event channel is missing")?;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(Ev::Stopped { duration_s }) => {
                let walk = read_walk(&walk_dir(&root, &id)?)?;
                return Ok(json!({"id":id,"duration_s":duration_s,"region":walk.region.public()}));
            }
            Ok(Ev::Exited(m)) => return Err(m),
            Ok(Ev::Started) => continue,
            Err(_) => {
                // The helper finalizes its files on SIGTERM; only SIGKILL it if it still ignores that.
                terminate(active.pid, Duration::from_secs(5));
                let saved = walk_dir(&root, &id).map(|d| recover_walk(&d, "stop-timeout")).unwrap_or(false);
                lock(&walks.live).remove(&id);
                return Err(format!("The recorder did not stop within 20 seconds.{}", if saved { " The audio was saved: dismiss this and it is offered as an unfinished walk." } else { "" }));
            }
        }
    }
}

// ---- pipeline -------------------------------------------------------------------------------------------------

enum Stop {
    Cancelled,
    Failed(String),
}
impl From<String> for Stop {
    fn from(s: String) -> Self { Stop::Failed(s) }
}
impl From<&str> for Stop {
    fn from(s: &str) -> Self { Stop::Failed(s.into()) }
}
type R<T> = Result<T, Stop>;

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Analysis,
    RawTranscript,
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| Stop::Failed(e.to_string()))
}

fn check_cancelled(app: &AppHandle, id: &str) -> R<()> {
    if lock(&app.state::<BugWalks>().cancelled).contains(id) { Err(Stop::Cancelled) } else { Ok(()) }
}

fn set_phase(app: &AppHandle, dir: &Path, id: &str, phase: &'static str) -> R<()> {
    check_cancelled(app, id)?;
    update_walk(dir, |w| w.phase = phase.into());
    emit(app, state(id, phase));
    Ok(())
}

pub(crate) fn validate_opts(o: &SendOpts) -> Result<(), String> {
    if o.project.trim().is_empty() { return Err("Choose a project".into()); }
    if !matches!(o.permission_mode.as_str(), "ask" | "bypass") { return Err(format!("Unknown permission mode \"{}\"", o.permission_mode)); }
    if !matches!(o.split.as_str(), "single" | "per_item") { return Err(format!("Unknown split \"{}\"", o.split)); }
    Ok(())
}

/// `audio.wav` exists but carries no samples (header only).
pub(crate) fn wav_is_empty(dir: &Path) -> bool {
    fs::metadata(dir.join("audio.wav")).is_ok_and(|m| m.len() <= 44)
}

async fn transcript_for(app: &AppHandle, root: &Path, dir: &Path, id: &str) -> R<String> {
    let cached = dir.join("transcript.txt");
    if let Ok(t) = fs::read_to_string(&cached) {
        if !t.trim().is_empty() { return Ok(t); }
    }
    // A companion video without an audio track: nothing to transcribe, and the voice model must not be required.
    if wav_is_empty(dir) { return Ok(String::new()); }
    set_phase(app, dir, id, "transcribing")?;
    let (root, audio) = (root.to_path_buf(), dir.join("audio.wav"));
    let t = blocking(move || crate::voice::transcribe_file(&root, &audio)).await??;
    let lines = analysis::transcript_lines(&t.segments, &t.text);
    if lines.is_empty() { return Err("No speech was detected in the recording".into()); }
    fs::write(&cached, &lines).map_err(|e| e.to_string())?;
    Ok(lines)
}

async fn run_analysis(app: &AppHandle, host: &Host, id: &str, opts: &SendOpts, prompt: String) -> R<Vec<Item>> {
    let hidden = rpc(host.clone(), "hidden_launch", json!({
        "project": opts.project, "account": opts.account, "prompt": prompt,
        "options": {"model": opts.model, "effort": opts.effort},
    })).await?;
    let hid = hidden.as_str().ok_or("hidden_launch returned no thread id")?.to_string();
    let result = poll_hidden(app, host, id, &hid).await;
    if let Err(e) = rpc(host.clone(), "hidden_purge", json!({"session": hid})).await {
        eprintln!("{}", json!({"event":"bug_walk.hidden_purge_failed","error":e}));
    }
    let items = analysis::parse_analysis(&result?)?;
    if items.is_empty() { return Err("The analysis found no bugs in the transcript".into()); }
    Ok(items)
}

async fn poll_hidden(app: &AppHandle, host: &Host, id: &str, hid: &str) -> R<String> {
    let deadline = Instant::now() + ANALYSIS_TIMEOUT;
    loop {
        check_cancelled(app, id)?;
        let r = rpc(host.clone(), "hidden_result", json!({"session": hid})).await?;
        match r["state"].as_str() {
            Some("done") => return Ok(r["text"].as_str().unwrap_or("").to_string()),
            Some("error") => return Err(r["error"].as_str().unwrap_or("The analysis thread failed").to_string().into()),
            _ => {}
        }
        if Instant::now() > deadline { return Err("The analysis took longer than 3 minutes".into()); }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
}

/// Extracts the planned frames into `<dir>/stage/NN.png` (numbered in plan order).
async fn grab_frames(app: &AppHandle, dir: &Path, id: &str, plan: &[PlannedFrame]) -> R<Vec<PathBuf>> {
    let helper = helper::locate()?;
    let mov = dir.join("recording.mov");
    let video = if mov.exists() { mov } else { dir.join("recording.mp4") }; // walks recorded before the .mov switch
    let (out, times) = ( dir.join("frames"), plan.iter().map(|p| p.time).collect::<Vec<_>>());
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let raw = blocking(move || helper::frames(&helper, &video, &out, &times)).await??;
    check_cancelled(app, id)?;
    let stage = dir.join("stage");
    fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    raw.iter().enumerate().map(|(n, p)| {
        let to = stage.join(analysis::frame_name(n + 1));
        fs::copy(p, &to).map(|_| to).map_err(|e| Stop::Failed(format!("Could not stage frame {}: {e}", n + 1)))
    }).collect()
}

async fn launch_fix_thread(host: &Host, opts: &SendOpts, report: &str, frames: &[PathBuf]) -> R<String> {
    let paths: Vec<String> = frames.iter().map(|p| p.to_string_lossy().to_string()).collect();
    // The runtime copies each file into its own attachment store, so deleting the walk dir afterwards is safe.
    let staged = rpc(host.clone(), "stage_attachments", json!({"paths": paths})).await?;
    let ids: Vec<String> = staged.as_array().ok_or("stage_attachments returned no list")?.iter().filter_map(|a| a["id"].as_str().map(str::to_owned)).collect();
    if ids.len() != frames.len() { return Err(format!("Staged {} of {} frames", ids.len(), frames.len()).into()); }
    let launched = rpc(host.clone(), "launch", json!({
        "project": opts.project, "account": opts.account, "prompt": report, "existing": opts.reply_to_thread,
        "options": {"permission_mode": opts.permission_mode, "model": opts.model, "effort": opts.effort, "attachments": ids},
    })).await?;
    launched.as_str().map(str::to_owned).ok_or_else(|| "launch returned no thread id".into())
}

async fn pipeline(app: &AppHandle, host: &Host, id: &str, opts: &SendOpts, mode: Mode, transcript_out: &mut Option<String>) -> R<Vec<String>> {
    let root = host.root.clone();
    let dir = walk_dir(&root, id)?;
    let walk = read_walk(&dir)?;
    let duration = duration_of(&dir, &walk);
    let lines = transcript_for(app, &root, &dir, id).await?;
    *transcript_out = Some(lines.clone());
    // No speech to analyse (silent companion video): skip the analysis and send evenly spaced frames instead.
    let mode = if lines.is_empty() { Mode::RawTranscript } else { mode };
    let (items, plan) = if mode == Mode::Analysis {
        set_phase(app, &dir, id, "analyzing")?;
        let items = run_analysis(app, host, id, opts, analysis::analysis_prompt(&lines, &walk.region, duration)).await?;
        let plan = analysis::plan_frames(&items, duration);
        (items, plan)
    } else {
        (vec![], analysis::fallback_frames(duration))
    };
    set_phase(app, &dir, id, "framing")?;
    let frames = grab_frames(app, &dir, id, &plan).await?;
    set_phase(app, &dir, id, "launching")?;
    let when = local_label(walk.started_at);
    let report = if mode == Mode::Analysis {
        analysis::render_report(&when, &walk.region, &items, &plan, &lines)
    } else {
        analysis::render_transcript_report(&when, &walk.region, &plan, &lines)
    };
    fs::write(dir.join("report.md"), &report).map_err(|e| e.to_string())?;
    check_cancelled(app, id)?;
    if mode == Mode::Analysis && opts.per_item() {
        let total = items.len();
        let mut ids: Vec<String> = vec![];
        for (i, item) in items.iter().enumerate() {
            check_cancelled(app, id)?;
            emit(app, StatePayload { launched: Some(i), total: Some(total), ..state(id, "launching") });
            let mine: Vec<(FrameKind, PathBuf)> = plan.iter().zip(&frames).filter(|(p, _)| p.item == i).map(|(p, f)| (p.kind, f.clone())).collect();
            let kinds: Vec<FrameKind> = mine.iter().map(|(k, _)| *k).collect();
            let paths: Vec<PathBuf> = mine.into_iter().map(|(_, f)| f).collect();
            let item_report = analysis::render_item_report(i, total, item, &kinds, &lines);
            match launch_fix_thread(host, opts, &item_report, &paths).await {
                Ok(sid) => ids.push(sid),
                Err(Stop::Cancelled) => return Err(Stop::Cancelled),
                Err(Stop::Failed(e)) => {
                    return Err(Stop::Failed(format!("Item {} of {total} (\"{}\") failed to start: {e}. {} of {total} threads were started and kept.", i + 1, item.title, ids.len())));
                }
            }
        }
        emit(app, StatePayload { launched: Some(total), total: Some(total), ..state(id, "launching") });
        if ids.is_empty() { return Err("The analysis found no items to start threads for".into()); }
        return Ok(ids);
    }
    launch_fix_thread(host, opts, &report, &frames).await.map(|sid| vec![sid])
}

fn spawn_pipeline(app: AppHandle, host: Host, id: String, opts: SendOpts, mode: Mode) {
    tauri::async_runtime::spawn(async move {
        let mut transcript = None;
        let result = pipeline(&app, &host, &id, &opts, mode, &mut transcript).await;
        let walks = app.state::<BugWalks>();
        match result {
            Ok(session_ids) => {
                if let Ok(dir) = walk_dir(&host.root, &id) {
                    if read_walk(&dir).is_ok_and(|w| w.source.as_deref() == Some("companion")) {
                        // The phone polls the outcome: keep walk.json, drop the heavy artifacts.
                        update_walk(&dir, |w| { w.phase = "done".into(); w.sessions = Some(session_ids.clone()); });
                        intake::strip_artifacts(&dir);
                    } else {
                        remove_dir(&dir);
                    }
                }
                lock(&walks.live).remove(&id);
                emit(&app, StatePayload { session_id: session_ids.first().cloned(), session_ids: Some(session_ids), ..state(&id, "done") });
            }
            Err(Stop::Cancelled) => {}
            Err(Stop::Failed(error)) => {
                if let Ok(dir) = walk_dir(&host.root, &id) { update_walk(&dir, |w| { w.phase = "error".into(); if w.source.as_deref() == Some("companion") { w.reason = Some(error.clone()); } }); }
                emit(&app, StatePayload { error: Some(error), transcript, ..state(&id, "error") });
            }
        }
        lock(&walks.cancelled).remove(&id);
    });
}

fn begin_send(app: &AppHandle, host: &Host, id: &str, opts: &SendOpts) -> Result<(), String> {
    validate_opts(opts)?;
    let dir = walk_dir(&host.root, id)?;
    let walk = read_walk(&dir)?;
    let walks = app.state::<BugWalks>();
    {
        let mut a = lock(&walks.active);
        if a.as_ref().is_some_and(|x| x.id == id) {
            if a.as_ref().is_some_and(|x| !x.finished.load(Ordering::SeqCst)) { return Err("Stop the recording first".into()); }
            *a = None;
        }
    }
    if matches!(walk.phase.as_str(), "transcribing" | "analyzing" | "framing" | "launching") && lock(&walks.live).contains(id) {
        return Err("This bug walk is already being sent".into());
    }
    lock(&walks.live).insert(id.to_string());
    lock(&walks.cancelled).remove(id);
    Ok(())
}

// ---- commands -------------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn bug_walk_start(app: AppHandle, h: State<'_, Host>, origin: Option<Origin>, mode: Option<String>) -> Result<Value, String> {
    let mode = mode.unwrap_or_else(settings::default_mode);
    let select = select_mode_arg(&mode)?;
    remember_mode(&h.root, &mode);
    let id = hex::encode(rand::random::<[u8; 8]>());
    let (root, origin) = (h.root.clone(), origin.unwrap_or_default());
    tauri::async_runtime::spawn_blocking(move || start_blocking(app, root, id, origin, select)).await.map_err(|e| e.to_string())?
}

/// Persists the chosen target mode so the hotkey reuses it. Logged, never fatal (same rule as `remember_split`).
fn remember_mode(root: &Path, mode: &str) {
    let result = settings::load(root).and_then(|mut s| {
        if s.last_mode == mode { return Ok(()); }
        s.last_mode = mode.to_string();
        settings::save(root, &s)
    });
    if let Err(e) = result { eprintln!("{}", json!({"event":"bug_walk.remember_mode_failed","error":e})); }
}

#[tauri::command]
pub async fn bug_walk_stop(app: AppHandle, h: State<'_, Host>, id: String) -> Result<Value, String> {
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || stop_blocking(app, root, id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn bug_walk_cancel(app: AppHandle, h: State<'_, Host>, id: String) -> Result<(), String> {
    let dir = walk_dir(&h.root, &id)?;
    let walks = app.state::<BugWalks>();
    lock(&walks.cancelled).insert(id.clone());
    let active = { let mut g = lock(&walks.active); if g.as_ref().is_some_and(|a| a.id == id) { g.take() } else { None } };
    if let Some(a) = active {
        kill(a.pid);
        if a.selecting {
            // `start` owns the select child, reaps it and emits `cancelled`.
            return Ok(());
        }
        if let Some(rx) = a.events {
            let _ = tauri::async_runtime::spawn_blocking(move || { while let Ok(ev) = rx.recv_timeout(Duration::from_secs(3)) { if matches!(ev, Ev::Exited(_) | Ev::Stopped { .. }) { break; } } }).await;
        }
    }
    remove_dir(&dir);
    lock(&walks.live).remove(&id);
    emit(&app, state(&id, "cancelled"));
    // The flag stays so an in-flight pipeline notices it and stops; the pipeline task (or a later send) clears it.
    Ok(())
}

/// Persists the chosen split as the next default. Not for walks started from a thread (the toggle is hidden there).
/// A failure is logged, never fatal: the send itself must still go ahead.
fn remember_split(root: &Path, opts: &SendOpts) {
    if opts.reply_to_thread.is_some() { return; }
    let result = settings::load(root).and_then(|mut s| {
        if s.last_split == opts.split { return Ok(()); }
        s.last_split = opts.split.clone();
        settings::save(root, &s)
    });
    if let Err(e) = result { eprintln!("{}", json!({"event":"bug_walk.remember_split_failed","error":e})); }
}

#[tauri::command]
pub async fn bug_walk_send(app: AppHandle, h: State<'_, Host>, id: String, opts: SendOpts) -> Result<(), String> {
    begin_send(&app, &h, &id, &opts)?;
    remember_split(&h.root, &opts);
    spawn_pipeline(app, h.inner().clone(), id, opts, Mode::Analysis);
    Ok(())
}

#[tauri::command]
pub async fn bug_walk_send_transcript(app: AppHandle, h: State<'_, Host>, id: String, opts: SendOpts) -> Result<(), String> {
    begin_send(&app, &h, &id, &opts)?;
    spawn_pipeline(app, h.inner().clone(), id, opts, Mode::RawTranscript);
    Ok(())
}

#[tauri::command]
pub async fn bug_walk_orphans(app: AppHandle, h: State<'_, Host>) -> Result<Vec<Orphan>, String> {
    // Crash leftovers: hidden analysis threads that never got purged.
    match rpc(h.inner().clone(), "hidden_purge", json!({})).await {
        Ok(_) => {}
        Err(e) if e.contains("Unknown host command") => {}
        Err(e) => eprintln!("{}", json!({"event":"bug_walk.hidden_purge_failed","error":e})),
    }
    let root = h.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let live = lock(&app.state::<BugWalks>().live).clone();
        // A recorder that survived an app crash keeps writing for up to 30 minutes: stop it so the files are final.
        for o in scan_orphans(&root, &live, |_| false) {
            if let Some(pid) = walk_dir(&root, &o.id).ok().and_then(|d| read_walk(&d).ok()).and_then(|w| w.pid).filter(|p| pid_alive(*p)) {
                // SAFETY: SIGTERM asks the helper to finalise its files.
                unsafe { libc::kill(pid, libc::SIGTERM); }
                for _ in 0..30 { if !pid_alive(pid) { break; } std::thread::sleep(Duration::from_millis(100)); }
            }
        }
        scan_orphans(&root, &live, pid_alive)
    }).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SettingsView {
    #[serde(flatten)]
    settings: BugWalkSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn bug_walk_settings_get(app: AppHandle, h: State<'_, Host>) -> Result<SettingsView, String> {
    Ok(SettingsView { settings: settings::load(&h.root)?, error: lock(&app.state::<BugWalks>().shortcut_error).clone() })
}

#[tauri::command]
pub async fn bug_walk_settings_set(app: AppHandle, h: State<'_, Host>, settings: BugWalkSettings) -> Result<SettingsView, String> {
    settings::validate_shortcut(&settings.shortcut)?;
    let previous = settings::load(&h.root)?;
    if let Err(e) = register(&app, &settings) {
        let _ = register(&app, &previous);
        return Err(e);
    }
    settings::save(&h.root, &settings)?;
    *lock(&app.state::<BugWalks>().shortcut_error) = None;
    Ok(SettingsView { settings, error: None })
}

// ---- global shortcut ------------------------------------------------------------------------------------------

pub fn shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::ShortcutState;
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit(HOTKEY_EVENT, ());
            }
        })
        .build()
}

/// Only the bug walk shortcut is registered through this plugin, so replacing means clearing everything first.
fn register(app: &AppHandle, s: &BugWalkSettings) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| format!("shortcut-unavailable: {e}"))?;
    if s.enabled {
        gs.register(s.shortcut.as_str()).map_err(|e| format!("shortcut-unavailable: {} ({e})", s.shortcut))?;
    }
    Ok(())
}

/// Called from `setup`: manages state and registers the saved shortcut. Failure is logged, remembered for
/// `bug_walk_settings_get` and emitted as an error state event.
pub fn init(app: &AppHandle, root: &Path) {
    app.manage(BugWalks::default());
    if let Some(host) = app.try_state::<Host>() { intake::start(app.clone(), host.inner().clone()); }
    let result = settings::load(root).map_err(|e| format!("shortcut-unavailable: {e}")).and_then(|s| register(app, &s));
    if let Err(e) = result {
        eprintln!("{}", json!({"event":"bug_walk.shortcut_failed","error":e}));
        *lock(&app.state::<BugWalks>().shortcut_error) = Some(e.clone());
        emit(app, StatePayload { error: Some(e), ..state("", "error") });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(root: &Path, id: &str, phase: &str, pid: Option<i32>, wav_bytes: usize, started: u64) {
        let dir = walks_root(root).join(id);
        fs::create_dir_all(&dir).unwrap();
        write_walk(&dir, &Walk {
            id: id.into(), started_at: started, origin: Origin::default(),
            region: Region { width: 10.0, height: 10.0, scale: 1.0, display_id: Some(1), ..Default::default() },
            duration_s: None, phase: phase.into(), pid, reason: None, source: None, sessions: None,
        }).unwrap();
        fs::write(dir.join("audio.wav"), vec![0u8; wav_bytes]).unwrap();
    }

    #[test]
    fn detects_orphans() {
        let root = std::env::temp_dir().join(format!("bugwalk-orphans-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        seed(&root, "a-recording", "recording", Some(111), 44 + 32_000 * 5, 20);
        seed(&root, "b-stopped", "stopped", None, 44 + 32_000 * 2, 10);
        seed(&root, "c-alive", "recording", Some(222), 44, 30);
        seed(&root, "d-live", "stopped", None, 44, 40);
        seed(&root, "e-sending", "analyzing", None, 44, 50);
        seed(&root, "f-error", "error", None, 44, 60);
        fs::create_dir_all(walks_root(&root).join("garbage")).unwrap();
        let live: HashSet<String> = ["d-live".to_string()].into();
        let found = scan_orphans(&root, &live, |pid| pid == 222);
        assert_eq!(found.iter().map(|o| (o.id.as_str(), o.started_at, o.duration_s)).collect::<Vec<_>>(), vec![("b-stopped", 10, 2.0), ("a-recording", 20, 5.0)]);
        assert!(scan_orphans(&root.join("missing"), &live, |_| false).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recover_walk_never_leaves_recording_on_disk() {
        let root = std::env::temp_dir().join(format!("bugwalk-recover-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        seed(&root, "with-audio", "recording", Some(111), 44 + 32_000 * 3, 1);
        seed(&root, "no-audio", "recording", Some(111), 44, 2);
        assert!(recover_walk(&walks_root(&root).join("with-audio"), "app-exit"));
        assert!(!recover_walk(&walks_root(&root).join("no-audio"), "app-exit"));
        let w = read_walk(&walks_root(&root).join("with-audio")).unwrap();
        assert_eq!((w.phase.as_str(), w.duration_s, w.reason.as_deref()), ("stopped", Some(3.0), Some("app-exit")));
        assert_eq!(read_walk(&walks_root(&root).join("no-audio")).unwrap().phase, "error");
        // A dead recorder with no audio is not offered as an orphan.
        seed(&root, "dead-empty", "recording", Some(111), 44, 3);
        assert!(scan_orphans(&root, &HashSet::new(), |_| false).iter().all(|o| o.id != "dead-empty"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn walk_ids_cannot_escape_the_walks_dir() {
        let root = Path::new("/tmp/x");
        assert!(walk_dir(root, "../etc").is_err() && walk_dir(root, "").is_err() && walk_dir(root, "a/b").is_err());
        assert_eq!(walk_dir(root, "ab12-cd").unwrap(), Path::new("/tmp/x/bug-walks/ab12-cd"));
    }

    #[test]
    fn state_payload_shape() {
        let v = serde_json::to_value(StatePayload { region: Some(Region { x: 1.0, y: 2.0, width: 3.0, height: 4.0, scale: 2.0, display_id: Some(9), global_x: Some(101.0), global_y: Some(202.0), ..Default::default() }.public()), elapsed_s: Some(1.5), ..state("w", "recording") }).unwrap();
        assert_eq!(v, json!({"id":"w","phase":"recording","region":{"kind":"region","x":101.0,"y":202.0,"width":3.0,"height":4.0,"scale":2.0},"elapsed_s":1.5}));
    }

    #[test]
    fn selection_json_region_window_and_legacy() {
        let legacy = parse_selection(r#"{"display_id":1,"global_x":10,"global_y":20,"x":10,"y":20,"width":300,"height":200,"scale":2}"#).unwrap();
        assert_eq!((legacy.kind, legacy.window_id, legacy.global_x), (TargetKind::Region, None, Some(10.0)));
        assert_eq!(legacy.record_args(), ["--display-id", "1", "--x", "10", "--y", "20", "--width", "300", "--height", "200"]);
        let region = parse_selection("noise\n{\"kind\":\"region\",\"display_id\":2,\"x\":0,\"y\":0,\"width\":1512,\"height\":982,\"scale\":2}\n").unwrap();
        assert_eq!((region.kind, region.display_id, region.width), (TargetKind::Region, Some(2), 1512.0));
        let win = parse_selection(r#"{"kind":"window","window_id":4242,"bundle_id":"com.apple.Safari","app_name":"Safari","title":"Docs","display_id":1,"global_x":100,"global_y":50,"x":100,"y":50,"width":1280,"height":720,"scale":2}"#).unwrap();
        assert_eq!((win.kind, win.window_id, win.app_name.as_deref(), win.title.as_deref()), (TargetKind::Window, Some(4242), Some("Safari"), Some("Docs")));
        assert_eq!(win.record_args(), ["--window-id", "4242", "--display-id", "1"]);
        assert_eq!(serde_json::to_value(win.public()).unwrap(), json!({"kind":"window","x":100.0,"y":50.0,"width":1280.0,"height":720.0,"scale":2.0,"window_id":4242,"bundle_id":"com.apple.Safari","app_name":"Safari","title":"Docs"}));
        assert!(parse_selection(r#"{"kind":"window","display_id":1,"width":1,"height":1}"#).unwrap_err().contains("window_id"));
        assert!(parse_selection(r#"{"kind":"tab","display_id":1}"#).unwrap_err().contains("unknown kind"));
        assert!(parse_selection("").is_err());
    }

    #[test]
    fn legacy_walk_json_without_kind_is_a_region() {
        let w: Walk = serde_json::from_str(r#"{"id":"a","started_at":1,"origin":{},"region":{"x":1,"y":2,"width":3,"height":4,"scale":2,"display_id":1},"phase":"stopped"}"#).unwrap();
        assert_eq!((w.region.kind, w.region.window_id), (TargetKind::Region, None));
    }

    #[test]
    fn start_modes() {
        assert_eq!(select_mode_arg("zone"), Ok("region"));
        assert_eq!(select_mode_arg("app"), Ok("window"));
        assert!(select_mode_arg("screen").is_err());
    }

    #[test]
    fn send_opts_validation() {
        let ok = SendOpts { project: "p".into(), account: None, model: None, effort: None, permission_mode: "ask".into(), reply_to_thread: None, split: "single".into() };
        assert!(validate_opts(&ok).is_ok());
        assert!(validate_opts(&SendOpts { permission_mode: "yolo".into(), ..ok.clone() }).is_err());
        assert!(validate_opts(&SendOpts { project: " ".into(), ..ok.clone() }).is_err());
        assert!(validate_opts(&SendOpts { split: "many".into(), ..ok }).is_err());
    }

    #[test]
    fn split_defaults_to_single_and_is_ignored_for_replies() {
        let o: SendOpts = serde_json::from_str(r#"{"project":"p","permission_mode":"ask"}"#).unwrap();
        assert_eq!(o.split, "single");
        assert!(!o.per_item());
        let per: SendOpts = serde_json::from_str(r#"{"project":"p","permission_mode":"ask","split":"per_item"}"#).unwrap();
        assert!(per.per_item());
        assert!(!SendOpts { reply_to_thread: Some("t".into()), ..per }.per_item());
    }
}
