//! ACP v1 wire shapes. No advertised filesystem or terminal delegation.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};
pub fn request(id: u64, method: &str, params: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
}
pub fn initialize() -> Value {
    request(
        101,
        "initialize",
        json!({"protocolVersion":1,"clientInfo":{"name":"freddai","version":"0.1.0"},"clientCapabilities":{}}),
    )
}
pub fn authenticate(init: &Value, provider: &str) -> Result<Value, String> {
    if init["protocolVersion"] != 1 {
        return Err("This agent does not support ACP v1. Update its CLI.".into());
    }
    let wanted = if provider == "grok" {
        "cached_token"
    } else {
        "oauth-personal"
    };
    if !init["authMethods"]
        .as_array()
        .is_some_and(|a| a.iter().any(|x| x["id"] == wanted))
    {
        return Err(format!(
            "{provider} did not offer {wanted} authentication. Sign in using its CLI."
        ));
    }
    Ok(request(
        102,
        "authenticate",
        json!({"methodId":wanted,"_meta":{"headless":true}}),
    ))
}
pub fn session(cwd: &str, resume: Option<&str>, init: &Value) -> Result<Value, String> {
    let mut params = json!({"cwd":cwd,"mcpServers":[]});
    let method = if let Some(id) = resume {
        if init["agentCapabilities"]["loadSession"] != true {
            return Err("This CLI cannot resume ACP sessions. Fork the thread to continue in a new session.".into());
        }
        params["sessionId"] = json!(id);
        "session/load"
    } else {
        "session/new"
    };
    Ok(request(103, method, params))
}
pub fn select_model(session: &Value, session_id: &str, model: &str) -> Result<Value, String> {
    let option = session["configOptions"].as_array()
        .and_then(|options| options.iter().find(|o| o["category"] == "model" || o["id"] == "model"))
        .ok_or("This agent version does not expose model selection. Choose Model default or update the CLI.")?;
    let config = option["id"]
        .as_str()
        .ok_or("Missing model configuration ID")?;
    let available = option["options"].as_array().is_some_and(|options| {
        options.iter().any(|o| {
            o["value"] == model
                || o["options"]
                    .as_array()
                    .is_some_and(|group| group.iter().any(|v| v["value"] == model))
        })
    });
    if !available {
        return Err(format!("Agent did not offer model {model} for this account. Choose Model default or an available model ID."));
    }
    Ok(request(
        105,
        "session/set_config_option",
        json!({"sessionId":session_id,"configId":config,"value":model}),
    ))
}
pub fn approval(frame: &Value, allow: bool) -> Result<Value, String> {
    if frame["method"] != "session/request_permission" {
        return Err("Unsupported ACP interaction".into());
    }
    let kind = if allow { "allow_once" } else { "reject_once" };
    let option = frame["params"]["options"]
        .as_array()
        .and_then(|opts| opts.iter().find(|o| o["kind"] == kind))
        .and_then(|o| o["optionId"].as_str());
    let outcome = match option {
        Some(id) => json!({"outcome":"selected","optionId":id}),
        None if !allow => json!({"outcome":"cancelled"}),
        None => {
            return Err("Agent did not offer a one-time approval. Decline this request.".into())
        }
    };
    Ok(json!({"jsonrpc":"2.0","id":frame["id"],"result":{"outcome":outcome}}))
}
// Verify cached Antigravity access with session/new, never authenticate or prompt.
// Authentication required is an error response, so this cannot start browser login.
pub fn verify_cached(mut cmd: Command, _provider: &str) -> Result<bool, String> {
    cmd.arg("acp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let cwd = std::env::temp_dir().to_string_lossy().into_owned();
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().ok_or("No agent input")?;
    let (tx, rx) = mpsc::channel();
    let output = child.stdout.take().unwrap();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let result = (|| {
        writeln!(input, "{}", initialize()).map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let line = rx
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .map_err(|_| {
                    "CLI connection check timed out. Sign in in the official CLI first."
                })?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if !v["error"].is_null() {
                if v["error"]["code"] == -32000 {
                    return Ok(false);
                }
                return Err(
                    "CLI could not verify cached access. Sign in in Terminal first.".into(),
                );
            }
            if v["id"] == 101 {
                if v["result"]["protocolVersion"] != 1 {
                    return Err("Update this CLI for ACP v1 support.".into());
                }
                writeln!(input, "{}", session(&cwd, None, &v["result"])?)
                    .map_err(|e| e.to_string())?;
                input.flush().map_err(|e| e.to_string())?;
            }
            if v["id"] == 103 {
                return Ok(v["result"]["sessionId"]
                    .as_str()
                    .is_some_and(|id| !id.is_empty()));
            }
        }
    })();
    crate::runtime::terminate(&mut child);
    result
}

// Grok's cached_token handshake verifies credentials without starting a model turn.
pub fn verify_grok(mut cmd: Command) -> Result<bool, String> {
    cmd.args(["agent", "--no-leader", "stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().ok_or("No agent input")?;
    let output = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for l in BufReader::new(output).lines().map_while(Result::ok) {
            if tx.send(l).is_err() {
                break;
            }
        }
    });
    let result = (|| {
        writeln!(input, "{}", initialize()).map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let line = rx
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .map_err(|_| "Grok sign-in check timed out")?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if !v["error"].is_null() {
                return Ok(false);
            }
            if v["id"] == 101 {
                writeln!(input, "{}", authenticate(&v["result"], "grok")?)
                    .map_err(|e| e.to_string())?;
                input.flush().map_err(|e| e.to_string())?;
            }
            if v["id"] == 102 {
                return Ok(true);
            }
        }
    })();
    crate::runtime::terminate(&mut child);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn antigravity_checks_cached_session_without_login_or_model_turn() {
        for signed_in in [true, false] {
            let mut cmd = Command::new("python3");
            cmd.args(["-c", r#"
import sys,json
for line in sys.stdin:
 v=json.loads(line)
 if v['method']=='initialize':
  print(json.dumps({'id':101,'result':{'protocolVersion':1}}),flush=True)
 elif v['method']=='session/new':
  result={'id':103,'result':{'sessionId':'checked'}} if sys.argv[1]=='true' else {'id':103,'error':{'code':-32000,'message':'Authentication required'}}
  print(json.dumps(result),flush=True)
 else: raise RuntimeError('Must never authenticate or send a model prompt')
"#, if signed_in { "true" } else { "false" }]);
            assert_eq!(verify_cached(cmd, "antigravity").unwrap(), signed_in);
        }
    }
    #[test]
    fn resume_and_approval_fail_closed() {
        assert!(session("/tmp", Some("old"), &json!({})).is_err());
        assert_eq!(
            session(
                "/tmp",
                Some("old"),
                &json!({"agentCapabilities":{"loadSession":true}})
            )
            .unwrap()["params"]["sessionId"],
            "old"
        );
        let frame = json!({"id":9,"method":"session/request_permission","params":{"options":[{"kind":"allow_always","optionId":"unsafe"}]}});
        assert!(approval(&frame, true).is_err());
        assert_eq!(
            approval(&frame, false).unwrap()["result"]["outcome"]["outcome"],
            "cancelled"
        );
    }
}
