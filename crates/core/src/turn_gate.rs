//! Decides whether a Claude `result` stream event belongs to the user's prompt.
//!
//! On resume the CLI can inject its own turns (for example a `<task-notification>` for a background
//! shell that died with the previous session) and emit a `result` for them. That result must not end
//! the user's turn. A result is only trusted once the prompt was sent and some assistant output
//! (text or a tool call) was seen for it.
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Not ours (or too early): keep reading. Carries the reason for the log.
    Ignore(&'static str),
    /// Settle the turn normally.
    Finish,
    /// A second result with no output for the prompt: fail loudly, never an empty `done`.
    FinishEmpty,
}

#[derive(Default)]
pub(crate) struct ResultGate {
    prompt_sent: bool,
    output: bool,
    placeholder: bool,
    ignored: u32,
    ignored_at: Option<Instant>,
}

impl ResultGate {
    /// The user prompt (or a steering message) was written to the CLI.
    pub(crate) fn prompt_sent(&mut self) {
        self.prompt_sent = true;
        self.output = false;
        self.placeholder = false;
        self.ignored = 0;
        self.ignored_at = None;
    }
    pub(crate) fn has_output(&self) -> bool {
        self.output
    }
    /// The CLI substituted its "No response requested." text for an empty model reply.
    pub(crate) fn placeholder_seen(&self) -> bool {
        self.placeholder
    }
    pub(crate) fn ignored(&self) -> u32 {
        self.ignored
    }
    /// Record assistant text or tool calls produced for the current prompt.
    pub(crate) fn observe(&mut self, v: &Value) {
        if !self.prompt_sent {
            return;
        }
        let real = match v["type"].as_str() {
            Some("assistant") => v["message"]["content"].as_array().is_some_and(|b| {
                if b.iter().any(|b| b["type"] == "text" && is_placeholder(b["text"].as_str().unwrap_or(""))) {
                    self.placeholder = true;
                }
                b.iter().any(|b| {
                    b["type"] == "tool_use"
                        || (b["type"] == "text" && !is_empty_text(b["text"].as_str().unwrap_or("")))
                })
            }),
            Some("stream_event") => {
                let e = &v["event"];
                (e["type"] == "content_block_start"
                    && matches!(e["content_block"]["type"].as_str(), Some("text" | "tool_use")))
                    || (e["type"] == "content_block_delta"
                        && matches!(
                            e["delta"]["type"].as_str(),
                            Some("text_delta" | "input_json_delta")
                        ))
            }
            _ => false,
        };
        if real {
            self.output = true;
            self.ignored_at = None;
        }
    }
    /// Classify a `result`. `pending` is the background-task count (those are handled by the tracker).
    pub(crate) fn on_result(&mut self, v: &Value, is_error: bool, pending: usize, now: Instant) -> Verdict {
        if is_error {
            return Verdict::Finish;
        }
        if !self.prompt_sent {
            self.ignored += 1;
            return Verdict::Ignore("before_prompt_sent");
        }
        // Slash commands answer with a result string and no assistant events.
        let answered = self.output || v["result"].as_str().is_some_and(|t| !is_empty_text(t));
        if answered || pending > 0 {
            return Verdict::Finish;
        }
        self.ignored += 1;
        if self.ignored == 1 {
            self.ignored_at = Some(now);
            Verdict::Ignore("no_output_for_prompt")
        } else {
            Verdict::FinishEmpty
        }
    }
    /// An empty result was ignored and nothing followed it for `grace`.
    pub(crate) fn overdue(&self, grace: Duration, now: Instant) -> bool {
        self.ignored_at.is_some_and(|t| now.duration_since(t) > grace)
    }
}

/// Literal text the Claude CLI writes when the model returns an empty reply.
const NO_RESPONSE_PLACEHOLDER: &str = "No response requested.";

fn is_placeholder(t: &str) -> bool {
    t.trim() == NO_RESPONSE_PLACEHOLDER
}

fn is_empty_text(t: &str) -> bool {
    t.trim().is_empty() || is_placeholder(t)
}

pub(crate) const EMPTY_TURN_ERROR: &str = "The agent finished without producing any output for your message. It may have been interrupted by a resumed background task. Send the message again.";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn result(text: &str) -> Value {
        json!({"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":text})
    }
    fn text() -> Value {
        json!({"type":"assistant","message":{"id":"m","content":[{"type":"text","text":"hi"}]}})
    }

    #[test]
    fn resume_notification_result_does_not_end_user_turn() {
        let now = Instant::now();
        let mut g = ResultGate::default();
        // Synthetic notification turn finishes before the prompt is written.
        assert_eq!(g.on_result(&result(""), false, 0, now), Verdict::Ignore("before_prompt_sent"));
        g.prompt_sent();
        // ...or right after it, with no output for the prompt.
        assert_eq!(g.on_result(&result(""), false, 0, now), Verdict::Ignore("no_output_for_prompt"));
        // Real answer then real result.
        g.observe(&text());
        assert!(g.has_output());
        assert_eq!(g.on_result(&result("hi"), false, 0, now), Verdict::Finish);
    }

    #[test]
    fn empty_results_become_an_error_not_done() {
        let now = Instant::now();
        let mut g = ResultGate::default();
        g.prompt_sent();
        assert_eq!(g.on_result(&result(""), false, 0, now), Verdict::Ignore("no_output_for_prompt"));
        assert!(!g.overdue(Duration::from_secs(30), now));
        assert!(g.overdue(Duration::from_secs(30), now + Duration::from_secs(31)));
        assert_eq!(g.on_result(&result(""), false, 0, now), Verdict::FinishEmpty);
    }

    #[test]
    fn normal_tool_slash_error_and_background_turns_still_finish() {
        let now = Instant::now();
        let mut g = ResultGate::default();
        g.prompt_sent();
        g.observe(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t","name":"Bash","input":{}}]}}));
        assert_eq!(g.on_result(&result(""), false, 0, now), Verdict::Finish);
        let mut g = ResultGate::default();
        g.prompt_sent();
        assert_eq!(g.on_result(&result("Cost: $0"), false, 0, now), Verdict::Finish);
        let mut g = ResultGate::default();
        assert_eq!(g.on_result(&result(""), true, 0, now), Verdict::Finish);
        // Background tasks pending: the tracker decides (Hold), the gate must not swallow it.
        let mut g = ResultGate::default();
        g.prompt_sent();
        assert_eq!(g.on_result(&result(""), false, 2, now), Verdict::Finish);
        // Thinking-only deltas are not output.
        g.prompt_sent();
        g.observe(&json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}}));
        assert!(!g.has_output());
        g.observe(&json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}}));
        assert!(g.has_output());
    }

    #[test]
    fn cli_no_response_placeholder_is_empty() {
        let now = Instant::now();
        let mut g = ResultGate::default();
        g.prompt_sent();
        g.observe(&json!({"type":"assistant","message":{"content":[{"type":"text","text":" No response requested.\n"}]}}));
        assert!(!g.has_output());
        assert!(g.placeholder_seen());
        assert_eq!(g.on_result(&result("No response requested."), false, 0, now), Verdict::Ignore("no_output_for_prompt"));
        assert_eq!(g.on_result(&result("No response requested."), false, 0, now), Verdict::FinishEmpty);
        // Real text that merely contains the phrase still counts.
        let mut g = ResultGate::default();
        g.prompt_sent();
        g.observe(&json!({"type":"assistant","message":{"content":[{"type":"text","text":"No response requested. Done."}]}}));
        assert!(g.has_output());
        assert!(!g.placeholder_seen());
    }
}
