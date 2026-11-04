//! Project Claude partial text onto the same message/block keys as final assistant messages.
use serde_json::Value;
use std::collections::HashMap;

/// Claude Code emits each content block of one API message as its own `assistant` frame (thinking, then
/// text, then tool_use), all sharing `message.id`. Streaming deltas key blocks by their index in the whole
/// message, so a final frame must be keyed the same way or the text appears twice (`id-1` streamed, `id-0` final).
#[derive(Default)]
pub(crate) struct BlockIndex(HashMap<String, usize>);

impl BlockIndex {
    /// Message-level block indexes for the `count` blocks carried by this frame.
    pub(crate) fn indexes(&mut self, message_id: &str, count: usize) -> std::ops::Range<usize> {
        let seen = self.0.entry(message_id.to_owned()).or_insert(0);
        // A frame holding several blocks is a complete message; its blocks start at 0.
        let start = if count > 1 { 0 } else { *seen };
        *seen = start + count;
        start..start + count
    }
}

#[derive(Default)]
pub(crate) struct TextStream {
    message: Option<String>,
}

impl TextStream {
    /// Streamed thinking for the current message as `(message-block key, text, append)`. Call after `accept`,
    /// which tracks the current message. The key equals the one final `thinking` blocks use.
    pub(crate) fn accept_thinking(&self, frame: &Value) -> Option<(String, String, bool)> {
        if frame["type"] != "stream_event" || !frame["parent_tool_use_id"].is_null() {
            return None;
        }
        let event = &frame["event"];
        let key = format!("{}-{}", self.message.as_ref()?, event["index"].as_u64()?);
        match event["type"].as_str()? {
            "content_block_start" if event["content_block"]["type"] == "thinking" => {
                let text = event["content_block"]["thinking"].as_str().unwrap_or("");
                Some((key, text.into(), false))
            }
            "content_block_delta" if event["delta"]["type"] == "thinking_delta" => {
                let text = event["delta"]["thinking"].as_str()?;
                if text.is_empty() {
                    return None;
                }
                Some((key, text.into(), true))
            }
            _ => None,
        }
    }
    pub(crate) fn accept(&mut self, frame: &Value) -> Option<(String, String, bool)> {
        if frame["type"] != "stream_event" || !frame["parent_tool_use_id"].is_null() {
            return None;
        }
        let event = &frame["event"];
        match event["type"].as_str()? {
            "message_start" => {
                self.message = event["message"]["id"].as_str().map(str::to_owned);
                None
            }
            "message_stop" => {
                self.message = None;
                None
            }
            "content_block_start" if event["content_block"]["type"] == "text" => {
                let text = event["content_block"]["text"].as_str()?;
                if text.is_empty() {
                    return None;
                }
                Some((
                    format!("{}-{}", self.message.as_ref()?, event["index"].as_u64()?),
                    text.into(),
                    false,
                ))
            }
            "content_block_delta" if event["delta"]["type"] == "text_delta" => {
                let text = event["delta"]["text"].as_str()?;
                if text.is_empty() {
                    return None;
                }
                Some((
                    format!("{}-{}", self.message.as_ref()?, event["index"].as_u64()?),
                    text.into(),
                    true,
                ))
            }
            _ => None, // Thinking and partial tool JSON are not assistant text.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn split_assistant_frames_share_block_keys_with_streamed_text() {
        let mut blocks = BlockIndex::default();
        assert_eq!(blocks.indexes("m", 1), 0..1); // thinking frame
        assert_eq!(blocks.indexes("m", 1), 1..2); // text frame: same key the stream used ("m-1")
        assert_eq!(blocks.indexes("m", 1), 2..3); // tool_use frame no longer collides with the text
        assert_eq!(blocks.indexes("n", 1), 0..1);
        assert_eq!(blocks.indexes("whole", 3), 0..3); // single-frame messages keep their positions
        let mut stream = TextStream::default();
        stream.accept(
            &json!({"type":"stream_event","event":{"type":"message_start","message":{"id":"m"}}}),
        );
        let streamed = stream.accept(&json!({"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":"hi"}}})).unwrap().0;
        assert_eq!(streamed, format!("m-{}", 1));
    }
    fn frame(event: Value) -> Value {
        json!({"type":"stream_event","event":event})
    }
    #[test]
    fn preserves_message_and_block_identity_and_ignores_non_text() {
        let mut stream = TextStream::default();
        let delta = frame(
            json!({"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"tail"}}),
        );
        assert!(stream.accept(&delta).is_none());
        stream.accept(&frame(
            json!({"type":"message_start","message":{"id":"first"}}),
        ));
        assert_eq!(stream.accept(&frame(json!({"type":"content_block_start","index":2,"content_block":{"type":"text","text":"prefix"}}))), Some(("first-2".into(), "prefix".into(), false)));
        assert_eq!(
            stream.accept(&delta),
            Some(("first-2".into(), "tail".into(), true))
        );
        assert!(stream.accept(&frame(json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{"}}))).is_none());
        assert!(stream.accept(&frame(json!({"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"private"}}))).is_none());
        let mut subagent = frame(json!({"type":"message_start","message":{"id":"child"}}));
        subagent["parent_tool_use_id"] = json!("tool");
        stream.accept(&subagent);
        assert_eq!(stream.accept(&delta).unwrap().0, "first-2");
        stream.accept(&frame(json!({"type":"message_stop"})));
        assert!(stream.accept(&delta).is_none());
        stream.accept(&frame(
            json!({"type":"message_start","message":{"id":"second"}}),
        ));
        assert_eq!(stream.accept(&delta).unwrap().0, "second-2");
    }
    #[test]
    fn streams_thinking_under_the_block_key_final_frames_use() {
        let mut stream = TextStream::default();
        let start = frame(json!({"type":"message_start","message":{"id":"m"}}));
        stream.accept(&start);
        let begin = frame(
            json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}),
        );
        assert!(stream.accept(&begin).is_none());
        assert_eq!(
            stream.accept_thinking(&begin),
            Some(("m-0".into(), "".into(), false))
        );
        let delta = frame(
            json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm"}}),
        );
        assert!(stream.accept(&delta).is_none());
        assert_eq!(
            stream.accept_thinking(&delta),
            Some(("m-0".into(), "Hmm".into(), true))
        );
        let text = frame(
            json!({"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"x"}}),
        );
        assert!(stream.accept_thinking(&text).is_none());
        let mut nested = delta.clone();
        nested["parent_tool_use_id"] = json!("tool");
        assert!(stream.accept_thinking(&nested).is_none());
    }
}
