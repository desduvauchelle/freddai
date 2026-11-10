//! Keeps the Mac from idle-sleeping while Freddai has work to do (and optionally while a phone is paired).
//! The monitor runs inside the long-lived `--host` process, so it keeps working after the window closes.
//! The sleep hold is `caffeinate -i -w <host pid>`: a PreventUserIdleSystemSleep assertion that still lets the
//! display sleep, and that macOS drops automatically if the host process dies.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, time::Duration};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AwakeSettings {
    /// Hold while any thread turn, queued message or imminent schedule exists.
    pub while_working: bool,
    /// Hold while at least one phone is paired. Off by default: costs battery.
    pub while_paired: bool,
}
impl Default for AwakeSettings { fn default() -> Self { Self { while_working: true, while_paired: false } } }

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Reason { Working(String), Paired }
impl Reason {
    pub fn describe(&self) -> String {
        match self { Reason::Working(d) => format!("agents working ({d})"), Reason::Paired => "a phone is paired".into() }
    }
}
/// Pure decision. Working takes precedence so the reason shown is the more specific one.
pub fn decide(settings: &AwakeSettings, activity: Option<String>, phones_paired: bool) -> Option<Reason> {
    if settings.while_working { if let Some(a) = activity { return Some(Reason::Working(a)); } }
    if settings.while_paired && phones_paired { return Some(Reason::Paired); }
    None
}
/// Describes work that must not be interrupted by sleep, from a host `snapshot` reply. `now_ms` is wall clock ms.
pub fn activity(db: &Value, now_ms: u64) -> Option<String> {
    let mut parts = Vec::new();
    let running = db["sessions"].as_array().map_or(0, |s| s.iter().filter(|x| matches!(x["status"].as_str(), Some("running" | "starting" | "waiting"))).count());
    if running > 0 { parts.push(format!("{running} thread{}", if running == 1 { "" } else { "s" })); }
    let queued = db["queues"].as_array().map_or(0, |q| q.iter().filter(|x| x["paused"] != true && x["messages"].as_array().is_some_and(|m| m.iter().any(|message| !message["id"].as_str().is_some_and(freddai_core::commander_autonomy::is_completion_card)))).count());
    if queued > 0 { parts.push(format!("{queued} queued")); }
    let due = db["schedules"].as_array().map_or(0, |s| s.iter().filter(|x| x["enabled"] == true && x["next_due"].as_u64().is_some_and(|d| d <= now_ms + SCHEDULE_LEAD_MS)).count());
    if due > 0 { parts.push(format!("{due} schedule{} due", if due == 1 { "" } else { "s" })); }
    if parts.is_empty() { None } else { Some(parts.join(", ")) }
}
const SCHEDULE_LEAD_MS: u64 = 120_000;

/// Abstraction over the OS hold so the state machine is testable.
pub trait Hold { fn acquire(&mut self) -> Result<(), String>; fn release(&mut self); }
/// Applies decisions to a `Hold`, logging each transition. Returns an error string when the hold cannot be taken.
pub struct Controller<H: Hold> { hold: H, current: Option<Reason>, pub last_error: Option<String> }
impl<H: Hold> Controller<H> {
    pub fn new(hold: H) -> Self { Self { hold, current: None, last_error: None } }
    pub fn current(&self) -> Option<&Reason> { self.current.as_ref() }
    pub fn apply(&mut self, wanted: Option<Reason>) {
        match (&self.current, &wanted) {
            (None, Some(r)) => match self.hold.acquire() {
                Ok(()) => { eprintln!("awake: acquired sleep assertion: {}", r.describe()); self.current = wanted; self.last_error = None; }
                Err(e) => { if self.last_error.as_deref() != Some(&e) { eprintln!("awake: FAILED to acquire sleep assertion ({}): {e}", r.describe()); } self.last_error = Some(e); }
            },
            (Some(_), None) => { self.hold.release(); eprintln!("awake: released sleep assertion (idle)"); self.current = None; self.last_error = None; }
            (Some(a), Some(b)) if a != b => { eprintln!("awake: sleep assertion reason changed: {}", b.describe()); self.current = wanted; }
            _ => {}
        }
    }
}
pub struct Caffeinate(Option<std::process::Child>);
impl Caffeinate { pub fn new() -> Self { Self(None) } }
impl Hold for Caffeinate {
    fn acquire(&mut self) -> Result<(), String> {
        let child = std::process::Command::new("/usr/bin/caffeinate").args(["-i", "-w", &std::process::id().to_string()])
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn().map_err(|e| format!("Cannot start /usr/bin/caffeinate: {e}"))?;
        self.0 = Some(child); Ok(())
    }
    fn release(&mut self) { if let Some(mut c) = self.0.take() { let _ = c.kill(); let _ = c.wait(); } }
}
impl Drop for Caffeinate { fn drop(&mut self) { self.release(); } }

fn dir(root: &Path) -> PathBuf { root.join("awake") }
pub fn load_settings(root: &Path) -> Result<AwakeSettings, String> {
    match fs::read(dir(root).join("settings.json")) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| format!("Cannot read keep-awake settings: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AwakeSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn save_settings(root: &Path, s: &AwakeSettings) -> Result<(), String> {
    fs::create_dir_all(dir(root)).map_err(|e| e.to_string())?;
    let tmp = dir(root).join(format!("settings.tmp-{}", std::process::id()));
    fs::write(&tmp, serde_json::to_vec(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(tmp, dir(root).join("settings.json")).map_err(|e| e.to_string())
}
fn write_state(root: &Path, c: &Controller<Caffeinate>) {
    let state = json!({"held": c.current().is_some(), "reason": c.current().map(Reason::describe), "error": c.last_error, "pid": std::process::id(),
        "checkedAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)});
    let _ = fs::create_dir_all(dir(root));
    if let Err(e) = fs::write(dir(root).join("state.json"), state.to_string()) { eprintln!("awake: cannot write state: {e}"); }
}
/// Reads the host's last published state and current settings for the Settings page.
pub fn status(root: &Path) -> Result<Value, String> {
    let settings = load_settings(root)?;
    let state: Value = fs::read(dir(root).join("state.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    let checked = state["checkedAt"].as_u64().unwrap_or(0);
    let fresh = checked > 0 && crate::companion_crypto::now().saturating_sub(checked) < 60;
    let wake = crate::wake::mac::collect();
    Ok(json!({"settings": settings, "state": if fresh { state } else { Value::Null },
        "wakeForNetwork": wake.as_ref().ok().and_then(|w| w.wake_for_network),
        "wakeTargets": wake.as_ref().map(|w| w.targets.clone()).unwrap_or_default(), "wakeError": wake.err()}))
}
/// Read-only check of the device registry (no locking or rewriting on every poll).
fn phones_paired(root: &Path) -> bool {
    fs::read(root.join("companion/devices.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .is_some_and(|v| v["devices"].as_array().is_some_and(|d| !d.is_empty()))
}
/// Starts the monitor thread inside the host process.
pub fn spawn_monitor(root: PathBuf) {
    std::thread::spawn(move || {
        let mut controller = Controller::new(Caffeinate::new());
        loop {
            std::thread::sleep(Duration::from_secs(15));
            let settings = match load_settings(&root) { Ok(s) => s, Err(e) => { eprintln!("awake: {e}"); AwakeSettings::default() } };
            let activity = match freddai_core::host::call(&root, "snapshot", json!({})) {
                Ok(db) => activity(&db, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)),
                Err(e) => { eprintln!("awake: cannot read host state: {e}"); None }
            };
            let paired = phones_paired(&root);
            controller.apply(decide(&settings, activity, paired));
            write_state(&root, &controller);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)] struct Fake { held: bool, acquires: u32, releases: u32, fail: bool }
    impl Hold for Fake {
        fn acquire(&mut self) -> Result<(), String> { if self.fail { return Err("nope".into()); } self.held = true; self.acquires += 1; Ok(()) }
        fn release(&mut self) { self.held = false; self.releases += 1; }
    }
    #[test]
    fn active_acquires_once_and_idle_releases() {
        let mut c = Controller::new(Fake::default());
        let s = AwakeSettings::default();
        c.apply(decide(&s, Some("1 thread".into()), false));
        c.apply(decide(&s, Some("2 threads".into()), false));
        assert!(c.hold.held); assert_eq!(c.hold.acquires, 1);
        c.apply(decide(&s, None, false));
        assert!(!c.hold.held); assert_eq!(c.hold.releases, 1); assert!(c.current().is_none());
        c.apply(decide(&s, None, false)); assert_eq!(c.hold.releases, 1);
    }
    #[test]
    fn paired_hold_is_opt_in_and_failures_are_recorded() {
        let off = AwakeSettings::default();
        assert_eq!(decide(&off, None, true), None);
        let on = AwakeSettings { while_paired: true, ..off.clone() };
        assert_eq!(decide(&on, None, true), Some(Reason::Paired));
        assert_eq!(decide(&AwakeSettings { while_working: false, while_paired: false }, Some("x".into()), true), None);
        let mut c = Controller::new(Fake { fail: true, ..Default::default() });
        c.apply(Some(Reason::Paired));
        assert!(c.current().is_none()); assert_eq!(c.last_error.as_deref(), Some("nope"));
        c.hold.fail = false; c.apply(Some(Reason::Paired));
        assert!(c.current().is_some()); assert!(c.last_error.is_none());
    }
    #[test]
    fn activity_counts_running_queued_and_imminent_schedules() {
        let db = json!({"sessions":[{"status":"running"},{"status":"done"},{"status":"waiting"}],
            "queues":[{"paused":false,"messages":[{}]},{"paused":true,"messages":[{}]},{"paused":false,"messages":[]}],
            "schedules":[{"enabled":true,"next_due":1_000_000},{"enabled":true,"next_due":9_000_000},{"enabled":false,"next_due":0}]});
        assert_eq!(activity(&db, 950_000).as_deref(), Some("2 threads, 1 queued, 1 schedule due"));
        assert_eq!(activity(&json!({"sessions":[{"status":"done"}],"queues":[],"schedules":[]}), 0), None);
    }
    #[test]
    fn settings_default_and_roundtrip() {
        assert!(AwakeSettings::default().while_working && !AwakeSettings::default().while_paired);
        let root = std::env::temp_dir().join(format!("freddai-awake-{}", std::process::id()));
        assert_eq!(load_settings(&root).unwrap(), AwakeSettings::default());
        save_settings(&root, &AwakeSettings { while_working: false, while_paired: true }).unwrap();
        assert_eq!(load_settings(&root).unwrap(), AwakeSettings { while_working: false, while_paired: true });
        fs::remove_dir_all(root).unwrap();
    }
}
