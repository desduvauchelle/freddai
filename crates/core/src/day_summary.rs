//! AI-written daily summaries. A summary is generated only on an explicit request (never in the
//! background), through a tool-free one-off side request to a connected agent, and cached on disk by
//! local calendar date. Every failure is returned to the caller and logged as `day_summary.failed`.
use crate::runtime::{Account, Database, Runtime, Session};
use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// Total characters of thread excerpts sent in one summarization prompt.
pub const INPUT_CAP: usize = 24_000;
const USER_PROMPT_CAP: usize = 500;
const ASSISTANT_CAP: usize = 900;
const SIDE_TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct DaySummary {
    pub date: String,
    pub markdown: String,
    pub generated_at: u64,
    pub provider: String,
    pub account: String,
    pub model: String,
    pub threads: usize,
}
#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct DayError {
    pub code: String,
    pub reason: String,
    pub at: u64,
}
impl DayError {
    fn new(code: &str, reason: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            reason: reason.into(),
            at: now(),
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct ThreadDigest {
    pub project: String,
    pub project_path: String,
    pub account: String,
    pub provider: String,
    pub title: String,
    pub status: String,
    pub updated: u64,
    pub users: Vec<String>,
    pub assistant: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn clip(text: &str, max: usize) -> String {
    let t = text.trim();
    if t.chars().count() <= max {
        t.to_owned()
    } else {
        format!("{}…", t.chars().take(max).collect::<String>())
    }
}

/// Epoch-ms bounds [start, end) of one calendar day in `tz`. Uses real local midnights, so a DST
/// day is 23 or 25 hours long.
pub fn day_bounds<Tz: TimeZone>(tz: &Tz, date: NaiveDate) -> Option<(u64, u64)> {
    let midnight = |d: NaiveDate| {
        let naive = d.and_hms_opt(0, 0, 0)?;
        // A zone that skips midnight (DST gap) starts its day at the first valid instant after it.
        tz.from_local_datetime(&naive).earliest().or_else(|| {
            tz.from_local_datetime(&(naive + chrono::Duration::hours(1)))
                .earliest()
        })
    };
    let (a, b) = (midnight(date)?, midnight(date.succ_opt()?)?);
    Some((
        a.timestamp_millis().max(0) as u64,
        b.timestamp_millis().max(0) as u64,
    ))
}

/// Threads active on the day (their last activity or last user message falls inside it), newest first.
/// Messages carry no timestamps, so a thread is attributed to the days of those two markers.
pub fn collect(db: &Database, date: NaiveDate, tz: &impl TimeZone) -> Vec<ThreadDigest> {
    let Some((start, end)) = day_bounds(tz, date) else {
        return vec![];
    };
    let within = |t: u64| t >= start && t < end;
    let mut out: Vec<ThreadDigest> = db
        .sessions
        .iter()
        .filter(|s| {
            s.deleted_at.is_none()
                && (within(s.updated) || s.last_user_message_at.is_some_and(within))
        })
        .map(|s| digest(db, s))
        .collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    out
}
fn digest(db: &Database, s: &Session) -> ThreadDigest {
    let project = db.projects.iter().find(|p| p.id == s.project);
    let users: Vec<String> = s
        .messages
        .iter()
        .filter(|m| m.role == "user")
        .map(|m| clip(&m.text, USER_PROMPT_CAP))
        .collect();
    ThreadDigest {
        project: project
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Unknown project".into()),
        project_path: project.map(|p| p.path.clone()).unwrap_or_default(),
        account: s.account.clone(),
        provider: db
            .accounts
            .iter()
            .find(|a| a.id == s.account)
            .map(|a| a.provider.clone())
            .unwrap_or_default(),
        title: s.title.clone(),
        status: s.status.clone(),
        updated: s.updated,
        users,
        assistant: s
            .messages
            .iter()
            .rev()
            .find(|m| m.role == "assistant")
            .map(|m| clip(&m.text, ASSISTANT_CAP))
            .unwrap_or_default(),
    }
}

/// Builds the prompt, keeping the total excerpt size within `cap` characters. Threads are given an
/// equal share (newest first); threads beyond what fits are only counted, never silently dropped.
pub fn build_prompt(date: NaiveDate, threads: &[ThreadDigest], cap: usize) -> String {
    let max_threads = (cap / 600).max(1);
    let shown = &threads[..threads.len().min(max_threads)];
    let share = (cap / shown.len().max(1)).max(300);
    let mut body = String::new();
    for t in shown {
        let mut block = format!(
            "### Project: {}\nThread: {} [{}]\n",
            t.project, t.title, t.status
        );
        let mut room = share.saturating_sub(block.chars().count());
        // Keep the first request and the latest ones; they carry the intent and the direction changes.
        let picks: Vec<&String> = if t.users.len() > 4 {
            t.users[..1]
                .iter()
                .chain(t.users[t.users.len() - 3..].iter())
                .collect()
        } else {
            t.users.iter().collect()
        };
        for u in picks {
            let line = format!("User: {}\n", clip(u, room.min(USER_PROMPT_CAP).max(40)));
            room = room.saturating_sub(line.chars().count());
            block.push_str(&line);
        }
        if !t.assistant.is_empty() && room > 80 {
            block.push_str(&format!(
                "Final assistant message: {}\n",
                clip(&t.assistant, room)
            ));
        }
        body.push_str(&block);
        body.push('\n');
    }
    let omitted = threads.len() - shown.len();
    if omitted > 0 {
        body.push_str(&format!("({omitted} older threads omitted for length)\n"));
    }
    format!(
        "Summarize what was accomplished on {date} across these coding-agent threads. Write markdown in two parts. \
         Part 1: a `## Overall` heading first, with 2-4 short bullets on the day's headline outcomes across all projects and threads, then a single bullet starting with `Open:` listing the most important unfinished items or things that need the user (omit it if there are none). \
         Part 2: for each project, a `## <project>` heading, then short bullets for what was done, then bullets starting with `Open:` for what is still unfinished or needs the user. \
         Be terse and concrete; no preamble, no closing remarks. Do not use tools. Only use the information below.\n\n{body}"
    )
}

/// Chooses the account whose agent writes the summary: the claude/codex account with the most threads
/// that day (ties go to the most recently active). No other provider is ever substituted.
pub fn pick_account<'a>(
    db: &'a Database,
    threads: &[ThreadDigest],
) -> Result<(&'a Account, String), DayError> {
    let mut counts: HashMap<&str, (usize, u64)> = HashMap::new();
    for t in threads
        .iter()
        .filter(|t| ["codex", "claude"].contains(&t.provider.as_str()))
    {
        let e = counts.entry(t.account.as_str()).or_default();
        e.0 += 1;
        e.1 = e.1.max(t.updated);
    }
    let best = counts
        .into_iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k.to_owned());
    let account = best
        .as_deref()
        .and_then(|id| db.accounts.iter().find(|a| a.id == id));
    let account = account.ok_or_else(|| DayError::new("no_supported_provider", "No thread that day belongs to a Codex or Claude account, the only providers that can write summaries."))?;
    let path = threads
        .iter()
        .find(|t| t.account == account.id)
        .map(|t| t.project_path.clone())
        .unwrap_or_default();
    Ok((account, path))
}

fn cache_dir(root: &Path) -> PathBuf {
    root.join("day-summaries")
}
fn cache_path(root: &Path, date: &str) -> PathBuf {
    cache_dir(root).join(format!("{date}.json"))
}
pub fn read_cache(root: &Path, date: &str) -> Result<Option<DaySummary>, String> {
    let path = cache_path(root, date);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("cached summary {} is unreadable: {e}", path.display()))
}
pub fn write_cache(root: &Path, summary: &DaySummary) -> Result<(), String> {
    let dir = cache_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (path, tmp) = (
        cache_path(root, &summary.date),
        dir.join(format!("{}.tmp", summary.date)),
    );
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(summary).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// One tool-free request to Codex on its own app-server process: an ephemeral, read-only,
/// never-approve side thread (same configuration as thread-title generation). Nothing it emits
/// can reach a user-visible transcript.
pub(crate) fn side_codex(
    mut cmd: Command,
    cwd: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    cmd.args(["app-server", "--stdio"]);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let _guard = crate::watchdog::Guard::start(child.id());
    let result = (|| -> Result<String, String> {
        let mut stdin = child.stdin.take().ok_or("stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("stdout unavailable")?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let mut send = |v: Value| {
            stdin
                .write_all(format!("{v}\n").as_bytes())
                .and_then(|_| stdin.flush())
                .map_err(|e| e.to_string())
        };
        send(
            json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"freddai-day-summary","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
        )?;
        let deadline = std::time::Instant::now() + timeout;
        let (mut side, mut text) = (String::new(), String::new());
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            let line = if left.is_zero() {
                Err(())
            } else {
                rx.recv_timeout(left).map_err(|_| ())
            };
            let Ok(line) = line else {
                return Err("timed out or the agent closed before a summary was produced".into());
            };
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let method = v["method"].as_str().unwrap_or("");
            if !v["id"].is_null() && !method.is_empty() {
                send(
                    json!({"id":v["id"],"error":{"code":-32601,"message":"not supported for summaries"}}),
                )?;
                continue;
            }
            let failed = |step: &str| {
                format!(
                    "{step}: {}",
                    v["error"]["message"].as_str().unwrap_or("rejected")
                )
            };
            match v["id"].as_i64() {
                Some(1) if !v["error"].is_null() => return Err(failed("initialize")),
                Some(1) => {
                    send(json!({"method":"initialized","params":{}}))?;
                    send(
                        json!({"id":2,"method":"thread/start","params":{"cwd":cwd,"ephemeral":true,"approvalPolicy":"never","sandbox":"read-only","baseInstructions":"You write concise daily work summaries. Never use tools."}}),
                    )?;
                }
                Some(2) if !v["error"].is_null() => return Err(failed("thread/start")),
                Some(2) => {
                    side = v["result"]["thread"]["id"]
                        .as_str()
                        .ok_or("missing side thread id")?
                        .into();
                    send(
                        json!({"id":3,"method":"turn/start","params":{"threadId":side,"effort":"low","input":[{"type":"text","text":prompt}]}}),
                    )?;
                }
                Some(3) if !v["error"].is_null() => return Err(failed("turn/start")),
                _ => {}
            }
            let params = &v["params"];
            if method == "item/completed"
                && params["threadId"] == side.as_str()
                && params["item"]["type"] == "agentMessage"
            {
                text = params["item"]["text"].as_str().unwrap_or("").into();
            }
            if method == "turn/completed" && params["threadId"] == side.as_str() {
                if params["turn"]["status"] != "completed" {
                    return Err(format!(
                        "summary turn ended with status {}",
                        params["turn"]["status"]
                    ));
                }
                return Ok(text);
            }
        }
    })();
    crate::runtime::terminate(&mut child);
    result
}

/// One tool-free, non-persisted `claude -p` call with the prompt on stdin.
pub(crate) fn side_claude(
    mut cmd: Command,
    cwd: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    cmd.args([
        "-p",
        "--output-format",
        "text",
        "--no-session-persistence",
        "--tools",
        "",
    ]);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let _guard = crate::watchdog::Guard::start(child.id());
    let mut stdin = child.stdin.take().ok_or("stdin unavailable")?;
    let (mut stdout, mut stderr) = (
        child.stdout.take().ok_or("stdout unavailable")?,
        child.stderr.take().ok_or("stderr unavailable")?,
    );
    let prompt = prompt.to_owned();
    std::thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
    });
    let errs = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut s = String::new();
        let r = stdout.read_to_string(&mut s).map(|_| s);
        let _ = tx.send(r);
    });
    let out = rx.recv_timeout(timeout);
    let result = match out {
        Err(_) => Err("timed out waiting for Claude".to_string()),
        Ok(Err(e)) => Err(format!("cannot read Claude output: {e}")),
        Ok(Ok(text)) => {
            let status = child.wait().map_err(|e| e.to_string());
            match status {
                Ok(s) if s.success() => Ok(text),
                Ok(s) => Err(format!(
                    "claude exited with {s}: {}",
                    clip(&errs.join().unwrap_or_default(), 400)
                )),
                Err(e) => Err(e),
            }
        }
    };
    crate::runtime::terminate(&mut child);
    result
}

/// Generates and caches one day's summary. `make_cmd` builds the agent process for an account
/// (production: the account's real CLI environment; tests: a fake agent). Logs every outcome.
pub fn generate(
    db: &Database,
    root: &Path,
    date: NaiveDate,
    tz: &impl TimeZone,
    make_cmd: &dyn Fn(&Account) -> Result<Command, String>,
) -> Result<DaySummary, DayError> {
    let key = date.format("%Y-%m-%d").to_string();
    let fail = |e: DayError| {
        crate::timing::log(
            "host",
            format_args!(
                "ev=day_summary.failed date={key} code={} reason={:?}",
                e.code, e.reason
            ),
        );
        e
    };
    let threads = collect(db, date, tz);
    if threads.is_empty() {
        return Err(fail(DayError::new(
            "no_activity",
            "No threads were active on this day.",
        )));
    }
    let (account, cwd) = pick_account(db, &threads).map_err(fail)?;
    crate::timing::log("host", format_args!("ev=day_summary.requested date={key} provider={} account={} threads={} route=side_request", account.provider, account.id, threads.len()));
    let cmd = make_cmd(account).map_err(|e| fail(DayError::new("provider_unavailable", e)))?;
    let prompt = build_prompt(date, &threads, INPUT_CAP);
    let raw = match account.provider.as_str() {
        "codex" => side_codex(cmd, &cwd, &prompt, SIDE_TIMEOUT),
        _ => side_claude(cmd, &cwd, &prompt, SIDE_TIMEOUT),
    }
    .map_err(|e| {
        fail(DayError::new(
            "provider_failed",
            format!("{} request failed: {e}", account.provider),
        ))
    })?;
    let markdown = raw.trim().to_owned();
    if markdown.is_empty() {
        return Err(fail(DayError::new(
            "empty_summary",
            format!("{} returned an empty summary.", account.provider),
        )));
    }
    let summary = DaySummary {
        date: key.clone(),
        markdown,
        generated_at: now(),
        provider: account.provider.clone(),
        account: account.id.clone(),
        model: "default".into(),
        threads: threads.len(),
    };
    write_cache(root, &summary).map_err(|e| fail(DayError::new("cache_write_failed", e)))?;
    crate::timing::log(
        "host",
        format_args!(
            "ev=day_summary.completed date={key} provider={} threads={}",
            summary.provider, summary.threads
        ),
    );
    Ok(summary)
}

#[derive(Clone)]
enum Job {
    Running,
    Failed(DayError),
}
static JOBS: Mutex<Option<HashMap<String, Job>>> = Mutex::new(None);
fn job(date: &str) -> Option<Job> {
    JOBS.lock()
        .unwrap()
        .as_ref()
        .and_then(|m| m.get(date).cloned())
}
fn set_job(date: &str, j: Option<Job>) {
    let mut g = JOBS.lock().unwrap();
    let m = g.get_or_insert_with(HashMap::new);
    match j {
        Some(j) => {
            m.insert(date.into(), j);
        }
        None => {
            m.remove(date);
        }
    }
}
fn parse_date(date: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("Invalid date {date:?}; expected YYYY-MM-DD"))
}

/// `{date, summary, running, error, threads}` for the UI. Never starts a provider call.
pub fn state(rt: &Runtime, date: &str) -> Result<Value, String> {
    let day = parse_date(date)?;
    let (cached, cache_error) = match read_cache(&rt.root_dir(), date) {
        Ok(c) => (c, None),
        Err(e) => {
            crate::timing::log(
                "host",
                format_args!(
                    "ev=day_summary.failed date={date} code=cache_unreadable reason={e:?}"
                ),
            );
            (None, Some(DayError::new("cache_unreadable", e)))
        }
    };
    let threads = collect(&rt.snapshot(), day, &Local).len();
    let (running, error) = match job(date) {
        Some(Job::Running) => (true, None),
        Some(Job::Failed(e)) => (false, Some(e)),
        None => (false, cache_error),
    };
    Ok(json!({"date":date,"summary":cached,"running":running,"error":error,"threads":threads}))
}

/// Starts generation on a detached thread (the host socket has a short timeout) and returns the
/// current state. A cached day is returned untouched unless `force`. The UI polls `state`.
pub fn start(rt: &Runtime, date: &str, force: bool) -> Result<Value, String> {
    let day = parse_date(date)?;
    if day > Local::now().date_naive() {
        return Err("Cannot summarize a future day".into());
    }
    let root = rt.root_dir();
    if !force && read_cache(&root, date).ok().flatten().is_some() {
        return state(rt, date);
    }
    {
        let mut g = JOBS.lock().unwrap();
        let m = g.get_or_insert_with(HashMap::new);
        if matches!(m.get(date), Some(Job::Running)) {
            drop(g);
            return state(rt, date);
        }
        m.insert(date.into(), Job::Running);
    }
    let (db, date_owned) = (rt.snapshot(), date.to_owned());
    std::thread::spawn(move || {
        let result = generate(&db, &root, day, &Local, &|a| {
            crate::runtime::command(a, &root)
        });
        set_job(&date_owned, result.err().map(Job::Failed));
    });
    state(rt, date)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::New_York;

    fn db(sessions: Vec<Value>) -> Database {
        serde_json::from_value(json!({
            "accounts":[{"id":"a","name":"A","provider":"codex","color":"x"},{"id":"g","name":"G","provider":"grok","color":"x"}],
            "projects":[{"id":"p","name":"Project A","path":"/tmp","color":"x","policy":"p","account":null,"last":null}],
            "sessions":sessions,"preferences":{"prefer_last":false,"fallback":null,"last":null}
        })).unwrap()
    }
    fn sess(id: &str, account: &str, updated: u64, extra: Value) -> Value {
        let mut v = json!({"id":id,"project":"p","account":account,"title":format!("T {id}"),"status":"done","updated":updated,"provider_id":null,"messages":[
            {"id":"1","role":"user","text":"Fix the login redirect"},{"id":"2","role":"assistant","text":"Done, redirect fixed."}],"pending":null,"error":null});
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    }
    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("freddai-day-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn fixture(mode: &'static str) -> impl Fn(&Account) -> Result<Command, String> {
        move |_| {
            let mut c = Command::new("python3");
            c.args([
                concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/summary_agent.py"
                ),
                mode,
            ]);
            Ok(c)
        }
    }

    #[test]
    fn day_bounds_follow_local_midnight_including_dst() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 8).unwrap(); // US spring-forward: 23h day
        let (s, e) = day_bounds(&New_York, d).unwrap();
        assert_eq!(e - s, 23 * 3_600_000);
        assert_eq!(
            s,
            New_York
                .with_ymd_and_hms(2026, 3, 8, 0, 0, 0)
                .unwrap()
                .timestamp_millis() as u64
        );
        let (s2, e2) =
            day_bounds(&New_York, NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()).unwrap(); // fall-back: 25h
        assert_eq!(e2 - s2, 25 * 3_600_000);
    }
    #[test]
    fn collect_buckets_by_local_day_boundaries() {
        let d = NaiveDate::from_ymd_opt(2026, 5, 10).unwrap();
        let (s, e) = day_bounds(&New_York, d).unwrap();
        let database = db(vec![
            sess("before", "a", s - 1, json!({})),
            sess("first", "a", s, json!({})),
            sess("last", "a", e - 1, json!({})),
            sess("after", "a", e, json!({})),
            sess("deleted", "a", s + 5, json!({"deleted_at": 1})),
            sess(
                "old-but-prompted",
                "a",
                s - 99_000_000,
                json!({"last_user_message_at": s + 10}),
            ),
        ]);
        let ids: Vec<_> = collect(&database, d, &New_York)
            .into_iter()
            .map(|t| t.title)
            .collect();
        assert_eq!(ids, vec!["T last", "T first", "T old-but-prompted"]);
    }
    #[test]
    fn prompt_is_capped_and_counts_omitted_threads() {
        let many: Vec<ThreadDigest> = (0..200)
            .map(|i| ThreadDigest {
                project: "Project A".into(),
                project_path: "/tmp".into(),
                account: "a".into(),
                provider: "codex".into(),
                title: format!("t{i}"),
                status: "done".into(),
                updated: i,
                users: vec!["x".repeat(5000)],
                assistant: "y".repeat(5000),
            })
            .collect();
        let cap = 6_000;
        let prompt = build_prompt(NaiveDate::from_ymd_opt(2026, 5, 10).unwrap(), &many, cap);
        let instruction_len = prompt.split("### Project").next().unwrap().chars().count();
        assert!(
            prompt.chars().count() < cap + instruction_len + 1_500,
            "prompt {} too large",
            prompt.chars().count()
        );
        assert!(prompt.contains("older threads omitted"));
        assert!(prompt.contains("Project A"));
    }
    #[test]
    fn prompt_asks_for_overall_section_before_project_sections() {
        let prompt = build_prompt(NaiveDate::from_ymd_opt(2026, 5, 10).unwrap(), &[], 6_000);
        let overall = prompt
            .find("`## Overall`")
            .expect("overall section requested");
        let project = prompt
            .find("`## <project>`")
            .expect("project sections requested");
        assert!(
            overall < project,
            "Overall must be requested before per-project sections"
        );
        assert!(prompt.contains("`Open:`"));
    }
    #[test]
    fn long_threads_keep_first_and_latest_user_prompts() {
        let t = ThreadDigest {
            project: "P".into(),
            project_path: String::new(),
            account: "a".into(),
            provider: "codex".into(),
            title: "t".into(),
            status: "done".into(),
            updated: 1,
            users: (0..8).map(|i| format!("prompt{i}")).collect(),
            assistant: String::new(),
        };
        let p = build_prompt(
            NaiveDate::from_ymd_opt(2026, 5, 10).unwrap(),
            &[t],
            INPUT_CAP,
        );
        assert!(p.contains("prompt0") && p.contains("prompt7") && !p.contains("prompt2"));
    }
    #[test]
    fn provider_choice_never_substitutes_unsupported_accounts() {
        let d = NaiveDate::from_ymd_opt(2026, 5, 10).unwrap();
        let (s, _) = day_bounds(&New_York, d).unwrap();
        let only_grok = db(vec![sess("x", "g", s + 1, json!({}))]);
        let err = pick_account(&only_grok, &collect(&only_grok, d, &New_York))
            .err()
            .unwrap();
        assert_eq!(err.code, "no_supported_provider");
        let mixed = db(vec![
            sess("x", "g", s + 5, json!({})),
            sess("y", "a", s + 1, json!({})),
        ]);
        assert_eq!(
            pick_account(&mixed, &collect(&mixed, d, &New_York))
                .unwrap()
                .0
                .id,
            "a"
        );
    }
    #[test]
    fn cache_round_trips_and_reports_corruption() {
        let root = temp("cache");
        assert_eq!(read_cache(&root, "2026-05-10").unwrap(), None);
        let s = DaySummary {
            date: "2026-05-10".into(),
            markdown: "## A\n- x".into(),
            generated_at: 5,
            provider: "codex".into(),
            account: "a".into(),
            model: "default".into(),
            threads: 2,
        };
        write_cache(&root, &s).unwrap();
        assert_eq!(read_cache(&root, "2026-05-10").unwrap(), Some(s));
        fs::write(cache_path(&root, "2026-05-11"), "{nope").unwrap();
        assert!(read_cache(&root, "2026-05-11")
            .unwrap_err()
            .contains("unreadable"));
    }
    fn one_day() -> (Database, NaiveDate) {
        let d = NaiveDate::from_ymd_opt(2026, 5, 10).unwrap();
        let (s, _) = day_bounds(&New_York, d).unwrap();
        (db(vec![sess("x", "a", s + 1, json!({}))]), d)
    }
    #[test]
    fn generates_through_fake_codex_side_thread_and_caches() {
        let (database, d) = one_day();
        let root = temp("codex");
        let summary = generate(&database, &root, d, &New_York, &fixture("codex")).unwrap();
        assert!(summary.markdown.contains("Fixed the login redirect"));
        assert_eq!((summary.provider.as_str(), summary.threads), ("codex", 1));
        assert_eq!(read_cache(&root, "2026-05-10").unwrap(), Some(summary));
    }
    #[test]
    fn generates_through_fake_claude_print_mode() {
        let (mut database, d) = one_day();
        database.accounts[0].provider = "claude".into();
        let summary =
            generate(&database, &temp("claude"), d, &New_York, &fixture("claude")).unwrap();
        assert_eq!(summary.provider, "claude");
        assert!(summary.markdown.starts_with("## Project A"));
    }
    #[test]
    fn provider_failure_is_a_structured_error_and_writes_no_cache() {
        let (mut database, d) = one_day();
        database.accounts[0].provider = "claude".into();
        let root = temp("fail");
        let err = generate(&database, &root, d, &New_York, &fixture("fail")).unwrap_err();
        assert_eq!(err.code, "provider_failed");
        assert!(err.reason.contains("exited"), "{}", err.reason);
        assert_eq!(read_cache(&root, "2026-05-10").unwrap(), None);
        let empty = generate(&db(vec![]), &root, d, &New_York, &fixture("codex")).unwrap_err();
        assert_eq!(empty.code, "no_activity");
    }
}
