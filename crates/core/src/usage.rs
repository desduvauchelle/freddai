//! Read quota metadata without creating a thread or sending a model prompt.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Serialize)]
pub struct UsageWindow {
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
}
#[derive(Debug, Serialize)]
pub struct ResetCredit {
    pub id: String,
    pub title: Option<String>,
    pub status: String,
    pub expires_at: Option<i64>,
    pub expiry_known: bool,
}
#[derive(Debug, Serialize)]
pub struct ResetCredits {
    pub available_count: u64,
    pub credits: Option<Vec<ResetCredit>>,
}
#[derive(Debug, Serialize)]
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
            let label = match duration {
                Some(n) if n > 0 && n % 1440 == 0 => format!("{}-day window", n / 1440),
                Some(n) if n > 0 && n % 60 == 0 => format!("{}-hour window", n / 60),
                Some(n) if n > 0 => format!("{n}-minute window"),
                _ => fallback.to_string(),
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
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not start Codex. Check the CLI installation.".to_string())?;
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
    let result = (|| {
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
                    return Err("This Codex CLI could not initialize usage reporting.".into());
                }
                initialized = true;
                send(json!({"method":"initialized"}))?;
                send(json!({"id":2,"method":method,"params":params}))?;
            } else if v["id"] == 2 && initialized {
                if !v["error"].is_null() {
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
    crate::runtime::terminate(&mut child);
    let _ = reader.join();
    result
}
#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(r.windows[1].label.contains("7-day"));
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
    .stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Claude usage output unavailable")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for l in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(l).is_err() {
                break;
            }
        }
    });
    let result = (|| {
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
                return Err("Claude usage unavailable for this account or CLI version.".into());
            }
        }
    })();
    crate::runtime::terminate(&mut child);
    result
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
            let scope = r["scope"]["model"]["display_name"]
                .as_str()
                .or(r["scope"]["surface"]["display_name"].as_str());
            Some(UsageWindow {
                label: scope
                    .map(|s| format!("{kind} · {s}"))
                    .unwrap_or(kind.into()),
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
        assert_eq!(u.windows[1].label, "weekly_scoped · Opus");
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
