//! Read quota metadata without creating a thread or sending a model prompt.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    pub label: String,
    /// "session" (short window, up to 24h), "weekly" or "other".
    #[serde(default)]
    pub window: String,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ResetCredit {
    pub id: String,
    pub title: Option<String>,
    pub status: String,
    pub expires_at: Option<i64>,
    pub expiry_known: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct ResetCredits {
    pub available_count: u64,
    pub credits: Option<Vec<ResetCredit>>,
}
#[derive(Debug, Clone, Serialize)]
pub struct AccountUsage {
    pub windows: Vec<UsageWindow>,
    pub plan: Option<String>,
    pub checked_at: u64,
    pub reset_credits: Option<ResetCredits>,
}
fn parse(result: &Value) -> Result<AccountUsage, String> {
    let mut windows = Vec::new();
    let mut plan = None;
    let buckets: Vec<&Value> = match result["rateLimitsByLimitId"]
        .as_object()
        .filter(|b| !b.is_empty())
    {
        Some(b) => b.values().collect(),
        None => vec![&result["rateLimits"]],
    };
    let multiple = buckets.len() > 1;
    for bucket in buckets {
        if plan.is_none() {
            plan = bucket["planType"].as_str().map(str::to_owned);
        }
        for (key, fallback) in [
            ("primary", "Primary window"),
            ("secondary", "Secondary window"),
        ] {
            let w = &bucket[key];
            let Some(used) = w["usedPercent"]
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.0)
            else {
                continue;
            };
            let duration = w["windowDurationMins"].as_u64();
            let (window, label) = match duration {
                Some(n) if n > 0 && n <= 1440 => ("session", "Session".to_string()),
                Some(n) if n > 1440 => ("weekly", "Weekly".to_string()),
                _ => ("other", fallback.to_string()),
            };
            let label = if multiple {
                format!(
                    "{} · {label}",
                    bucket["limitName"]
                        .as_str()
                        .or(bucket["limitId"].as_str())
                        .unwrap_or("Codex")
                )
            } else {
                label
            };
            windows.push(UsageWindow {
                label,
                window: window.into(),
                used_percent: used,
                resets_at: w["resetsAt"].as_i64(),
            });
        }
    }
    let reset_credits = result["rateLimitResetCredits"]["availableCount"]
        .as_u64()
        .map(|available_count| {
            let credits = result["rateLimitResetCredits"]["credits"]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter_map(|r| {
                            Some(ResetCredit {
                                id: r["id"].as_str()?.into(),
                                title: r["title"].as_str().map(str::to_owned),
                                status: r["status"].as_str().unwrap_or("unknown").into(),
                                expires_at: r["expiresAt"].as_i64(),
                                expiry_known: r
                                    .get("expiresAt")
                                    .is_some_and(|v| v.is_null() || v.as_i64().is_some()),
                            })
                        })
                        .collect()
                });
            ResetCredits {
                available_count,
                credits,
            }
        });
    if windows.is_empty() && reset_credits.is_none() {
        return Err(
            "The provider did not return usage or reset information for this account.".into(),
        );
    }
    Ok(AccountUsage {
        windows,
        plan,
        reset_credits,
        checked_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    })
}
pub fn read(mut command: Command) -> Result<AccountUsage, String> {
    command.args(["app-server", "--stdio"]);
    query(command, Duration::from_secs(15))
}
fn query(command: Command, timeout: Duration) -> Result<AccountUsage, String> {
    parse(&query_rpc(
        command,
        timeout,
        "account/rateLimits/read",
        json!({}),
    )?)
}
pub fn consume_reset(mut command: Command, credit_id: &str, key: &str) -> Result<String, String> {
    if credit_id.trim().is_empty() || key.trim().is_empty() {
        return Err("Choose a reset and provide a retry key.".into());
    }
    command.args(["app-server", "--stdio"]);
    let result = query_rpc(
        command,
        Duration::from_secs(15),
        "account/rateLimitResetCredit/consume",
        json!({"creditId":credit_id,"idempotencyKey":key}),
    )?;
    match result["outcome"].as_str() {
        Some(outcome @ ("reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit")) => {
            Ok(outcome.into())
        }
        _ => Err("Reset outcome was not recognized. Refresh usage before trying again.".into()),
    }
}
fn query_rpc(
    mut command: Command,
    timeout: Duration,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    let (mut child, job) = crate::windows_process::spawn(&mut command).map_err(|e|e.to_string())?;
    #[cfg(not(windows))]
    let mut child = command.spawn().map_err(|e| {
        let msg = "Could not start Codex. Check the CLI installation.".to_string();
        log_failure("codex", method, &msg, &e.to_string(), "");
        msg
    })?;
    let stderr_tail = capture_stderr(&mut child);
    let raw_error = std::cell::RefCell::new(String::new());
    let mut input = child.stdin.take().unwrap();
    let output = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else {
                break;
            };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let result = (|| -> Result<Value, String> {
        let mut send = |v: Value| -> Result<(), String> {
            writeln!(input, "{v}")
                .and_then(|_| input.flush())
                .map_err(|_| "Codex usage connection closed.".into())
        };
        send(
            json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"freddai","version":"0.1.0"}}}),
        )?;
        let deadline = Instant::now() + timeout;
        let mut initialized = false;
        let mut refreshed = false;
        let mut request_id = 2;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Usage request timed out. Try refreshing.".into());
            }
            let line = rx.recv_timeout(remaining).map_err(|_| {
                "Usage could not be retrieved. Check sign-in in Manage accounts, then refresh."
                    .to_string()
            })?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if v["id"] == 1 && !initialized {
                if !v["error"].is_null() {
                    *raw_error.borrow_mut() = v["error"]["message"].as_str().unwrap_or("").to_string();
                    return Err("This Codex CLI could not initialize usage reporting.".into());
                }
                initialized = true;
                send(json!({"method":"initialized"}))?;
                send(json!({"id":2,"method":method,"params":params}))?;
            } else if v["id"] == 3 && refreshed {
                if !v["error"].is_null() || v["result"]["account"].is_null() {
                    *raw_error.borrow_mut() = v["error"]["message"].as_str().unwrap_or("account/read returned no account").to_string();
                    return Err(AUTH_EXPIRED_COPY.into());
                }
                request_id = 4;
                send(json!({"id":request_id,"method":method,"params":params}))?;
            } else if v["id"] == request_id && initialized {
                if !v["error"].is_null() {
                    *raw_error.borrow_mut() = v["error"]["message"].as_str().unwrap_or("").to_string();
                    // Classify internally; never expose raw provider bodies or credentials.
                    let message = v["error"]["message"].as_str().unwrap_or("").to_ascii_lowercase();
                    let unauthorized = is_auth_error(&message);
                    if unauthorized && !refreshed && method == "account/rateLimits/read" {
                        refreshed = true;
                        send(json!({"id":3,"method":"account/read","params":{"refreshToken":true}}))?;
                        continue;
                    }
                    if unauthorized {
                        return Err(AUTH_EXPIRED_COPY.into());
                    }
                    if message.contains("429") || message.contains("too many requests") {
                        return Err("Codex usage requests are temporarily rate limited. Try again shortly.".into());
                    }
                    return Err(
                        "The Codex request failed. Refresh usage and check account sign-in before retrying."
                            .into(),
                    );
                }
                return Ok(v["result"].clone());
            }
        }
    })();
    drop(input);
    #[cfg(windows)]
    drop(job);
    crate::runtime::terminate(&mut child);
    let _ = reader.join();
    if let Err(e) = &result {
        log_failure("codex", method, e, &raw_error.borrow(), &last_stderr(&stderr_tail));
    }
    result
}
type StderrTail = Arc<Mutex<Vec<String>>>;
/// Keep the last few stderr lines of a child so failures can be diagnosed.
fn capture_stderr(child: &mut std::process::Child) -> StderrTail {
    let tail: StderrTail = Default::default();
    if let Some(err) = child.stderr.take() {
        let tail = tail.clone();
        std::thread::spawn(move || {
            for l in BufReader::new(err).lines().map_while(Result::ok) {
                let mut t = tail.lock().unwrap();
                t.push(l);
                if t.len() > 5 {
                    t.remove(0);
                }
            }
        });
    }
    tail
}
fn last_stderr(tail: &StderrTail) -> String {
    tail.lock()
        .unwrap()
        .iter()
        .rev()
        .find(|l| !l.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}
fn redact(text: &str) -> String {
    let mut prev_bearer = false;
    let mut out = Vec::new();
    for word in text.split_whitespace() {
        let lower = word.to_ascii_lowercase();
        let w = if prev_bearer {
            "[redacted]".to_string()
        } else if let Some(i) = word.find("eyJ") {
            format!("{}[redacted]", &word[..i])
        } else if lower.contains("token") && word.contains(['=', ':']) {
            let i = word.find(['=', ':']).unwrap();
            format!("{}[redacted]", &word[..=i])
        } else {
            word.to_string()
        };
        prev_bearer = lower == "bearer";
        out.push(w);
    }
    out.join(" ")
}
/// Stable user-facing copy for an expired provider sign-in. The UI matches on `sign-in needed`
/// (see `isAuthError` in packages/app/src/desktop/reconnect.ts) and shows a Reconnect button.
pub const AUTH_EXPIRED_COPY: &str = "Codex sign-in needed. Reconnect this account.";
/// True when a provider error means the stored sign-in is no longer valid.
pub fn is_auth_error(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    ["refresh token was already used", "token_expired", "401", "unauthorized", "sign in again", "log out and sign in", "sign-in expired", "sign-in needed", "authentication required", "not logged in", "returned no account"]
        .iter()
        .any(|needle| m.contains(needle))
}
/// Result of really validating a provider sign-in (not just checking that credentials exist).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AuthState {
    Valid,
    /// Credentials are missing or the provider says the sign-in is signed out.
    Required,
    /// The provider rejected the stored token (dead refresh token). Reconnect needed.
    Expired { error: String },
    /// The check itself failed (network, timeout, CLI error). Status unknown, not "expired".
    Unverified { error: String },
}
/// Classify the outcome of a real token-validating read (usage / account read).
pub fn classify_validation<T>(result: &Result<T, String>) -> AuthState {
    match result {
        Ok(_) => AuthState::Valid,
        Err(e) if is_auth_error(e) => AuthState::Expired { error: e.clone() },
        Err(e) => AuthState::Unverified { error: e.clone() },
    }
}
/// Structured, redacted failure event for quota reads. Never silent.
pub fn log_failure(provider: &str, method: &str, error: &str, raw: &str, stderr: &str) {
    let raw: String = redact(raw).chars().take(300).collect();
    let stderr: String = redact(stderr).chars().take(300).collect();
    eprintln!("usage_read_failed provider={provider} method={method} error={error} raw={raw} stderr={stderr}");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_classifies_valid_expired_and_unverifiable() {
        assert_eq!(classify_validation::<()>(&Ok(())), AuthState::Valid);
        let dead = "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.";
        assert!(matches!(classify_validation::<()>(&Err(dead.into())), AuthState::Expired { .. }));
        assert!(matches!(classify_validation::<()>(&Err(AUTH_EXPIRED_COPY.into())), AuthState::Expired { .. }));
        assert!(matches!(classify_validation::<()>(&Err("Usage request timed out. Try refreshing.".into())), AuthState::Unverified { .. }));
        assert!(matches!(classify_validation::<()>(&Err("connection refused".into())), AuthState::Unverified { .. }));
    }
    #[test]
    fn classifies_auth_errors_but_not_other_failures() {
        for m in [
            "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
            "401 Unauthorized: token_expired",
            "Please sign in again",
            "codex account authentication required to read rate limits",
            "Not logged in",
            "account/read returned no account",
            AUTH_EXPIRED_COPY,
        ] {
            assert!(is_auth_error(m), "{m}");
        }
        for m in ["429 too many requests", "Usage request timed out. Try refreshing.", "model not found"] {
            assert!(!is_auth_error(m), "{m}");
        }
    }
    #[test]
    fn quota_windows_preserve_zero_and_unknown_reset_and_multiple_buckets() {
        let v = json!({"rateLimitsByLimitId":{
            "codex":{"limitId":"codex","planType":"plus","primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":null}},
            "other":{"limitName":"Other","secondary":{"usedPercent":110,"windowDurationMins":10080,"resetsAt":1800000000}}
        }});
        let r = parse(&v).unwrap();
        assert_eq!(r.windows.len(), 2);
        assert_eq!(r.windows[0].used_percent, 0.0);
        assert_eq!(r.windows[0].resets_at, None);
        assert_eq!(r.windows[1].used_percent, 110.0);
        assert_eq!(r.windows[0].window, "session");
        assert_eq!(r.windows[0].label, "codex · Session");
        assert_eq!(r.windows[1].window, "weekly");
        assert_eq!(r.windows[1].label, "Other · Weekly");
        let unknown = parse(&json!({"rateLimits":{"primary":{"usedPercent":1}}})).unwrap();
        assert_eq!(unknown.windows[0].window, "other");
        assert_eq!(unknown.windows[0].label, "Primary window");
        assert!(parse(&json!({"rateLimits":{"primary":{"usedPercent":null}}})).is_err());
    }
    #[test]
    fn banked_resets_preserve_count_partial_details_and_expiry() {
        let r = parse(
            &json!({"rateLimitResetCredits":{"availableCount":3,"credits":[
                {"id":"dated","status":"available","expiresAt":1800000000,"title":"Free reset"},
                {"id":"forever","status":"available","expiresAt":null},
                {"id":"unknown","status":"available"}
            ]}}),
        )
        .unwrap();
        let resets = r.reset_credits.unwrap();
        assert_eq!(resets.available_count, 3);
        let details = resets.credits.unwrap();
        assert_eq!(details[0].expires_at, Some(1800000000));
        assert!(details[0].expiry_known);
        assert!(details[1].expiry_known);
        assert_eq!(details[1].expires_at, None);
        assert!(!details[2].expiry_known);
        let count_only =
            parse(&json!({"rateLimitResetCredits":{"availableCount":5,"credits":null}})).unwrap();
        assert_eq!(count_only.reset_credits.unwrap().available_count, 5);
        let zero =
            parse(&json!({"rateLimitResetCredits":{"availableCount":0,"credits":[]}})).unwrap();
        assert_eq!(zero.reset_credits.unwrap().credits.unwrap().len(), 0);
        assert!(parse(&json!({"rateLimitResetCredits":null})).is_err());
        assert!(parse(&json!({"rateLimitResetCredits":{"availableCount":-1}})).is_err());
    }
    #[test]
    fn usage_protocol_only_initializes_and_reads_limits() {
        let mut cmd = Command::new("python3");
        cmd.args(["-u","-c",r#"import sys,json
x=json.loads(sys.stdin.readline()); assert x['method']=='initialize'
print(json.dumps({'id':1,'result':{}}),flush=True)
x=json.loads(sys.stdin.readline()); assert x['method']=='initialized'
x=json.loads(sys.stdin.readline()); assert x['method']=='account/rateLimits/read'
print(json.dumps({'id':2,'result':{'rateLimits':{'primary':{'usedPercent':25,'windowDurationMins':300,'resetsAt':1800000000}}}}),flush=True)
"#]);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let r = query(cmd, Duration::from_secs(2)).unwrap();
        assert_eq!(r.windows[0].used_percent, 25.0);
    }
    #[test]
    fn reset_redemption_sends_exact_credit_and_stable_retry_key() {
        for outcome in ["reset", "alreadyRedeemed", "nothingToReset", "noCredit"] {
            let mut cmd = Command::new("python3");
            cmd.args([
                "-u",
                "-c",
                r#"import sys,json
assert sys.argv[2:] == ['app-server','--stdio']
x=json.loads(sys.stdin.readline()); assert x['method']=='initialize'
print(json.dumps({'id':1,'result':{}}),flush=True)
x=json.loads(sys.stdin.readline()); assert x['method']=='initialized'
x=json.loads(sys.stdin.readline()); assert x['method']=='account/rateLimitResetCredit/consume'
assert x['params'] == {'creditId':'chosen-reset','idempotencyKey':'stable-retry-key'}
print(json.dumps({'id':2,'result':{'outcome':sys.argv[1]}}),flush=True)
"#,
                outcome,
            ]);
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                cmd.process_group(0);
            }
            assert_eq!(
                consume_reset(cmd, "chosen-reset", "stable-retry-key").unwrap(),
                outcome
            );
        }
        assert!(consume_reset(Command::new("must-not-start"), "", "key").is_err());
        assert!(consume_reset(Command::new("must-not-start"), "credit", "").is_err());
    }
    #[test]
    fn expired_usage_token_refreshes_once_then_retries_without_a_turn() {
        let mut cmd = Command::new("python3");
        cmd.args(["-u", "-c", r#"import sys,json
def read(): return json.loads(sys.stdin.readline())
def reply(id, **v): print(json.dumps(dict(id=id,**v)),flush=True)
assert read()['method']=='initialize'
reply(1,result={})
assert read()['method']=='initialized'
assert read()['method']=='account/rateLimits/read'
reply(2,error={'code':-32603,'message':'401 Unauthorized: token_expired'})
x=read(); assert x['method']=='account/read' and x['params']=={'refreshToken':True}
reply(x['id'],result={'account':{'type':'chatgpt'}})
x=read(); assert x['method']=='account/rateLimits/read'
reply(x['id'],result={'rateLimits':{'primary':{'usedPercent':42}}})
"#]);
        #[cfg(unix)]
        { use std::os::unix::process::CommandExt; cmd.process_group(0); }
        assert_eq!(query(cmd, Duration::from_secs(2)).unwrap().windows[0].used_percent, 42.);
    }
    #[test]
    fn repeated_auth_failure_is_bounded_and_redacted() {
        let mut cmd = Command::new("python3");
        cmd.args(["-u", "-c", r#"import sys,json
def read(): return json.loads(sys.stdin.readline())
def reply(id, **v): print(json.dumps(dict(id=id,**v)),flush=True)
read(); reply(1,result={}); read(); read()
reply(2,error={'message':'401 token_expired secret-body'})
x=read(); assert x['method']=='account/read'
reply(3,result={'account':{'type':'chatgpt'}})
x=read(); assert x['id']==4
reply(4,error={'message':'401 token_expired secret-body'})
assert sys.stdin.readline()==''
"#]);
        #[cfg(unix)]
        { use std::os::unix::process::CommandExt; cmd.process_group(0); }
        let error = query(cmd, Duration::from_secs(2)).unwrap_err();
        assert!(error.contains("Reconnect this account"));
        assert!(!error.contains("secret-body"));
    }
    #[test]
    fn stalled_usage_process_is_bounded() {
        let mut cmd = Command::new("python3");
        cmd.args(["-c", "import time; time.sleep(30)"]);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let start = Instant::now();
        assert!(query(cmd, Duration::from_millis(50)).is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}

/// Read Claude's structured local /usage report. This command does not ask the model to work.
pub fn read_claude(mut cmd: Command) -> Result<AccountUsage, String> {
    cmd.args([
        "-p",
        "/usage",
        "--verbose",
        "--output-format",
        "stream-json",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    let (mut child, job) = crate::windows_process::spawn(&mut cmd).map_err(|e|e.to_string())?;
    #[cfg(not(windows))]
    let mut child = cmd.spawn().map_err(|e| {
        log_failure("claude", "-p /usage", &e.to_string(), "", "");
        e.to_string()
    })?;
    let stderr_tail = capture_stderr(&mut child);
    let stdout = child
        .stdout
        .take()
        .ok_or("Claude usage output unavailable")?;
    let raw_error = std::cell::RefCell::new(String::new());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for l in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(l).is_err() {
                break;
            }
        }
    });
    let result = (|| -> Result<AccountUsage, String> {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let line=rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).map_err(|_|"Claude did not return a structured usage report. Update Claude Code or check account sign-in.")?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(report) = v
                .get("usage_report")
                .or_else(|| v["message"].get("usage_report"))
            {
                return parse_claude(report);
            }
            if v["type"] == "result" {
                *raw_error.borrow_mut() = v["result"].as_str().unwrap_or("").to_string();
                return Err("Claude usage unavailable for this account or CLI version.".into());
            }
        }
    })();
    #[cfg(windows)]
    drop(job);
    crate::runtime::terminate(&mut child);
    if let Err(e) = &result {
        log_failure("claude", "-p /usage", e, &raw_error.borrow(), &last_stderr(&stderr_tail));
    }
    result
}

/// Read Antigravity's structured `/usage` report (`agy -p /usage`). No model turn is made.
pub fn read_antigravity(mut cmd: Command) -> Result<AccountUsage, String> {
    const METHOD: &str = "-p /usage";
    cmd.args(["-p", "/usage", "--output-format", "stream-json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    let (mut child, job) = crate::windows_process::spawn(&mut cmd).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let mut child = cmd.spawn().map_err(|e| {
        let msg = "Could not start Antigravity. Check the CLI installation.".to_string();
        log_failure("antigravity", METHOD, &msg, &e.to_string(), "");
        msg
    })?;
    let stderr_tail = capture_stderr(&mut child);
    let stdout = child
        .stdout
        .take()
        .ok_or("Antigravity usage output unavailable")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for l in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(l).is_err() {
                break;
            }
        }
    });
    let raw_error = std::cell::RefCell::new(String::new());
    let result = (|| -> Result<AccountUsage, String> {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let line = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "Antigravity did not return a structured usage report. Update the Antigravity CLI or check sign-in.")?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if v["event"] == "command_result" {
                return parse_antigravity(&v["command"]["data"]);
            }
            if v["event"] == "result" && v["result"]["command"]["data"].is_object() {
                return parse_antigravity(&v["result"]["command"]["data"]);
            }
            if v["event"] == "result" || v["event"] == "error" {
                *raw_error.borrow_mut() = line.clone();
                return Err("Antigravity usage unavailable for this account or CLI version.".into());
            }
        }
    })();
    #[cfg(windows)]
    drop(job);
    crate::runtime::terminate(&mut child);
    if let Err(e) = &result {
        log_failure("antigravity", METHOD, e, &raw_error.borrow(), &last_stderr(&stderr_tail));
    }
    result
}
/// `data` is the `command.data` object of a `/usage` command result.
pub fn parse_antigravity(data: &Value) -> Result<AccountUsage, String> {
    let groups = data["groups"]
        .as_array()
        .ok_or("Antigravity did not report plan usage")?;
    let mut windows = Vec::new();
    for g in groups {
        let name = g["name"].as_str().unwrap_or("Antigravity");
        let short = match name {
            "Gemini Models" => "Gemini",
            "Claude and GPT models" => "Claude & GPT",
            "Gemini 4 Argon" => "Argon",
            other => other,
        };
        for b in g["buckets"].as_array().into_iter().flatten() {
            let (window, kind) = match b["window"].as_str() {
                Some("5h") => ("session", "Session"),
                Some("weekly") => ("weekly", "Weekly"),
                _ => continue,
            };
            let Some(remaining) = b["remaining_fraction"].as_f64().filter(|n| n.is_finite()) else {
                continue;
            };
            windows.push(UsageWindow {
                label: format!("{short} · {kind}"),
                window: window.into(),
                used_percent: ((1.0 - remaining) * 100.0).clamp(0.0, 100.0),
                resets_at: b["reset_time"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp()),
            });
        }
    }
    if windows.is_empty() {
        return Err("Antigravity did not report any quota windows".into());
    }
    Ok(AccountUsage {
        windows,
        plan: None,
        reset_credits: None,
        checked_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    })
}
const COPILOT_NEEDS_GH: &str = "Copilot usage needs the GitHub CLI: install gh and run `gh auth login`.";
/// Read Copilot's monthly premium-request quota via `gh api copilot_internal/user`. No model turn.
pub fn read_copilot() -> Result<AccountUsage, String> {
    const METHOD: &str = "gh api copilot_internal/user";
    let result = (|| -> Result<(AccountUsage, String), (String, String, String)> {
        let fail = |msg: &str, raw: String, err: String| (msg.to_string(), raw, err);
        let gh = crate::platform::executable_in("gh", crate::platform::cli_dirs())
            .ok_or_else(|| fail(COPILOT_NEEDS_GH, String::new(), "gh not found".into()))?;
        let mut cmd = crate::platform::quiet_command(gh);
        if let Ok(path) = crate::platform::cli_path() {
            cmd.env("PATH", path);
        }
        cmd.args(["api", "copilot_internal/user"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| fail(COPILOT_NEEDS_GH, String::new(), e.to_string()))?;
        let stderr_tail = capture_stderr(&mut child);
        let mut stdout = child.stdout.take().ok_or_else(|| fail(COPILOT_NEEDS_GH, String::new(), "no stdout".into()))?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut body = String::new();
            let _ = std::io::Read::read_to_string(&mut stdout, &mut body);
            let _ = tx.send(body);
        });
        let body = match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(b) => b,
            Err(_) => {
                crate::runtime::terminate(&mut child);
                return Err(fail("Copilot usage request timed out. Try refreshing.", String::new(), last_stderr(&stderr_tail)));
            }
        };
        let status = child.wait().map_err(|e| fail(COPILOT_NEEDS_GH, body.clone(), e.to_string()))?;
        if !status.success() {
            return Err(fail(COPILOT_NEEDS_GH, body, last_stderr(&stderr_tail)));
        }
        let v: Value = serde_json::from_str(&body)
            .map_err(|e| fail("Copilot returned an unreadable usage report.", body.clone(), e.to_string()))?;
        parse_copilot(&v)
            .map(|u| (u, String::new()))
            .map_err(|e| fail(&e, body, String::new()))
    })();
    match result {
        Ok((u, _)) => Ok(u),
        Err((msg, raw, stderr)) => {
            log_failure("copilot", METHOD, &msg, &raw, &stderr);
            Err(msg)
        }
    }
}
/// `v` is the response of `gh api copilot_internal/user`.
pub fn parse_copilot(v: &Value) -> Result<AccountUsage, String> {
    let q = &v["quota_snapshots"]["premium_interactions"];
    if !q.is_object() {
        return Err("Copilot did not report premium request quota".into());
    }
    let (used_percent, resets_at) = if q["unlimited"].as_bool() == Some(true) {
        (0.0, None)
    } else {
        let remaining = q["percent_remaining"]
            .as_f64()
            .filter(|n| n.is_finite())
            .ok_or("Copilot did not report premium request quota")?;
        (
            (100.0 - remaining).clamp(0.0, 100.0),
            v["quota_reset_date_utc"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.timestamp()),
        )
    };
    Ok(AccountUsage {
        windows: vec![UsageWindow {
            label: "Premium requests".into(),
            window: "other".into(),
            used_percent,
            resets_at,
        }],
        plan: v["copilot_plan"].as_str().map(str::to_owned),
        reset_credits: None,
        checked_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    })
}
pub fn parse_claude(report: &Value) -> Result<AccountUsage, String> {
    let rows = report["rate_limits"]["limits"]
        .as_array()
        .ok_or("Claude did not report plan usage")?;
    let windows = rows
        .iter()
        .filter_map(|r| {
            let percent = r["percent"]
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.)?;
            let kind = r["kind"].as_str().unwrap_or("Usage");
            let model = r["scope"]["model"]["display_name"].as_str();
            let surface = r["scope"]["surface"]["display_name"].as_str();
            let (window, label) = match (kind, model.or(surface)) {
                ("session", _) => ("session", "Session".to_string()),
                ("weekly", None) => ("weekly", "All models".to_string()),
                ("weekly_scoped", _) | ("weekly", Some(_)) => (
                    "weekly",
                    match (model, surface) {
                        (Some(m), _) => format!("{m} only"),
                        (None, Some(s)) => s.to_string(),
                        (None, None) => "Scoped".to_string(),
                    },
                ),
                (_, scope) => (
                    "other",
                    scope
                        .map(|s| format!("{kind} · {s}"))
                        .unwrap_or(kind.into()),
                ),
            };
            Some(UsageWindow {
                label,
                window: window.into(),
                used_percent: percent,
                resets_at: r["resets_at"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp()),
            })
        })
        .collect::<Vec<_>>();
    if windows.is_empty() {
        return Err("Claude did not report any quota windows".into());
    }
    Ok(AccountUsage {
        windows,
        plan: None,
        reset_credits: None,
        checked_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    })
}
#[cfg(test)]
mod claude_tests {
    use super::*;
    #[test]
    fn preserves_actual_windows_and_unknown_resets() {
        let u=parse_claude(&json!({"rate_limits":{"limits":[{"kind":"session","percent":0,"resets_at":null},{"kind":"weekly_scoped","percent":91,"resets_at":"2026-11-04T00:00:00Z","scope":{"model":{"display_name":"Opus"}}}]}})).unwrap();
        assert_eq!(u.windows.len(), 2);
        assert_eq!(u.windows[0].used_percent, 0.);
        assert_eq!(u.windows[0].resets_at, None);
        assert_eq!(u.windows[0].label, "Session");
        assert_eq!(u.windows[0].window, "session");
        assert_eq!(u.windows[1].label, "Opus only");
        assert_eq!(u.windows[1].window, "weekly");
        let w=parse_claude(&json!({"rate_limits":{"limits":[{"kind":"weekly","percent":5},{"kind":"mystery","percent":1}]}})).unwrap();
        assert_eq!((w.windows[0].label.as_str(), w.windows[0].window.as_str()), ("All models", "weekly"));
        assert_eq!((w.windows[1].label.as_str(), w.windows[1].window.as_str()), ("mystery", "other"));
    }
    #[test]
    fn only_local_usage_command_is_requested() {
        let mut cmd = Command::new("python3");
        cmd.args(["-c",r#"import sys,json
assert sys.argv[1:] == ['-p','/usage','--verbose','--output-format','stream-json']
print(json.dumps({'type':'assistant','usage_report':{'rate_limits':{'limits':[{'kind':'session','percent':33,'resets_at':None}]}}}),flush=True)
"#]);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        assert_eq!(read_claude(cmd).unwrap().windows[0].used_percent, 33.);
    }
}
#[cfg(test)]
mod antigravity_tests {
    use super::*;
    fn sample() -> Value {
        json!({"groups":[
            {"name":"Gemini Models","buckets":[
                {"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.9999,"reset_time":"2026-11-17T21:30:18Z"},
                {"id":"gemini-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":1,"reset_time":"2026-11-11T10:16:24Z"}]},
            {"name":"Claude and GPT models","buckets":[
                {"id":"c-5h","window":"5h","remaining_fraction":0.25,"reset_time":"2026-11-11T10:16:24Z"}]},
            {"name":"Gemini 4 Argon","buckets":[
                {"id":"gemini-argon-wtu-weekly","window":"weekly","remaining_fraction":0.987,"reset_time":"2026-11-17T21:30:07Z"}]}
        ]})
    }
    #[test]
    fn parses_groups_into_session_and_weekly_windows() {
        let u = parse_antigravity(&sample()).unwrap();
        let rows: Vec<_> = u.windows.iter().map(|w| (w.label.as_str(), w.window.as_str())).collect();
        assert_eq!(rows, [
            ("Gemini · Weekly", "weekly"),
            ("Gemini · Session", "session"),
            ("Claude & GPT · Session", "session"),
            ("Argon · Weekly", "weekly"),
        ]);
        assert!((u.windows[0].used_percent - 0.01).abs() < 1e-6);
        assert_eq!(u.windows[1].used_percent, 0.0);
        assert_eq!(u.windows[2].used_percent, 75.0);
        assert_eq!(u.windows[1].resets_at, Some(1794392184));
        assert!(parse_antigravity(&json!({"groups":[]})).is_err());
    }
    #[test]
    fn redaction_hides_credentials() {
        let r = redact("Bearer abc.def token=xyz eyJhbGciOi.payload ok");
        assert_eq!(r, "Bearer [redacted] token=[redacted] [redacted] ok");
    }
    #[test]
    fn only_local_usage_command_is_requested() {
        let mut cmd = Command::new("python3");
        cmd.args(["-c", r#"import sys,json
assert sys.argv[1:] == ['-p','/usage','--output-format','stream-json']
print(json.dumps({'event':'command_result','command':{'name':'usage','data':{'groups':[{'name':'Gemini Models','buckets':[{'window':'5h','remaining_fraction':0.5,'reset_time':'2026-11-11T10:16:24Z'}]}]}}}),flush=True)
"#]);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        assert_eq!(read_antigravity(cmd).unwrap().windows[0].used_percent, 50.);
    }
}
#[cfg(test)]
mod copilot_tests {
    use super::*;
    #[test]
    fn parses_premium_interactions() {
        let v = json!({"copilot_plan":"individual_pro","quota_reset_date_utc":"2026-12-01T00:00:00.000Z","quota_snapshots":{"premium_interactions":{"percent_remaining":98.2,"quota_remaining":1474.0,"unlimited":false,"entitlement":1500,"remaining":1474,"credits_used":26,"quota_id":"premium_interactions"},"chat":{"unlimited":true},"completions":{"unlimited":true}}});
        let u = parse_copilot(&v).unwrap();
        assert_eq!(u.plan.as_deref(), Some("individual_pro"));
        assert_eq!(u.windows.len(), 1);
        assert_eq!(u.windows[0].label, "Premium requests");
        assert!((u.windows[0].used_percent - 1.8).abs() < 1e-9);
        assert_eq!(u.windows[0].resets_at, Some(1796083200));
    }
    #[test]
    fn unlimited_reports_zero_without_reset() {
        let v = json!({"copilot_plan":"business","quota_reset_date_utc":"2026-12-01T00:00:00.000Z","quota_snapshots":{"premium_interactions":{"unlimited":true}}});
        let u = parse_copilot(&v).unwrap();
        assert_eq!(u.windows[0].used_percent, 0.0);
        assert_eq!(u.windows[0].resets_at, None);
    }
    #[test]
    fn missing_quota_is_an_error() {
        assert_eq!(
            parse_copilot(&json!({"quota_snapshots":{}})).unwrap_err(),
            "Copilot did not report premium request quota"
        );
    }
}
