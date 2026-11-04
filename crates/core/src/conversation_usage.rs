use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConversationUsage {
    pub context_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
}
// Use the last request, never cumulative billing totals, for context occupancy.
pub fn codex(params: &Value, thread: &str) -> Option<ConversationUsage> {
    if params["threadId"].as_str()? != thread {
        return None;
    }
    let usage = &params["tokenUsage"];
    let last = &usage["last"];
    if !last.is_object() {
        return None;
    }
    Some(ConversationUsage {
        context_tokens: last["totalTokens"].as_u64(),
        context_window: usage["modelContextWindow"].as_u64().filter(|n| *n > 0),
        input_tokens: last["inputTokens"].as_u64(),
        cached_input_tokens: last["cachedInputTokens"].as_u64(),
    })
}
pub fn claude(message: &Value) -> Option<ConversationUsage> {
    let usage = &message["usage"];
    if !usage.is_object() {
        return None;
    }
    let input = usage["input_tokens"].as_u64();
    let cached = usage["cache_read_input_tokens"].as_u64();
    let creation = usage["cache_creation_input_tokens"].as_u64();
    // Claude input_tokens excludes cache reads and writes. Do not assume absent fields are zero.
    let total_input = input
        .zip(cached)
        .zip(creation)
        .and_then(|((i, c), w)| i.checked_add(c)?.checked_add(w));
    Some(ConversationUsage {
        context_tokens: total_input.and_then(|i| i.checked_add(usage["output_tokens"].as_u64()?)),
        context_window: None,
        input_tokens: total_input,
        cached_input_tokens: cached,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn codex_uses_latest_request_and_scopes_thread() {
        let p = json!({"threadId":"t","tokenUsage":{"last":{"totalTokens":400,"inputTokens":350,"cachedInputTokens":300},"total":{"totalTokens":999999},"modelContextWindow":1000}});
        let u = codex(&p, "t").unwrap();
        assert_eq!(u.context_tokens, Some(400));
        assert_eq!(u.context_window, Some(1000));
        assert_eq!(u.cached_input_tokens, Some(300));
        assert!(codex(&p, "other").is_none());
        let compacted = json!({"threadId":"t","tokenUsage":{"last":{"totalTokens":50,"cachedInputTokens":0},"modelContextWindow":null}});
        let u = codex(&compacted, "t").unwrap();
        assert_eq!(u.context_tokens, Some(50));
        assert_eq!(u.context_window, None);
        assert_eq!(u.cached_input_tokens, Some(0));
    }
    #[test]
    fn missing_usage_is_unknown_and_claude_cache_is_not_double_counted() {
        assert!(codex(&json!({"threadId":"t"}), "t").is_none());
        assert!(claude(&json!({})).is_none());
        let u = claude(&json!({"usage":{"input_tokens":20,"cache_read_input_tokens":80,"cache_creation_input_tokens":10,"output_tokens":5}})).unwrap();
        assert_eq!(u.input_tokens, Some(110));
        assert_eq!(u.context_tokens, Some(115));
        assert_eq!(u.context_window, None);
        assert_eq!(
            claude(&json!({"usage":{"input_tokens":20}}))
                .unwrap()
                .cached_input_tokens,
            None
        );
    }
}
