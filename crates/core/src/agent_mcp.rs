//! A single server list translated to each harness's session-local transport.
use serde_json::{json, Value};
use std::{path::Path, process::Command};

pub(crate) fn servers(root: &Path, project: &str, thread: &str) -> Vec<Value> {
    let Ok(exe) = std::env::current_exe() else {
        return Vec::new();
    };
    let mut servers =
        vec![json!({"name":"freddai","command":exe,"args":["--mcp",root,project,thread],"env":[]})];
    if let Some(helper) = crate::computer_use::helper(&exe) {
        servers.push(json!({"name":"freddai_computer","command":helper,"args":[],"env":[]}));
    }
    servers
}
pub(crate) fn configure(
    cmd: &mut Command,
    provider: &str,
    root: &Path,
    project: &str,
    thread: &str,
) {
    // Changing the bundled helper must also invalidate detached host caches.
    cmd.env("FREDDAI_COMPUTER_BUILD", crate::computer_use::fingerprint());
    add_args(cmd, provider, &servers(root, project, thread));
}
fn add_args(cmd: &mut Command, provider: &str, servers: &[Value]) {
    match provider {
        "codex" => {
            for server in servers {
                let name = server["name"].as_str().unwrap();
                for key in ["command", "args"] {
                    cmd.arg("-c")
                        .arg(format!("mcp_servers.{name}.{key}={}", server[key]));
                }
                cmd.arg("-c")
                    .arg(format!("mcp_servers.{name}.enabled=true"));
            }
        }
        "claude" => {
            let configs: serde_json::Map<String, Value> = servers
                .iter()
                .map(|s| {
                    (
                        s["name"].as_str().unwrap().into(),
                        json!({"command":s["command"],"args":s["args"]}),
                    )
                })
                .collect();
            cmd.arg("--mcp-config")
                .arg(json!({"mcpServers":configs}).to_string());
        }
        // ACP receives this exact list in session/new AND session/load, not CLI flags.
        _ => {}
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_harnesses_receive_the_same_session_scoped_server_list() {
        let list = vec![
            json!({"name":"freddai","command":"/Apps/odd \" name.app/native","args":["--mcp","/workspace with spaces","p","thread"],"env":[]}),
        ];
        for provider in [
            "codex",
            "claude",
            "gemini",
            "antigravity",
            "grok",
            "opencode",
            "cursor",
        ] {
            let mut cmd = Command::new("unused");
            cmd.arg("existing");
            add_args(&mut cmd, provider, &list);
            let args: Vec<_> = cmd.get_args().map(|a| a.to_str().unwrap()).collect();
            assert_eq!(args[0], "existing");
            if provider == "codex" {
                let mut combined = String::new();
                for pair in args[1..].chunks(2) {
                    assert_eq!(pair[0], "-c");
                    combined.push_str(pair[1]);
                    combined.push('\n');
                }
                let doc: toml_edit::DocumentMut = combined.parse().unwrap();
                assert_eq!(
                    doc["mcp_servers"]["freddai"]["command"].as_str(),
                    list[0]["command"].as_str()
                );
                assert_eq!(
                    doc["mcp_servers"]["freddai"]["args"]
                        .as_array()
                        .unwrap()
                        .len(),
                    4
                );
            } else if provider == "claude" {
                let v: Value = serde_json::from_str(args[2]).unwrap();
                assert_eq!(v["mcpServers"]["freddai"]["args"], list[0]["args"]);
            } else {
                assert_eq!(args.len(), 1);
                for resume in [None, Some("existing-thread")] {
                    let v = crate::acp::session_with_mcp(
                        "/cwd",
                        resume,
                        &json!({"agentCapabilities":{"loadSession":true}}),
                        list.clone(),
                    )
                    .unwrap();
                    assert_eq!(v["params"]["mcpServers"], json!(list));
                    assert_eq!(
                        v["method"],
                        if resume.is_some() {
                            "session/load"
                        } else {
                            "session/new"
                        }
                    );
                }
            }
        }
    }
}
