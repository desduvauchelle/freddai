//! Metadata-only model discovery; never starts a thread or turn.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

/// Newest model ID in a provider catalog: highest creation stamp when rows carry one, otherwise the
/// first row (catalogs list the current flagship first).
pub fn newest(rows: &[Value]) -> Option<String> {
    let id = |m: &Value| m["model"].as_str().or_else(|| m["id"].as_str()).map(String::from);
    let stamp = |m: &Value| ["createdAt", "created", "releaseDate", "created_at"].iter().find_map(|k| {
        m[*k].as_u64().or_else(|| m[*k].as_str().map(|s| s.chars().filter(char::is_ascii_digit).collect::<String>()).and_then(|d| d.parse().ok()))
    });
    rows.iter()
        .filter(|m| id(m).is_some())
        .max_by_key(|m| stamp(m).unwrap_or(0))
        .and_then(|best| {
            if rows.iter().any(|m| stamp(m).is_some()) { id(best) } else { rows.iter().find_map(id) }
        })
}

pub fn read(mut cmd: Command) -> Result<Value, String> {
    cmd.args(["app-server", "--stdio"]);
    query(cmd, Duration::from_secs(15))
}
fn query(mut cmd: Command, timeout: Duration) -> Result<Value, String> {
    cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    let (mut child, job) = crate::windows_process::spawn(&mut cmd).map_err(|e|e.to_string())?;
    #[cfg(not(windows))]
    let mut child = cmd.spawn()
        .map_err(|_| "Could not load models. Check the Codex CLI installation.")?;
    let mut input = child.stdin.take().unwrap();
    let output = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let result = (|| {
        let mut send = |v: Value| -> Result<(), String> {
            writeln!(input, "{v}")
                .and_then(|_| input.flush())
                .map_err(|_| "Model connection closed.".into())
        };
        send(
            json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"freddai","version":"0.1.0"}}}),
        )?;
        let deadline = Instant::now() + timeout;
        let mut initialized = false;
        let mut models = Vec::new();
        loop {
            let line = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| {
                    "Model discovery timed out. Use a custom model ID or reopen the picker."
                })?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if !v["error"].is_null() {
                return Err("Model discovery is unavailable. Use a custom model ID.".into());
            }
            if v["id"] == 1 && !initialized {
                initialized = true;
                send(json!({"method":"initialized"}))?;
                send(json!({"id":2,"method":"model/list","params":{"includeHidden":false}}))?;
            } else if v["id"] == 2 && initialized {
                let rows = v["result"]["data"]
                    .as_array()
                    .ok_or("Invalid model catalog")?;
                models.extend(rows.iter().filter(|m| m["hidden"] != true).cloned());
                if let Some(cursor) = v["result"]["nextCursor"].as_str().filter(|c| !c.is_empty()) {
                    send(
                        json!({"id":2,"method":"model/list","params":{"includeHidden":false,"cursor":cursor}}),
                    )?;
                } else {
                    return Ok(json!(models));
                }
            }
        }
    })();
    drop(input);
    #[cfg(windows)]
    drop(job);
    crate::runtime::terminate(&mut child);
    let _ = reader.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_only_reads_paginated_metadata() {
        let mut cmd = Command::new("python3");
        cmd.args(["-u", "-c", r#"import json,sys
def read(): return json.loads(sys.stdin.readline())
def out(v): print(json.dumps(v),flush=True)
assert read()['method']=='initialize'
out({'id':1,'result':{}})
assert read()['method']=='initialized'
assert read()['method']=='model/list'
out({'id':2,'result':{'data':[{'model':'fixture','supportedReasoningEfforts':[{'reasoningEffort':'xhigh'}]}],'nextCursor':'next'}})
v=read(); assert v['method']=='model/list' and v['params']['cursor']=='next'
out({'id':2,'result':{'data':[{'model':'hidden','hidden':True}],'nextCursor':None}})
"#]);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let models = query(cmd, Duration::from_secs(2)).unwrap();
        assert_eq!(models.as_array().unwrap().len(), 1);
        assert_eq!(
            models[0]["supportedReasoningEfforts"][0]["reasoningEffort"],
            "xhigh"
        );
    }
    #[test]
    fn catalog_passes_service_tiers_through() {
        let mut cmd = Command::new("python3");
        cmd.args(["-u", "-c", r#"import json,sys
def read(): return json.loads(sys.stdin.readline())
def out(v): print(json.dumps(v),flush=True)
read(); out({'id':1,'result':{}})
read(); read()
out({'id':2,'result':{'data':[{'model':'fixture','defaultServiceTier':'default','serviceTiers':[{'id':'priority','name':'Fast','description':'Faster'}]}],'nextCursor':None}})
"#]);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let models = query(cmd, Duration::from_secs(2)).unwrap();
        assert_eq!(models[0]["serviceTiers"][0]["id"], "priority");
        assert_eq!(models[0]["defaultServiceTier"], "default");
    }
    #[test]
    fn stalled_discovery_is_bounded() {
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
    #[test]
    fn newest_prefers_creation_stamp_then_catalog_order() {
        let rows = vec![json!({"model":"old","createdAt":1}), json!({"model":"new","createdAt":9}), json!({"model":"mid","createdAt":5})];
        assert_eq!(newest(&rows).as_deref(), Some("new"));
        let ordered = vec![json!({"model":"first"}), json!({"id":"second"})];
        assert_eq!(newest(&ordered).as_deref(), Some("first"));
        assert_eq!(newest(&[]), None);
    }
}
