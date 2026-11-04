//! Metadata-only model discovery; never starts a thread or turn.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

pub fn read(mut cmd: Command) -> Result<Value, String> {
    cmd.args(["app-server", "--stdio"]);
    query(cmd, Duration::from_secs(15))
}
fn query(mut cmd: Command, timeout: Duration) -> Result<Value, String> {
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
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
}
