//! Agent reasoning ("thinking") text and todo/plan lists, normalised across providers.
//!
//! Reasoning is stored as transcript messages with role `reasoning`. It is persisted like any message, so it is
//! capped at [`MAX_REASONING_CHARS`] per block to keep the workspace database and snapshots small.
//! Todo lists are stored as `tool` messages holding Claude's own `TodoWrite` tool_use shape, so the UI parses one
//! format: `{"type":"tool_use","name":"TodoWrite","input":{"todos":[{content,status,activeForm}]}}`.
use serde_json::{json, Value};

pub(crate) const MAX_REASONING_CHARS: usize = 20_000;
const TRUNCATED: &str = "\n… (thinking truncated)";

/// Replace or append `delta`, keeping at most [`MAX_REASONING_CHARS`] characters plus a truncation marker.
pub(crate) fn merge(text: &mut String, delta: &str, append: bool) {
    if !append {
        text.clear();
    }
    if text.ends_with(TRUNCATED) {
        return;
    }
    text.push_str(delta);
    if text.chars().count() > MAX_REASONING_CHARS {
        let cut = text
            .char_indices()
            .nth(MAX_REASONING_CHARS)
            .map_or(text.len(), |(i, _)| i);
        text.truncate(cut);
        text.push_str(TRUNCATED);
    }
}

/// Codex `reasoning` item: summary parts when present, else raw content parts.
pub(crate) fn codex_reasoning(item: &Value) -> String {
    let join = |v: &Value| {
        v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n\n")
            })
            .unwrap_or_default()
    };
    let summary = join(&item["summary"]);
    if summary.is_empty() {
        join(&item["content"])
    } else {
        summary
    }
}

fn normalise(status: &str) -> &'static str {
    match status {
        "completed" | "complete" | "done" => "completed",
        "in_progress" | "inProgress" | "active" => "in_progress",
        _ => "pending",
    }
}

fn todo_message(todos: Vec<Value>) -> Option<String> {
    if todos.is_empty() {
        return None;
    }
    serde_json::to_string_pretty(
        &json!({"type":"tool_use","name":"TodoWrite","input":{"todos":todos}}),
    )
    .ok()
}

/// Codex `turn/plan/updated`: `plan: [{step, status}]`.
pub(crate) fn codex_plan(params: &Value) -> Option<String> {
    todo_message(params["plan"].as_array()?.iter().filter_map(|p| {
        let step = p["step"].as_str()?;
        Some(json!({"content":step,"status":normalise(p["status"].as_str().unwrap_or("")),"activeForm":step}))
    }).collect())
}

/// ACP `plan` session update: `entries: [{content, priority, status}]`.
pub(crate) fn acp_plan(update: &Value) -> Option<String> {
    todo_message(update["entries"].as_array()?.iter().filter_map(|e| {
        let content = e["content"].as_str()?;
        Some(json!({"content":content,"status":normalise(e["status"].as_str().unwrap_or("")),"activeForm":content}))
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_appends_replaces_and_caps() {
        let mut t = String::new();
        merge(&mut t, "a", true);
        merge(&mut t, "b", true);
        assert_eq!(t, "ab");
        merge(&mut t, "z", false);
        assert_eq!(t, "z");
        merge(&mut t, &"x".repeat(MAX_REASONING_CHARS + 50), true);
        assert!(t.ends_with(TRUNCATED));
        assert_eq!(
            t.chars().count(),
            MAX_REASONING_CHARS + TRUNCATED.chars().count()
        );
        let before = t.clone();
        merge(&mut t, "more", true);
        assert_eq!(t, before);
    }

    #[test]
    fn codex_reasoning_prefers_summary_then_content() {
        assert_eq!(
            codex_reasoning(&json!({"type":"reasoning","summary":["One","Two"],"content":["raw"]})),
            "One\n\nTwo"
        );
        assert_eq!(
            codex_reasoning(&json!({"type":"reasoning","summary":[],"content":["raw"]})),
            "raw"
        );
        assert_eq!(codex_reasoning(&json!({"type":"reasoning"})), "");
    }

    #[test]
    fn codex_plan_becomes_todowrite_shape() {
        let text = codex_plan(&json!({"plan":[{"step":"Read","status":"completed"},{"step":"Edit","status":"inProgress"},{"step":"Test","status":"pending"}]})).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["name"], "TodoWrite");
        let todos = &v["input"]["todos"];
        assert_eq!(todos[0]["status"], "completed");
        assert_eq!(todos[1]["status"], "in_progress");
        assert_eq!(todos[1]["activeForm"], "Edit");
        assert_eq!(todos[2]["status"], "pending");
        assert!(codex_plan(&json!({"plan":[]})).is_none());
    }

    #[test]
    fn acp_plan_becomes_todowrite_shape() {
        let text = acp_plan(&json!({"sessionUpdate":"plan","entries":[{"content":"Look","priority":"high","status":"in_progress"},{"content":"Fix","priority":"low","status":"pending"}]})).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["input"]["todos"][0]["status"], "in_progress");
        assert_eq!(v["input"]["todos"][1]["content"], "Fix");
        assert!(acp_plan(&json!({"sessionUpdate":"plan"})).is_none());
    }
}
