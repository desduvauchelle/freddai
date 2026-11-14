//! Lightweight desktop transport; original transcripts remain unchanged in storage.
use crate::runtime::Session;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const INLINE_TOOL_BYTES: usize = 4096;
pub const TOOL_PAGE_BYTES: usize = 64 * 1024;

pub fn text_hash(text: &str) -> String { format!("{:x}", Sha256::digest(text.as_bytes())) }

fn preview(text: &str) -> String {
    // Preserve task-list and sub-agent placement metadata without shipping command output,
    // screenshots, or nested MCP results. These details remain available through tool_text.
    let Ok(value) = serde_json::from_str::<Value>(text) else { return String::new() };
    let mut metadata = serde_json::Map::new();
    for key in ["type", "id", "name", "status"] {
        if let Some(v) = value.get(key).filter(|v| v.as_str().is_some_and(|s| s.len() <= 256)) {
            metadata.insert(key.into(), v.clone());
        }
    }
    if value["type"] == "tool_use" && value["name"] == "TodoWrite" && value["input"]["todos"].is_array() {
        metadata.insert("input".into(), json!({"todos":value["input"]["todos"]}));
    }
    Value::Object(metadata).to_string()
}

/// Compact before serializing: never create a JSON copy of the large original text.
pub fn session_value(mut session: Session, loaded: bool) -> Value {
    let mut details = std::collections::HashMap::new();
    if !loaded { session.messages.retain(|m| m.role != "tool" && m.role != "reasoning"); }
    for message in &mut session.messages {
        if message.role == "tool" && message.text.len() > INLINE_TOOL_BYTES {
            details.insert(message.id.clone(), (message.text.len(), text_hash(&message.text)));
            message.text = preview(&message.text).into();
        }
    }
    let mut value = json!(session);
    value["transcriptLoaded"] = json!(loaded);
    for message in value["messages"].as_array_mut().unwrap() {
        if let Some((bytes, hash)) = message["id"].as_str().and_then(|id| details.get(id)) {
            message["toolTextBytes"] = json!(bytes);
            message["toolTextHash"] = json!(hash);
        }
    }
    value
}

/// Stable message-ID cursors keep older pages intact while new messages arrive.
pub fn history_page(session: &Session, before: Option<&str>) -> Result<Value, String> {
    let end = match before {
        Some(id) => session.messages.iter().position(|m| m.id == id).ok_or("History cursor is no longer available. Reopen the thread.")?,
        None => session.messages.len(),
    };
    let start = end.saturating_sub(60);
    let mut messages = Vec::new();
    for message in &session.messages[start..end] {
        let mut copy = message.clone();
        let details = if copy.role == "tool" {
            let details = (copy.text.len(), text_hash(&copy.text));
            copy.text = preview(&copy.text).into();
            Some(details)
        } else { None };
        let mut value = json!(copy);
        if let Some((bytes, hash)) = details {
            value["toolTextBytes"] = json!(bytes);
            value["toolTextHash"] = json!(hash);
        }
        messages.push(value);
    }
    Ok(json!({"messages":messages,"before":if start > 0 {Some(&session.messages[start].id)} else {None}}))
}

fn compact_message(message: &mut Value) {
    if message.get("toolTextBytes").is_none() && message["role"] == "tool" && message["text"].as_str().is_some_and(|text| text.len() > INLINE_TOOL_BYTES) {
        let Value::String(text) = message["text"].take() else { return };
        message["text"] = json!(preview(&text));
        message["toolTextBytes"] = json!(text.len());
        message["toolTextHash"] = json!(text_hash(&text));
    }
}

fn project_session(session: &mut Value, open: &[String]) {
    let loaded = session["id"].as_str().is_some_and(|id| open.iter().any(|x| x == id));
    session["transcriptLoaded"] = json!(loaded);
    if let Some(messages) = session["messages"].as_array_mut() {
        if !loaded { messages.retain(|m| m["role"] != "tool" && m["role"] != "reasoning"); }
        for message in messages { compact_message(message); }
    }
}

/// Compatibility projection for hosts that predate scoped desktop snapshots.
/// Old hosts receive messageDeltas=false, so each changed session is complete here.
pub fn project_legacy(value: &mut Value, open: &[String]) {
    if let Some(sessions) = value["sessions"].as_array_mut() {
        for session in sessions { project_session(session, open); }
    }
    value["desktopProjection"] = json!(true);
}

/// Decode the old host's response incrementally, releasing each large tool body before reading
/// the next. Peak transport memory depends on one message, not the whole workspace or wire line.
pub fn read_reply(reader: impl std::io::Read, open: &[String]) -> Result<Value, serde_json::Error> {
    use serde::de::DeserializeSeed;
    let mut decoder = serde_json::Deserializer::from_reader(std::io::BufReader::new(reader));
    Projection { level: Level::Envelope, open }.deserialize(&mut decoder)
}

#[derive(Clone, Copy)]
enum Level { Envelope, Database, Session, Message }
struct Projection<'a> { level: Level, open: &'a [String] }
impl<'de> serde::de::DeserializeSeed<'de> for Projection<'_> {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, decoder: D) -> Result<Value, D::Error> {
        decoder.deserialize_map(self)
    }
}
impl<'de> serde::de::Visitor<'de> for Projection<'_> {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("a snapshot object") }
    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut fields: A) -> Result<Value, A::Error> {
        let mut value = serde_json::Map::new();
        while let Some(key) = fields.next_key::<String>()? {
            let next = match (self.level, key.as_str()) {
                (Level::Envelope, "result") => fields.next_value_seed(Projection { level: Level::Database, open: self.open })?,
                (Level::Database, "sessions") => fields.next_value_seed(ProjectionList { level: Level::Session, open: self.open })?,
                (Level::Session, "messages") => fields.next_value_seed(ProjectionList { level: Level::Message, open: self.open })?,
                _ => fields.next_value::<Value>()?,
            };
            value.insert(key, next);
        }
        let mut value = Value::Object(value);
        match self.level {
            Level::Message => compact_message(&mut value),
            Level::Session => project_session(&mut value, self.open),
            Level::Database => value["desktopProjection"] = json!(true),
            Level::Envelope => {},
        }
        Ok(value)
    }
}
struct ProjectionList<'a> { level: Level, open: &'a [String] }
impl<'de> serde::de::DeserializeSeed<'de> for ProjectionList<'_> {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, decoder: D) -> Result<Value, D::Error> { decoder.deserialize_seq(self) }
}
impl<'de> serde::de::Visitor<'de> for ProjectionList<'_> {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("a snapshot array") }
    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut entries: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = entries.next_element_seed(Projection { level: self.level, open: self.open })? { values.push(value); }
        Ok(Value::Array(values))
    }
}

pub fn text_chunk(text: &str, offset: usize, expected_hash: Option<&str>) -> Result<Value, String> {
    let hash = text_hash(text);
    if expected_hash.is_some_and(|expected| expected != hash) {
        return Err("Tool output changed. Reopen its details to read the latest version.".into());
    }
    if offset > text.len() || !text.is_char_boundary(offset) { return Err("Invalid tool output offset".into()); }
    let mut end = offset.saturating_add(TOOL_PAGE_BYTES).min(text.len());
    while !text.is_char_boundary(end) { end -= 1; }
    Ok(json!({"text":&text[offset..end],"offset":offset,"nextOffset":if end < text.len() {Some(end)} else {None},"totalBytes":text.len(),"hash":hash}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streamed_projection_matches_eager_projection_and_preserves_errors() {
        let session = json!({"messages":[{"text":"🦀".repeat(20000),"role":"tool","id":"large"},{"text":"Keep this","role":"user","id":"user"}],"id":"open"});
        let mut db = json!({"sessions":[session.clone(), {"id":"closed","messages":session["messages"]}],"revision":7,"hostId":"host","full":true});
        let wire = json!({"result":db}).to_string();
        project_legacy(&mut db, &["open".into()]);
        let streamed = read_reply(wire.as_bytes(), &["open".into()]).unwrap();
        assert_eq!(streamed["result"], db);
        assert!(streamed.to_string().len() < 2048);
        assert_eq!(read_reply(br#"{"error":"Unknown host command"}"#.as_slice(), &[]).unwrap()["error"], "Unknown host command");
        assert!(read_reply(&wire.as_bytes()[..wire.len()/2], &[]).is_err());
    }

    #[test]
    fn output_pages_are_bounded_lossless_and_reject_stale_versions() {
        let text = "🦀 café\n".repeat(30_000);
        let hash = text_hash(&text);
        let mut offset = 0;
        let mut restored = String::new();
        loop {
            let page = text_chunk(&text, offset, Some(&hash)).unwrap();
            let body = page["text"].as_str().unwrap();
            assert!(body.len() <= TOOL_PAGE_BYTES);
            restored.push_str(body);
            match page["nextOffset"].as_u64() { Some(next) => offset = next as usize, None => break }
        }
        assert_eq!(restored, text);
        assert!(text_chunk(&text, 1, None).is_err());
        assert!(text_chunk(&text, text.len()+1, None).is_err());
        assert!(text_chunk(&text, 0, Some("stale")).is_err());
    }
    #[test]
    fn compact_preview_preserves_task_metadata_without_mcp_output() {
        let raw = json!({"type":"tool_use","id":"agent","name":"Agent","input":{"prompt":"x".repeat(10000)},"result":"x".repeat(10000)}).to_string();
        let p: Value = serde_json::from_str(&preview(&raw)).unwrap();
        assert_eq!(p["id"], "agent");
        assert!(p.get("result").is_none());
        let todo = json!({"type":"tool_use","name":"TodoWrite","input":{"todos":[{"content":"Do it","status":"pending"}]},"result":"x".repeat(10000)});
        let p: Value = serde_json::from_str(&preview(&todo.to_string())).unwrap();
        assert_eq!(p["input"], todo["input"]);
    }
}
