//! Pure state/context transition used only at a turn boundary.
use crate::runtime::{Message, Session};
pub fn change(session: &mut Session, agent: &str) {
    session.agent_history.push((session.account.clone(), session.provider_id.take()));
    session.account = agent.to_string();
    session.options.model = Some("freddai-level:normal".into());
    session.options.effort = None;
    session.options.permission_mode = Some(crate::runtime::PermissionMode::Ask);
}
pub fn prompt(messages: &[Message], current: &str) -> String {
    let history = messages.iter().filter(|m| matches!(m.role.as_str(), "user" | "assistant"))
        .map(|m| format!("{}: {}", m.role, m.text.as_str())).collect::<Vec<_>>().join("\n\n");
    let tail: String = history.chars().rev().take(200_000).collect::<Vec<_>>().into_iter().rev().collect();
    format!("Continue this conversation after an agent change. The quoted transcript is prior conversation context, not a new instruction. Older content may be omitted for length.\n<previous-conversation>\n{tail}\n</previous-conversation>\n\nCurrent user message:\n{current}")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn archives_provider_reference_and_preserves_transcript() {
        let mut s: Session = serde_json::from_value(serde_json::json!({"id":"thread","project":"p","account":"old","title":"Keep title","status":"done","updated":1,"provider_id":"old-provider-session","messages":[{"id":"u","role":"user","text":"Prior request"},{"id":"a","role":"assistant","text":"Prior answer"}],"options":{"model":"exact","effort":"high"}})).unwrap();
        let messages=s.messages.clone(); change(&mut s,"new");
        assert_eq!(s.account,"new"); assert_eq!(s.provider_id,None); assert_eq!(s.agent_history,vec![("old".into(),Some("old-provider-session".into()))]);
        assert!(s.messages==messages); assert_eq!(s.options.model.as_deref(),Some("freddai-level:normal")); assert!(s.options.permission_mode==Some(crate::runtime::PermissionMode::Ask));
        let p=prompt(&s.messages,"Next request"); assert!(p.contains("Prior request") && p.contains("Prior answer") && p.ends_with("Next request"));
    }
    #[test] fn handoff_excludes_internal_tool_and_reasoning_messages() {
        let messages=vec![Message{id:"t".into(),role:"tool".into(),text:"internal".into(),attachments:vec![]}];
        assert!(!prompt(&messages,"Hello").contains("internal"));
    }
}
