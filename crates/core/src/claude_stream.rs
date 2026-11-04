//! Project Claude partial text onto the same message/block keys as final assistant messages.
use serde_json::Value;

#[derive(Default)]
pub(crate) struct TextStream {
    message: Option<String>,
}

impl TextStream {
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
                if text.is_empty() { return None; }
                Some((format!("{}-{}", self.message.as_ref()?, event["index"].as_u64()?), text.into(), false))
            }
            "content_block_delta" if event["delta"]["type"] == "text_delta" => {
                let text = event["delta"]["text"].as_str()?;
                if text.is_empty() { return None; }
                Some((format!("{}-{}", self.message.as_ref()?, event["index"].as_u64()?), text.into(), true))
            }
            _ => None, // Thinking and partial tool JSON are not assistant text.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn frame(event: Value) -> Value { json!({"type":"stream_event","event":event}) }
    #[test]
    fn preserves_message_and_block_identity_and_ignores_non_text() {
        let mut stream = TextStream::default();
        let delta = frame(json!({"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"tail"}}));
        assert!(stream.accept(&delta).is_none());
        stream.accept(&frame(json!({"type":"message_start","message":{"id":"first"}})));
        assert_eq!(stream.accept(&frame(json!({"type":"content_block_start","index":2,"content_block":{"type":"text","text":"prefix"}}))), Some(("first-2".into(), "prefix".into(), false)));
        assert_eq!(stream.accept(&delta), Some(("first-2".into(), "tail".into(), true)));
        assert!(stream.accept(&frame(json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{"}}))).is_none());
        assert!(stream.accept(&frame(json!({"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"private"}}))).is_none());
        let mut subagent = frame(json!({"type":"message_start","message":{"id":"child"}}));
        subagent["parent_tool_use_id"] = json!("tool");
        stream.accept(&subagent);
        assert_eq!(stream.accept(&delta).unwrap().0, "first-2");
        stream.accept(&frame(json!({"type":"message_stop"})));
        assert!(stream.accept(&delta).is_none());
        stream.accept(&frame(json!({"type":"message_start","message":{"id":"second"}})));
        assert_eq!(stream.accept(&delta).unwrap().0, "second-2");
    }
}
