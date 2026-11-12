//! Commander proactivity: persisted autonomy/heartbeat settings, the budgeted start gate,
//! heartbeat and due-to-do wakes, and coalesced completion notices. Pure decision functions take
//! `now` explicitly so they are unit-testable; the impure tick wires them to the runtime.
use crate::commander::{clip, write_atomic, Store, Todo, KIND};
use crate::runtime::Runtime;
use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

const SETTINGS_FILE: &str = "autonomy_settings.json";
const STATE_FILE: &str = "autonomy_state.json";
/// Request-id prefix shared by every automated Commander wake (heartbeat / completions / due).
/// Completion cards are notifications, never executable queue entries.
pub fn is_completion_card(id: &str) -> bool { id.starts_with("commander-completions-") }

pub const WAKE_ID_PREFIX: &str = "commander-";
pub const COMPLETION_COALESCE_MINUTES: i64 = 0;
/// Minimum gap between automatic Commander wakes of any kind (completion, due, heartbeat).
pub const MIN_WAKE_GAP_MINUTES: i64 = 30;
/// The host tick runs every 2s; Commander checks run at most this often.
const TICK_EVERY_SECS: u64 = 30;
static STATE_LOCK: Mutex<()> = Mutex::new(());
static LAST_TICK: AtomicU64 = AtomicU64::new(0);
/// Serialises check-then-queue so two wake sources cannot both pass the pending-wake check.
static WAKE_LOCK: Mutex<()> = Mutex::new(());
static LAST_DEFERRED: Mutex<Option<String>> = Mutex::new(None);

// ---------------------------------------------------------------- settings

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Autonomy {
    pub mode: String,
    pub max_concurrent: u32,
    pub daily_start_cap: u32,
    pub allowed_project_ids: Vec<String>,
}
impl Default for Autonomy {
    fn default() -> Self {
        Self { mode: "propose".into(), max_concurrent: 2, daily_start_cap: 5, allowed_project_ids: Vec::new() }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Heartbeat {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub active_start: String,
    pub active_end: String,
}
impl Default for Heartbeat {
    fn default() -> Self {
        Self { enabled: false, interval_minutes: 60, active_start: "08:00".into(), active_end: "20:00".into() }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub autonomy: Autonomy,
    pub heartbeat: Heartbeat,
}

fn parse_hhmm(field: &str, s: &str) -> Result<NaiveTime, String> {
    let ok_shape = s.len() == 5 && s.as_bytes()[2] == b':';
    NaiveTime::parse_from_str(s, "%H:%M").ok().filter(|_| ok_shape).ok_or_else(|| format!("{field} must be HH:MM (24-hour), got \"{s}\""))
}
pub fn validate(s: &Settings) -> Result<(), String> {
    if !matches!(s.autonomy.mode.as_str(), "propose" | "budgeted") {
        return Err(format!("autonomy.mode must be \"propose\" or \"budgeted\", got \"{}\"", s.autonomy.mode));
    }
    if !(1..=10).contains(&s.autonomy.max_concurrent) {
        return Err(format!("autonomy.maxConcurrent must be between 1 and 10, got {}", s.autonomy.max_concurrent));
    }
    if s.autonomy.daily_start_cap > 50 {
        return Err(format!("autonomy.dailyStartCap must be between 0 and 50, got {}", s.autonomy.daily_start_cap));
    }
    if s.heartbeat.interval_minutes < 15 {
        return Err(format!("heartbeat.intervalMinutes must be at least 15, got {}", s.heartbeat.interval_minutes));
    }
    parse_hhmm("heartbeat.activeStart", &s.heartbeat.active_start)?;
    parse_hhmm("heartbeat.activeEnd", &s.heartbeat.active_end)?;
    Ok(())
}
pub fn load_settings(store: &Store) -> Result<Settings, String> {
    let path = store.dir().join(SETTINGS_FILE);
    match fs::read(&path) {
        Ok(b) if b.iter().all(u8::is_ascii_whitespace) => Ok(Settings::default()),
        Ok(b) => {
            let s: Settings = serde_json::from_slice(&b).map_err(|e| format!("Cannot read {SETTINGS_FILE} (left untouched): {e}"))?;
            validate(&s).map_err(|e| format!("Invalid {SETTINGS_FILE}: {e}"))?;
            Ok(s)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(format!("Cannot read {SETTINGS_FILE}: {e}")),
    }
}
pub fn save_settings(store: &Store, raw: &Value) -> Result<Settings, String> {
    let s: Settings = serde_json::from_value(raw.clone()).map_err(|e| format!("Invalid settings: {e}"))?;
    validate(&s)?;
    fs::create_dir_all(store.dir()).map_err(|e| e.to_string())?;
    write_atomic(&store.dir().join(SETTINGS_FILE), &serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?)?;
    Ok(s)
}

// ---------------------------------------------------------------- state

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    pub last_heartbeat: Option<String>,
    /// `todoId|due|timestamp` keys already woken for.
    pub due_fired: Vec<String>,
    pub last_completion_wake: Option<String>,
    /// Last automatic wake of any kind; drives `MIN_WAKE_GAP_MINUTES`.
    pub last_auto_wake_at: Option<String>,
    pub pending_completions: Vec<Completion>,
    /// Open to-do signatures (`id|status|title|due|check_back_at`) as of the last queued heartbeat.
    pub hb_todos: Vec<String>,
    /// Failed thread ids / needs-review to-do ids already shown to Commander by the last queued heartbeat.
    pub hb_attention: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Completion {
    pub id: String,
    pub title: String,
    pub status: String,
    /// RFC 3339 time the thread finished (empty on legacy state files).
    #[serde(default)]
    pub at: String,
}
fn load_state(store: &Store) -> Result<State, String> {
    match fs::read(store.dir().join(STATE_FILE)) {
        Ok(b) if b.iter().all(u8::is_ascii_whitespace) => Ok(State::default()),
        Ok(b) => serde_json::from_slice(&b).map_err(|e| format!("Cannot read {STATE_FILE} (left untouched): {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(State::default()),
        Err(e) => Err(format!("Cannot read {STATE_FILE}: {e}")),
    }
}
fn save_state(store: &Store, s: &State) -> Result<(), String> {
    fs::create_dir_all(store.dir()).map_err(|e| e.to_string())?;
    write_atomic(&store.dir().join(STATE_FILE), &serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?)
}
fn with_state<T>(store: &Store, f: impl FnOnce(&mut State) -> T) -> Result<T, String> {
    let _g = STATE_LOCK.lock().unwrap();
    let mut s = load_state(store)?;
    let out = f(&mut s);
    save_state(store, &s)?;
    Ok(out)
}

// ---------------------------------------------------------------- pure decisions

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|t| t.with_timezone(&Utc))
}
/// Is `now` (local) inside the active window? A window whose end is before its start wraps midnight.
pub fn in_active_window(h: &Heartbeat, now: DateTime<Local>) -> bool {
    let (Ok(start), Ok(end)) = (parse_hhmm("start", &h.active_start), parse_hhmm("end", &h.active_end)) else { return false };
    let t = now.time();
    if start <= end { t >= start && t < end } else { t >= start || t < end }
}
pub fn heartbeat_due(h: &Heartbeat, last: Option<DateTime<Utc>>, now: DateTime<Local>) -> bool {
    if !h.enabled || !in_active_window(h, now) {
        return false;
    }
    match last {
        None => true,
        Some(last) => now.with_timezone(&Utc) - last >= chrono::Duration::minutes(h.interval_minutes as i64),
    }
}
/// Parses a to-do timestamp: RFC 3339, or a bare date (treated as the start of that local day).
fn todo_time(s: &str) -> Option<DateTime<Utc>> {
    parse_ts(s).or_else(|| {
        let d = NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()?;
        Local.from_local_datetime(&d.and_hms_opt(0, 0, 0)?).earliest().map(|t| t.with_timezone(&Utc))
    })
}
/// A due or check-back time that has passed on an open to-do and has not yet woken Commander.
#[derive(Debug, PartialEq, Clone)]
pub struct DueWake {
    pub key: String,
    pub todo_id: String,
    pub title: String,
    pub kind: &'static str,
    pub at: String,
}
pub fn due_wakes(todos: &[Todo], fired: &[String], now: DateTime<Utc>) -> Vec<DueWake> {
    let mut out = Vec::new();
    for t in todos.iter().filter(|t| matches!(t.status.as_str(), "open" | "in_progress")) {
        for (kind, value) in [("due", &t.due), ("check_back_at", &t.check_back_at)] {
            let Some(at) = value else { continue };
            let Some(when) = todo_time(at) else { continue };
            let key = format!("{}|{kind}|{at}", t.id);
            if when <= now && !fired.contains(&key) {
                out.push(DueWake { key, todo_id: t.id.clone(), title: t.title.clone(), kind, at: at.clone() });
            }
        }
    }
    out
}
fn stamp(now: DateTime<Utc>) -> String { now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }
/// Record a finished thread for the next coalesced notice (deduped by thread id).
pub fn completion_push(s: &mut State, c: Completion) {
    if !s.pending_completions.iter().any(|p| p.id == c.id) {
        s.pending_completions.push(c);
    }
}
pub fn record_completion(store: &Store, c: Completion) -> Result<(), String> {
    with_state(store, |s| completion_push(s, c))
}
pub fn pending_completions(store: &Store) -> Vec<Completion> {
    load_state(store).map(|s| s.pending_completions).unwrap_or_default()
}
/// True when at least `MIN_WAKE_GAP_MINUTES` have passed since the last automatic wake.
pub fn wake_gap_ok(s: &State, now: DateTime<Utc>) -> bool {
    s.last_auto_wake_at.as_deref().and_then(parse_ts)
        .is_none_or(|last| now - last >= chrono::Duration::minutes(MIN_WAKE_GAP_MINUTES))
}
/// True when the oldest pending completion has waited out the coalescing window.
pub fn completions_coalesced(s: &State, now: DateTime<Utc>) -> bool {
    s.pending_completions.iter()
        .map(|c| parse_ts(&c.at).unwrap_or(now - chrono::Duration::minutes(COMPLETION_COALESCE_MINUTES)))
        .min()
        .is_some_and(|oldest| now - oldest >= chrono::Duration::minutes(COMPLETION_COALESCE_MINUTES))
}
/// Combined notice for all pending completions.
pub fn completion_message(batch: &[Completion]) -> String {
    let list = batch.iter().map(|c| format!("- {} (thread {}): {}", clip(&c.title, 80), c.id, c.status)).collect::<Vec<_>>().join("\n");
    format!("Delegated notice (not a user message): these threads finished. Do a light review of each: read it with freddai_read_thread, fill verification[] on its to-do via freddai_todo_update, then post one short message to the user in your voice with links.\n{list}")
}
/// Log a skipped/deferred wake once per distinct reason (not every tick).
fn log_deferred_once(key: &str, event: Value) {
    let mut last = LAST_DEFERRED.lock().unwrap();
    if last.as_deref() != Some(key) {
        eprintln!("{event}");
        *last = Some(key.to_string());
    }
}
#[derive(Debug, PartialEq)]
pub enum Gate {
    Allow(String),
    Hold(String),
}
/// Decide whether a Commander `freddai_start_task` may skip user approval.
pub fn gate_decision(a: &Autonomy, project: Option<&str>, running: usize, starts_today: usize) -> Gate {
    if a.mode != "budgeted" {
        return Gate::Hold("autonomy mode is propose".into());
    }
    let Some(project) = project else { return Gate::Hold("no target project".into()) };
    if !a.allowed_project_ids.iter().any(|p| p == project) {
        return Gate::Hold(format!("project {project} is not in allowedProjectIds"));
    }
    if running >= a.max_concurrent as usize {
        return Gate::Hold(format!("concurrency limit reached ({running}/{} running)", a.max_concurrent));
    }
    if starts_today >= a.daily_start_cap as usize {
        return Gate::Hold(format!("daily start cap reached ({starts_today}/{})", a.daily_start_cap));
    }
    Gate::Allow(format!("within budget ({running}/{} running, {starts_today}/{} started today)", a.max_concurrent, a.daily_start_cap))
}
/// Why an automated wake must not be queued right now (`None` = free to queue). At most one
/// automated wake (`commander-*` request id) may ever sit in the Commander queue.
pub fn wake_blocker(busy: bool, paused: bool, queued_ids: &[String]) -> Option<&'static str> {
    if paused { Some("paused") }
    else if queued_ids.iter().any(|id| id.starts_with(WAKE_ID_PREFIX)) { Some("pending_wake") }
    else if busy { Some("busy") }
    else { None }
}
/// Heartbeat only when something changed since the last one: an open to-do added/changed, a failed
/// thread or needs-review to-do not yet shown, or a completion not yet reported.
pub fn heartbeat_has_work(prev_todos: &[String], cur_todos: &[String], prev_attention: &[String], cur_attention: &[String], unreported_completions: usize) -> bool {
    unreported_completions > 0
        || cur_todos.iter().any(|t| !prev_todos.contains(t))
        || cur_attention.iter().any(|a| !prev_attention.contains(a))
}
fn heartbeat_snapshot(rt: &Runtime, todos: &[Todo]) -> (Vec<String>, Vec<String>) {
    let open: Vec<String> = todos.iter().filter(|t| matches!(t.status.as_str(), "open" | "in_progress"))
        .map(|t| format!("{}|{}|{}|{}|{}", t.id, t.status, t.title, t.due.as_deref().unwrap_or(""), t.check_back_at.as_deref().unwrap_or(""))).collect();
    let mut attention: Vec<String> = todos.iter().filter(|t| t.status == "needs_review").map(|t| format!("todo:{}", t.id)).collect();
    attention.extend(rt.session_briefs(None).iter().filter(|b| b.live && b.status == "failed" && crate::commander::completion_is_relevant(b.origin.as_ref(), todos.iter().any(|t| t.thread.as_deref() == Some(b.id.as_str())))).map(|b| format!("thread:{}", b.id)));
    (open, attention)
}

pub fn heartbeat_message(a: &Autonomy, running: usize, starts_today: usize) -> String {
    let budget = if a.mode == "budgeted" {
        format!(
            "Autonomy mode: budgeted. Remaining budget: {} concurrent slot(s) free, {} start(s) left today; you may start tasks without approval only in these allowed projects: [{}]. Anything else is held for approval.",
            (a.max_concurrent as usize).saturating_sub(running),
            (a.daily_start_cap as usize).saturating_sub(starts_today),
            a.allowed_project_ids.join(", ")
        )
    } else {
        "Autonomy mode: propose. Every start is held for the user's approval, so propose concrete tasks with freddai_propose / freddai_start_task and let the user decide.".into()
    };
    format!(
        "Heartbeat (scheduled check-in, not a user message). Review open to-dos and failed or needs-review threads delegated by you or explicitly tracked in your to-do list. Do not report unrelated thread completions. In propose mode propose concrete next tasks; in budgeted mode start them within budget. If nothing is worth doing, reply with one short line and stop. {budget}"
    )
}

// ---------------------------------------------------------------- budget accounting

/// Commander-origin starts allowed without approval today (local date), from the actions log.
pub fn auto_starts_today(store: &Store, now: DateTime<Local>) -> usize {
    let Ok(text) = fs::read_to_string(store.dir().join("actions.log")) else { return 0 };
    let today = now.date_naive();
    text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter(|v| {
        v["tool"] == "freddai_start_task" && v["decision"] == "auto_allowed" && v["ok"] == true
            && v["at"].as_str().and_then(parse_ts).is_some_and(|t| t.with_timezone(&Local).date_naive() == today)
    }).count()
}
pub fn running_commander_threads(rt: &Runtime) -> usize {
    rt.session_briefs(None).iter()
        .filter(|b| b.origin.as_ref().is_some_and(|o| o.kind == KIND) && matches!(b.status.as_str(), "running" | "starting" | "waiting"))
        .count()
}
/// Gate for a Commander `freddai_start_task`. Logs budget-denied holds; the caller logs the allowed start once it succeeds.
pub fn start_gate(rt: &Runtime, store: &Store, args: &Value) -> Gate {
    let settings = match load_settings(store) {
        Ok(s) => s,
        Err(error) => {
            eprintln!("{}", json!({"event":"commander.autonomy_settings_failed","error":error}));
            return Gate::Hold(format!("autonomy settings unreadable: {error}"));
        }
    };
    let gate = gate_decision(&settings.autonomy, args["project"].as_str(), running_commander_threads(rt), auto_starts_today(store, Local::now()));
    if let Gate::Hold(reason) = &gate {
        if settings.autonomy.mode == "budgeted" {
            eprintln!("{}", json!({"event":"commander.start_budget_hold","reason":reason}));
            store.log_action("freddai_start_task", args, "budget_denied", true, Some(reason));
        }
    }
    gate
}

// ---------------------------------------------------------------- wakes

fn target_thread(rt: &Runtime, store: &Store, commander_id: &str) -> Result<Option<crate::runtime::SessionBrief>, String> {
    Ok(crate::commander::main_thread_pub(rt, store, commander_id)?.and_then(|id| rt.session_brief(&id)))
}
fn is_busy(b: &crate::runtime::SessionBrief) -> bool {
    matches!(b.status.as_str(), "running" | "starting")
}
/// Blocker for the Commander thread right now; logs a `commander.wake_deferred` event when it changes.
fn blocker(rt: &Runtime, target: &crate::runtime::SessionBrief, kind: &str) -> Option<&'static str> {
    let (paused, ids) = rt.queue_state(&target.id);
    let reason = wake_blocker(is_busy(target), paused, &ids);
    let mut last = LAST_DEFERRED.lock().unwrap();
    match reason {
        Some(r) => {
            let key = format!("{kind}:{r}");
            if last.as_deref() != Some(key.as_str()) {
                eprintln!("{}", json!({"event":"commander.wake_deferred","kind":kind,"reason":r,"commander_thread":target.id}));
                *last = Some(key);
            }
        }
        None => *last = None,
    }
    reason
}
fn send(rt: &Runtime, store: &Store, target: &str, event: &str, detail: Value, message: String, request_id: String) -> Result<(), String> {
    let options = crate::runtime::LaunchOptions { request_id: Some(request_id), ..Default::default() };
    match rt.queue_message(target, message, options) {
        Ok(()) => {
            eprintln!("{}", json!({"event":format!("commander.wake.{event}"),"queued":true,"commander_thread":target,"detail":detail}));
            store.log_action("wake", &json!({"kind":event,"detail":detail,"commander_thread":target}), "executed", true, None);
            Ok(())
        }
        Err(error) => {
            eprintln!("{}", json!({"event":format!("commander.wake.{event}"),"queued":false,"error":error,"detail":detail}));
            store.log_action("wake", &json!({"kind":event,"detail":detail}), "executed", false, Some(&error));
            Err(error)
        }
    }
}

fn fail(store: &Store, kind: &str, error: &str) {
    eprintln!("{}", json!({"event":"commander.wake_failed","kind":kind,"error":error}));
    store.log_action("wake", &json!({"kind":kind}), "executed", false, Some(error));
}

/// Host-tick entry: heartbeat, due to-dos and flushing coalesced completion notices.
pub fn tick(rt: &Runtime) {
    let now_s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let last = LAST_TICK.load(Ordering::Relaxed);
    if now_s.saturating_sub(last) < TICK_EVERY_SECS {
        return;
    }
    LAST_TICK.store(now_s, Ordering::Relaxed);
    let Some(commander) = rt.commander_project() else { return };
    let store = Store::new(&commander.path);
    if let Err(error) = tick_inner(rt, &store, &commander.id) {
        fail(&store, "tick", &error);
    }
}
fn tick_inner(rt: &Runtime, store: &Store, commander_id: &str) -> Result<(), String> {
    let settings = load_settings(store)?;
    let now_local = Local::now();
    let now = now_local.with_timezone(&Utc);

    let _g = WAKE_LOCK.lock().unwrap();
    let Some(target) = target_thread(rt, store, commander_id)? else { return Ok(()) };
    let state = with_state(store, |s| s.clone())?;
    let todos = store.todos()?;
    let gap_ok = wake_gap_ok(&state, now);

    // Completed work is delivered on the next free tick, independently of heartbeat cooldown.
    if !state.pending_completions.is_empty() {
        if !completions_coalesced(&state, now) {
            log_deferred_once("completions:coalescing", json!({"event":"commander.wake_deferred","kind":"completions","reason":"coalescing","pending":state.pending_completions.len()}));

        } else {
            if blocker(rt, &target, "completions").is_some() { return Ok(()); }
            let batch = state.pending_completions.clone();
            let rid = format!("commander-wake-batch-{}", batch.iter().map(|c| format!("{}:{}", c.id,c.at)).collect::<Vec<_>>().join(","));
            send(rt, store, &target.id, "completions", json!({"threads":batch.iter().map(|c| &c.id).collect::<Vec<_>>()}), completion_message(&batch), rid)?;
            with_state(store, |s| {
                s.pending_completions.retain(|p| !batch.iter().any(|b| b.id == p.id && b.at == p.at));
                s.last_completion_wake = Some(stamp(now));
                s.last_auto_wake_at = Some(stamp(now));
            })?;
            return Ok(());
        }
    }

    // Due / check-back wakes: once per to-do per timestamp; not marked fired until actually queued.
    let due = due_wakes(&todos, &state.due_fired, now);
    if !due.is_empty() {
        if blocker(rt, &target, "due").is_some() { return Ok(()); }
        let list = due.iter().map(|d| format!("- {} (todo {}): {} passed at {}", clip(&d.title, 80), d.todo_id, d.kind, d.at)).collect::<Vec<_>>().join("\n");
        let message = format!("Due notice (not a user message): these to-dos reached their due or check-back time. Review each and act, or tell the user briefly.\n{list}");
        let rid = format!("commander-due-{}", due.iter().map(|d| d.key.as_str()).collect::<Vec<_>>().join(","));
        send(rt, store, &target.id, "due", json!({"todos":due.iter().map(|d| &d.todo_id).collect::<Vec<_>>()}), message, rid)?;
        with_state(store, |s| { s.due_fired.extend(due.iter().map(|d| d.key.clone())); s.last_auto_wake_at = Some(stamp(now)); })?;
        return Ok(());
    }

    // Heartbeat: only when interval elapsed, the queue can take it, and something changed.
    let last_hb = state.last_heartbeat.as_deref().and_then(parse_ts);
    if heartbeat_due(&settings.heartbeat, last_hb, now_local) {
        let (open, attention) = heartbeat_snapshot(rt, &todos);
        if !heartbeat_has_work(&state.hb_todos, &open, &state.hb_attention, &attention, state.pending_completions.len()) {
            let mut last = LAST_DEFERRED.lock().unwrap();
            if last.as_deref() != Some("heartbeat:no_changes") {
                eprintln!("{}", json!({"event":"commander.heartbeat_skipped","reason":"no_changes"}));
                *last = Some("heartbeat:no_changes".into());
            }
            return Ok(());
        }
        if !gap_ok {
            log_deferred_once("heartbeat:min_wake_gap", json!({"event":"commander.wake_deferred","kind":"heartbeat","reason":"min_wake_gap","minutes":MIN_WAKE_GAP_MINUTES}));
            return Ok(());
        }
        if blocker(rt, &target, "heartbeat").is_some() { return Ok(()); }
        with_state(store, |s| { s.last_heartbeat = Some(stamp(now)); s.last_auto_wake_at = Some(stamp(now)); s.hb_todos = open; s.hb_attention = attention; })?;
        let message = heartbeat_message(&settings.autonomy, running_commander_threads(rt), auto_starts_today(store, now_local));
        send(rt, store, &target.id, "heartbeat", json!({"intervalMinutes":settings.heartbeat.interval_minutes}), message, format!("commander-heartbeat-{}", now.timestamp()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn budget(projects: &[&str]) -> Autonomy {
        Autonomy { mode: "budgeted".into(), max_concurrent: 2, daily_start_cap: 5, allowed_project_ids: projects.iter().map(|s| s.to_string()).collect() }
    }
    fn local(h: u32, m: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 6, 15, h, m, 0).earliest().unwrap()
    }
    #[test]
    fn gate_allows_within_budget() {
        assert!(matches!(gate_decision(&budget(&["p"]), Some("p"), 1, 4), Gate::Allow(_)));
    }
    #[test]
    fn gate_holds_for_each_limit() {
        let a = budget(&["p"]);
        assert!(matches!(gate_decision(&a, Some("other"), 0, 0), Gate::Hold(r) if r.contains("allowedProjectIds")));
        assert!(matches!(gate_decision(&a, Some("p"), 2, 0), Gate::Hold(r) if r.contains("concurrency")));
        assert!(matches!(gate_decision(&a, Some("p"), 0, 5), Gate::Hold(r) if r.contains("daily")));
        assert!(matches!(gate_decision(&a, None, 0, 0), Gate::Hold(_)));
    }
    #[test]
    fn propose_mode_always_holds() {
        let a = Autonomy { allowed_project_ids: vec!["p".into()], ..Default::default() };
        assert!(matches!(gate_decision(&a, Some("p"), 0, 0), Gate::Hold(_)));
    }
    #[test]
    fn heartbeat_window_and_interval() {
        let h = Heartbeat { enabled: true, ..Heartbeat::default() };
        assert!(!heartbeat_due(&h, None, local(7, 59)));
        assert!(!heartbeat_due(&h, None, local(20, 0)));
        assert!(heartbeat_due(&h, None, local(8, 0)));
        let now = local(12, 0);
        let recent = now.with_timezone(&Utc) - chrono::Duration::minutes(59);
        let old = now.with_timezone(&Utc) - chrono::Duration::minutes(60);
        assert!(!heartbeat_due(&h, Some(recent), now));
        assert!(heartbeat_due(&h, Some(old), now));
        assert!(!heartbeat_due(&Heartbeat { enabled: false, ..h.clone() }, None, now));
        let night = Heartbeat { active_start: "22:00".into(), active_end: "06:00".into(), ..h };
        assert!(in_active_window(&night, local(23, 30)) && in_active_window(&night, local(5, 0)) && !in_active_window(&night, local(12, 0)));
    }
    fn todo(id: &str, status: &str, due: Option<&str>, back: Option<&str>) -> Todo {
        serde_json::from_value(json!({"id":id,"title":id,"status":status,"due":due,"check_back_at":back})).unwrap()
    }
    #[test]
    fn due_wakes_fire_once_per_timestamp() {
        let now = Utc::now();
        let past = (now - chrono::Duration::minutes(5)).to_rfc3339();
        let future = (now + chrono::Duration::hours(1)).to_rfc3339();
        let todos = vec![todo("a", "open", Some(&past), Some(&future)), todo("b", "done", Some(&past), None)];
        let first = due_wakes(&todos, &[], now);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].kind, "due");
        let fired: Vec<String> = first.iter().map(|d| d.key.clone()).collect();
        assert!(due_wakes(&todos, &fired, now).is_empty());
        // A rescheduled due time is a new timestamp and wakes again.
        let moved = vec![todo("a", "open", Some(&(now - chrono::Duration::minutes(1)).to_rfc3339()), None)];
        assert_eq!(due_wakes(&moved, &fired, now).len(), 1);
    }
    #[test]
    fn heartbeat_is_off_by_default() {
        let h = Heartbeat::default();
        assert!(!h.enabled);
        assert!(!heartbeat_due(&h, None, local(12, 0)));
        assert!(!heartbeat_due(&h, Some(Utc::now() - chrono::Duration::days(2)), local(12, 0)));
    }
    fn comp(id: &str, at: DateTime<Utc>) -> Completion { Completion { id: id.into(), title: id.into(), status: "done".into(), at: stamp(at) } }
    #[test]
    fn three_completions_make_one_notice_after_window() {
        let t0 = Utc::now();
        let mut s = State::default();
        for (i, id) in ["a", "b", "c"].iter().enumerate() {
            completion_push(&mut s, comp(id, t0 + chrono::Duration::seconds(i as i64 * 20)));
        }
        completion_push(&mut s, comp("a", t0)); // dedupe
        assert_eq!(s.pending_completions.len(), 3);
        assert!(completions_coalesced(&s, t0));
        let ready = t0 + chrono::Duration::minutes(10);
        assert!(completions_coalesced(&s, ready) && wake_gap_ok(&s, ready));
        let msg = completion_message(&s.pending_completions);
        assert_eq!(msg.matches("\n- ").count(), 3, "one notice lists all three");
    }
    #[test]
    fn heartbeat_gap_does_not_change_completion_readiness() {
        let t0 = Utc::now();
        let mut s = State { last_auto_wake_at: Some(stamp(t0)), ..State::default() };
        completion_push(&mut s, comp("d", t0 + chrono::Duration::minutes(1)));
        let t = t0 + chrono::Duration::minutes(12);
        assert!(completions_coalesced(&s, t));
        assert!(!wake_gap_ok(&s, t), "coalesced but still inside the 30 minute gap");
        assert!(wake_gap_ok(&s, t0 + chrono::Duration::minutes(MIN_WAKE_GAP_MINUTES)));
    }
    #[test]
    fn settings_validate_and_round_trip() {
        let dir = std::env::temp_dir().join(format!("freddai-autonomy-{}", uuid::Uuid::new_v4()));
        let store = Store::new(&dir);
        assert_eq!(load_settings(&store).unwrap(), Settings::default());
        let saved = save_settings(&store, &json!({"autonomy":{"mode":"budgeted","maxConcurrent":3,"allowedProjectIds":["x"]}})).unwrap();
        assert_eq!(saved.autonomy.daily_start_cap, 5);
        assert_eq!(load_settings(&store).unwrap(), saved);
        for (bad, field) in [
            (json!({"heartbeat":{"intervalMinutes":5}}), "heartbeat.intervalMinutes"),
            (json!({"autonomy":{"maxConcurrent":0}}), "autonomy.maxConcurrent"),
            (json!({"autonomy":{"dailyStartCap":51}}), "autonomy.dailyStartCap"),
            (json!({"heartbeat":{"activeStart":"8am"}}), "heartbeat.activeStart"),
            (json!({"heartbeat":{"activeEnd":"25:00"}}), "heartbeat.activeEnd"),
            (json!({"autonomy":{"mode":"yolo"}}), "autonomy.mode"),
        ] {
            let err = save_settings(&store, &bad).unwrap_err();
            assert!(err.contains(field), "{err} should name {field}");
        }
    }
    #[test]
    fn wake_blocker_prevents_pile_up() {
        let none: Vec<String> = vec![];
        assert_eq!(wake_blocker(false, false, &none), None);
        assert_eq!(wake_blocker(true, false, &none), Some("busy"));
        assert_eq!(wake_blocker(false, true, &none), Some("paused"));
        assert_eq!(wake_blocker(true, true, &none), Some("paused"));
        let ids = vec!["user-1".to_string(), "commander-heartbeat-5".to_string()];
        assert_eq!(wake_blocker(false, false, &ids), Some("pending_wake"));
        assert_eq!(wake_blocker(false, false, &["user-1".to_string()]), None);
    }
    #[test]
    fn heartbeat_needs_changes_since_last() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(!heartbeat_has_work(&s(&["a|open"]), &s(&["a|open"]), &s(&["thread:x"]), &s(&["thread:x"]), 0));
        assert!(!heartbeat_has_work(&s(&["a|open"]), &s(&[]), &s(&[]), &s(&[]), 0), "removal alone is not work");
        assert!(heartbeat_has_work(&s(&["a|open"]), &s(&["a|open", "b|open"]), &[], &[], 0), "new to-do");
        assert!(heartbeat_has_work(&s(&["a|open"]), &s(&["a|in_progress"]), &[], &[], 0), "changed to-do");
        assert!(heartbeat_has_work(&[], &[], &s(&["thread:x"]), &s(&["thread:x", "thread:y"]), 0), "new failed thread");
        assert!(heartbeat_has_work(&[], &[], &[], &[], 1), "unreported completion");
    }
    #[test]
    fn old_state_files_load() {
        let s: State = serde_json::from_str(r#"{"lastHeartbeat":"2026-01-01T00:00:00Z","dueFired":[]}"#).unwrap();
        assert!(s.hb_todos.is_empty() && s.hb_attention.is_empty());
    }
}
