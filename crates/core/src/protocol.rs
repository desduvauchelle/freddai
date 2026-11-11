use crate::runtime::PermissionMode;
use serde_json::{json, Value};

pub fn codex_start(cwd: &str, resume: Option<&str>, mode: PermissionMode) -> Value {
    let mut params = json!({"cwd":cwd,"approvalPolicy":"on-request","sandbox":"workspace-write"});
    if mode == PermissionMode::Bypass {
        params["approvalPolicy"] = json!("never");
        params["sandbox"] = json!("danger-full-access");
    }
    let method = if let Some(id) = resume {
        params["threadId"] = json!(id);
        "thread/resume"
    } else {
        "thread/start"
    };
    json!({"id":2,"method":method,"params":params})
}
pub fn user_message(provider: &str, text: &str, session: &str) -> Value {
    if provider == "codex" {
        json!({"id":3,"method":"turn/start","params":{"threadId":session,"input":[{"type":"text","text":text}]}})
    } else {
        json!({"type":"user","session_id":session,"message":{"role":"user","content":text},"parent_tool_use_id":null})
    }
}
// Unknown requests fail closed. Only explicit, one-request decisions are supported.
pub fn approval_response(
    provider: &str,
    frame: &Value,
    allow: bool,
    answers: &Value,
) -> Result<Value, String> {
    if matches!(
        provider,
        "gemini" | "antigravity" | "grok" | "opencode" | "cursor" | "copilot"
    ) {
        return crate::acp::approval(frame, allow);
    }
    if provider == "codex" {
        let method = frame["method"].as_str().unwrap_or("");
        let result = match method {
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                json!({"decision":if allow {"accept"} else {"decline"}})
            }
            "mcpServer/elicitation/request" => {
                if allow {
                    json!({"action":"accept","content":answers})
                } else {
                    json!({"action":"decline"})
                }
            }
            "item/tool/requestUserInput" => json!({"answers":answers}),
            _ => return Err(format!("Unsupported Codex request: {method}")),
        };
        Ok(json!({"id":frame["id"],"result":result}))
    } else {
        if frame["request"]["subtype"] != "can_use_tool" {
            return Err("Unsupported Claude request".into());
        }
        let mut input = frame["request"]["input"].clone();
        if frame["request"]["tool_name"] == "AskUserQuestion" {
            input["answers"] = answers.clone();
        }
        let decision = if allow {
            json!({"behavior":"allow","updatedInput":input})
        } else {
            json!({"behavior":"deny","message":"User declined this request."})
        };
        Ok(
            json!({"type":"control_response","response":{"subtype":"success","request_id":frame["request_id"],"response":decision}}),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resume_stays_on_exact_session() {
        let v = codex_start("/project", Some("thread-a"), PermissionMode::Ask);
        assert_eq!(v["method"], "thread/resume");
        assert_eq!(v["params"]["threadId"], "thread-a");
        assert_eq!(v["params"]["sandbox"], "workspace-write");
    }
    #[test]
    fn bypass_applies_on_start_and_exact_resume() {
        for resume in [None, Some("existing")] {
            let v = codex_start("/project", resume, PermissionMode::Bypass);
            assert_eq!(v["params"]["approvalPolicy"], "never");
            assert_eq!(v["params"]["sandbox"], "danger-full-access");
            if resume.is_some() {
                assert_eq!(v["params"]["threadId"], "existing");
            }
        }
    }
    #[test]
    fn permission_modes_are_explicit_and_legacy_options_stay_unchanged() {
        use crate::runtime::LaunchOptions;
        let legacy: LaunchOptions = serde_json::from_value(json!({})).unwrap();
        assert_eq!(legacy.permission_mode, None);
        assert_eq!(
            legacy.permission_mode.unwrap_or_default().claude_mode(),
            "default"
        );
        let bypass: LaunchOptions =
            serde_json::from_value(json!({"permission_mode":"bypass"})).unwrap();
        assert_eq!(
            bypass.permission_mode.unwrap().claude_mode(),
            "bypassPermissions"
        );
        assert!(
            serde_json::from_value::<LaunchOptions>(json!({"permission_mode":"anything"})).is_err()
        );
    }
    #[test]
    fn unknown_approval_is_not_allowed() {
        assert!(approval_response(
            "codex",
            &json!({"id":4,"method":"newPermission"}),
            true,
            &json!({})
        )
        .is_err());
    }
    #[test]
    fn denial_is_scoped_to_request() {
        let r = approval_response(
            "codex",
            &json!({"id":42,"method":"item/fileChange/requestApproval"}),
            false,
            &json!({}),
        )
        .unwrap();
        assert_eq!(r, json!({"id":42,"result":{"decision":"decline"}}));
    }
    #[test]
    fn mcp_elicitation_reaches_pending_and_returns_scoped_decisions() {
        let frame = json!({"id":"mcp-42","method":"mcpServer/elicitation/request",
            "params":{"serverName":"Freddai","mode":"form","message":"Approve task?",
                "requestedSchema":{"type":"object","properties":{}}}});
        let denied = approval_response("codex", &frame, false, &json!({})).unwrap();
        assert_eq!(denied, json!({"id":"mcp-42","result":{"action":"decline"}}));
        let accepted = approval_response("codex", &frame, true, &json!({"approved":true})).unwrap();
        assert_eq!(accepted, json!({"id":"mcp-42","result":{"action":"accept","content":{"approved":true}}}));
    }
    #[test]
    fn claude_preserves_tool_input() {
        let r=approval_response("claude",&json!({"request_id":"r","request":{"subtype":"can_use_tool","input":{"file_path":"/x"}}}),true,&json!({})).unwrap();
        assert_eq!(r["response"]["response"]["updatedInput"]["file_path"], "/x");
    }
}
