//! Import of Claude Code / Codex sessions that were started outside Freddai.
//!
//! Read-only: provider transcript files are never modified. Discovery reads only a bounded header of each
//! file (newest files first); the full transcript is parsed only for sessions the user chose to import.
use crate::runtime::Message;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

/// Newest-first cap on files whose header is parsed per provider home (stat of all files is still cheap).
pub const MAX_FILES_PER_ROOT: usize = 600;
const HEADER_MAX_LINES: usize = 400;
const HEADER_MAX_BYTES: u64 = 2 * 1024 * 1024;
const HEADER_LINE_MAX: usize = 2 * 1024 * 1024;
const COUNT_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// Hard cap on bytes read from one transcript when importing.
pub const TRANSCRIPT_MAX_BYTES: u64 = 64 * 1024 * 1024;
const TRANSCRIPT_LINE_MAX: usize = 4 * 1024 * 1024;
/// Only the most recent messages of a very long session are materialised into the thread.
pub const MAX_MESSAGES: usize = 2000;
const TOOL_STRING_MAX: usize = 1500;
const TEXT_MAX: usize = 100_000;

/// A provider configuration directory to scan.
#[derive(Clone, Debug)]
pub struct ImportRoot {
    pub provider: String,
    pub home: PathBuf,
    /// Freddai account that owns this directory; `None` when no account uses it yet.
    pub account: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ImportCandidate {
    pub provider: String,
    pub session_id: String,
    pub cwd: Option<String>,
    pub title: String,
    /// File modification time (ms since epoch) = last activity.
    pub updated: u64,
    /// `None` when the file is too large to count cheaply.
    pub message_count: Option<u32>,
    pub git_branch: Option<String>,
    pub bytes: u64,
    pub account: Option<String>,
    /// Existing Freddai project whose folder matches `cwd` (filled in by the runtime).
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub cwd_exists: bool,
}

pub struct Transcript {
    pub messages: Vec<Message>,
    /// True when older messages were dropped (message cap) or the byte cap stopped parsing.
    pub truncated: bool,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads one line of at most `max` bytes into `buf`. Returns `None` at EOF; `Some(false)` when the line was
/// longer than `max` (the remainder is discarded and `buf` holds an unusable prefix).
fn read_capped_line(
    reader: &mut impl BufRead,
    buf: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<Option<bool>> {
    buf.clear();
    let n = reader
        .by_ref()
        .take(max as u64 + 1)
        .read_until(b'\n', buf)?;
    if n == 0 {
        return Ok(None);
    }
    if buf.last() == Some(&b'\n') || buf.len() <= max {
        return Ok(Some(true));
    } // full line, or final line without newline
    let mut sink = Vec::new();
    loop {
        sink.clear();
        let n = reader
            .by_ref()
            .take(64 * 1024)
            .read_until(b'\n', &mut sink)?;
        if n == 0 || sink.last() == Some(&b'\n') {
            break;
        }
    }
    Ok(Some(false))
}

fn cap(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

/// Recursively shortens long strings so tool records stay readable and small.
fn truncate_strings(v: &Value) -> Value {
    match v {
        Value::String(s) => Value::String(cap(s, TOOL_STRING_MAX)),
        Value::Array(a) => Value::Array(a.iter().map(truncate_strings).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), truncate_strings(v)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Context injected by the CLI (environment, instructions, command echoes) rather than typed by the user.
fn is_injected(text: &str) -> bool {
    let t = text.trim();
    t.is_empty()
        || t.starts_with("# AGENTS.md")
        || t.starts_with("Caveat:")
        || t.starts_with("[Request interrupted")
        || (t.starts_with('<') && t.ends_with('>'))
}

fn title_from(prompt: &str) -> String {
    crate::thread_title::from_prompt(prompt)
}

// ---------------------------------------------------------------- Claude Code

fn claude_text(message: &Value) -> Option<String> {
    match &message["content"] {
        Value::String(s) => Some(s.clone()),
        Value::Array(blocks) => {
            let parts: Vec<&str> = blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n\n"))
            }
        }
        _ => None,
    }
}

fn claude_skippable(v: &Value) -> bool {
    v["isSidechain"] == true
        || v["isMeta"] == true
        || v["isCompactSummary"] == true
        || v["isVisibleInTranscriptOnly"] == true
}

fn claude_header(path: &Path, bytes: u64, mtime: u64) -> Option<ImportCandidate> {
    let id = path.file_stem()?.to_str()?.to_string();
    if !valid_id(&id) || id.starts_with("agent-") {
        return None;
    }
    let mut reader = BufReader::new(fs::File::open(path).ok()?);
    let (mut buf, mut read, mut lines) = (Vec::new(), 0u64, 0usize);
    let (mut cwd, mut branch, mut prompt) = (None::<String>, None::<String>, None::<String>);
    let mut saw_message = false;
    while lines < HEADER_MAX_LINES && read < HEADER_MAX_BYTES {
        let Some(complete) = read_capped_line(&mut reader, &mut buf, HEADER_LINE_MAX).ok()? else {
            break;
        };
        lines += 1;
        read += buf.len() as u64;
        if !complete {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&buf) else {
            continue;
        };
        let kind = v["type"].as_str().unwrap_or("");
        if !matches!(kind, "user" | "assistant") {
            continue;
        }
        if v["isSidechain"] == true && !saw_message {
            return None;
        } // sub-agent transcript
        saw_message = true;
        if cwd.is_none() {
            cwd = v["cwd"].as_str().map(String::from);
        }
        if branch.is_none() {
            branch = v["gitBranch"]
                .as_str()
                .filter(|b| !b.is_empty() && *b != "HEAD")
                .map(String::from);
        }
        if prompt.is_none() && kind == "user" && !claude_skippable(&v) {
            if let Some(text) = claude_text(&v["message"]).filter(|t| !is_injected(t)) {
                prompt = Some(text);
            }
        }
        if prompt.is_some() && cwd.is_some() {
            break;
        }
    }
    let prompt = prompt?; // sessions with no user prompt (e.g. only file snapshots) are not importable
    let message_count = (bytes <= COUNT_MAX_BYTES).then(|| {
        count_lines(path, |l| {
            (l.contains("\"type\":\"user\"") || l.contains("\"type\":\"assistant\""))
                && !l.contains("\"isSidechain\":true")
        })
    });
    Some(ImportCandidate {
        provider: "claude".into(),
        session_id: id,
        cwd,
        title: title_from(&prompt),
        updated: mtime,
        message_count,
        git_branch: branch,
        bytes,
        account: None,
        project: None,
        cwd_exists: false,
    })
}

fn count_lines(path: &Path, pred: impl Fn(&str) -> bool) -> u32 {
    let Ok(file) = fs::File::open(path) else {
        return 0;
    };
    BufReader::new(file)
        .lines()
        .map_while(|l| l.ok())
        .filter(|l| pred(l))
        .count() as u32
}

fn claude_files(home: &Path) -> Vec<(PathBuf, u64, u64)> {
    let mut out = vec![];
    let Ok(projects) = fs::read_dir(home.join("projects")) else {
        return out;
    };
    for dir in projects.flatten() {
        if !dir.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(files) = fs::read_dir(dir.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(meta) = file.metadata() else { continue };
            if meta.is_file() {
                out.push((path, meta.len(), mtime_ms(&meta)));
            }
        }
    }
    out
}

fn claude_locate(home: &Path, session_id: &str) -> Option<PathBuf> {
    if !valid_id(session_id) {
        return None;
    }
    let name = format!("{session_id}.jsonl");
    fs::read_dir(home.join("projects"))
        .ok()?
        .flatten()
        .map(|d| d.path().join(&name))
        .find(|p| p.is_file())
}

fn claude_transcript(path: &Path) -> Result<Transcript, String> {
    let mut reader =
        BufReader::new(fs::File::open(path).map_err(|e| format!("Cannot open session file: {e}"))?);
    let (mut buf, mut read, mut n) = (Vec::new(), 0u64, 0usize);
    let mut messages: Vec<Message> = vec![];
    let mut truncated = false;
    let mut push = |role: &str, text: String, messages: &mut Vec<Message>| {
        n += 1;
        messages.push(Message {
            id: format!("imp-{n}"),
            role: role.into(),
            text: text.into(),
            attachments: vec![],
        });
    };
    loop {
        if read >= TRANSCRIPT_MAX_BYTES {
            truncated = true;
            break;
        }
        let Some(complete) = read_capped_line(&mut reader, &mut buf, TRANSCRIPT_LINE_MAX)
            .map_err(|e| e.to_string())?
        else {
            break;
        };
        read += buf.len() as u64;
        if !complete {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&buf) else {
            continue;
        };
        if claude_skippable(&v) {
            continue;
        }
        match v["type"].as_str().unwrap_or("") {
            "user" => {
                // tool_result-only turns carry no user text and are summarised by the preceding tool call.
                if let Some(text) = claude_text(&v["message"]).filter(|t| !is_injected(t)) {
                    push("user", cap(&text, TEXT_MAX), &mut messages);
                }
            }
            "assistant" => {
                let Some(blocks) = v["message"]["content"].as_array() else {
                    if let Some(t) = v["message"]["content"]
                        .as_str()
                        .filter(|t| !t.trim().is_empty())
                    {
                        push("assistant", cap(t, TEXT_MAX), &mut messages);
                    }
                    continue;
                };
                for b in blocks {
                    match b["type"].as_str().unwrap_or("") {
                        "text" => {
                            if let Some(t) = b["text"].as_str().filter(|t| !t.trim().is_empty()) {
                                push("assistant", cap(t, TEXT_MAX), &mut messages);
                            }
                        }
                        "tool_use" => push(
                            "tool",
                            serde_json::to_string_pretty(&truncate_strings(b)).unwrap_or_default(),
                            &mut messages,
                        ),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    Ok(finish(messages, truncated))
}

fn finish(mut messages: Vec<Message>, mut truncated: bool) -> Transcript {
    if messages.len() > MAX_MESSAGES {
        messages.drain(..messages.len() - MAX_MESSAGES);
        truncated = true;
    }
    Transcript {
        messages,
        truncated,
    }
}

// ---------------------------------------------------------------- Codex

fn codex_files(home: &Path) -> Vec<(PathBuf, u64, u64)> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, u64, u64)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let path = e.path();
            let Ok(meta) = e.metadata() else { continue };
            if meta.is_dir() && depth < 4 {
                walk(&path, depth + 1, out);
            } else if meta.is_file()
                && path.extension().and_then(|x| x.to_str()) == Some("jsonl")
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("rollout-"))
            {
                out.push((path, meta.len(), mtime_ms(&meta)));
            }
        }
    }
    let mut out = vec![];
    walk(&home.join("sessions"), 0, &mut out);
    out
}

fn codex_locate(home: &Path, session_id: &str) -> Option<PathBuf> {
    if !valid_id(session_id) {
        return None;
    }
    let suffix = format!("-{session_id}.jsonl");
    codex_files(home).into_iter().map(|f| f.0).find(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(&suffix))
    })
}

fn codex_user_text(v: &Value) -> Option<String> {
    let p = &v["payload"];
    match (v["type"].as_str()?, p["type"].as_str()?) {
        ("event_msg", "user_message") => p["message"].as_str().map(String::from),
        ("event_msg", "item_completed") if p["item"]["type"] == "UserMessage" => {
            let parts: Vec<&str> = p["item"]["content"]
                .as_array()?
                .iter()
                .filter(|c| c["type"] == "text")
                .filter_map(|c| c["text"].as_str())
                .collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        _ => None,
    }
}

fn codex_assistant_text(v: &Value) -> Option<String> {
    let p = &v["payload"];
    if v["type"] != "response_item" || p["type"] != "message" || p["role"] != "assistant" {
        return None;
    }
    let parts: Vec<&str> = p["content"]
        .as_array()?
        .iter()
        .filter(|c| c["type"] == "output_text")
        .filter_map(|c| c["text"].as_str())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn codex_tool(v: &Value) -> Option<String> {
    let p = &v["payload"];
    if v["type"] != "response_item" {
        return None;
    }
    let record = match p["type"].as_str()? {
        "function_call" => {
            let args = p["arguments"]
                .as_str()
                .and_then(|a| serde_json::from_str::<Value>(a).ok())
                .unwrap_or_else(|| p["arguments"].clone());
            json!({"type":"function_call","name":p["name"],"arguments":args})
        }
        "custom_tool_call" => {
            json!({"type":"custom_tool_call","name":p["name"],"input":p["input"]})
        }
        "local_shell_call" => json!({"type":"local_shell_call","action":p["action"]}),
        _ => return None,
    };
    serde_json::to_string_pretty(&truncate_strings(&record)).ok()
}

fn codex_header(path: &Path, bytes: u64, mtime: u64) -> Option<ImportCandidate> {
    let mut reader = BufReader::new(fs::File::open(path).ok()?);
    let (mut buf, mut read, mut lines) = (Vec::new(), 0u64, 0usize);
    let (mut id, mut cwd, mut branch, mut prompt) = (
        None::<String>,
        None::<String>,
        None::<String>,
        None::<String>,
    );
    while lines < HEADER_MAX_LINES && read < HEADER_MAX_BYTES {
        let Some(complete) = read_capped_line(&mut reader, &mut buf, HEADER_LINE_MAX).ok()? else {
            break;
        };
        lines += 1;
        read += buf.len() as u64;
        if !complete {
            if lines == 1 {
                return None;
            }
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&buf) else {
            if lines == 1 {
                return None;
            }
            continue;
        };
        if lines == 1 {
            if v["type"] != "session_meta" {
                return None;
            }
            let p = &v["payload"];
            // Sub-agent rollouts are owned by their parent thread.
            if p["source"].is_object() && p["source"].get("subagent").is_some()
                || p["thread_source"] == "subagent"
            {
                return None;
            }
            id = p["id"].as_str().map(String::from);
            cwd = p["cwd"].as_str().map(String::from);
            branch = p["git"]["branch"]
                .as_str()
                .filter(|b| !b.is_empty())
                .map(String::from);
            continue;
        }
        if prompt.is_none() {
            prompt = codex_user_text(&v).filter(|t| !is_injected(t));
            if prompt.is_some() {
                break;
            }
        }
    }
    let id = id.filter(|i| valid_id(i))?;
    let prompt = prompt?;
    let message_count = (bytes <= COUNT_MAX_BYTES).then(|| {
        count_lines(path, |l| {
            (l.contains("\"type\":\"user_message\"")
                || l.contains("\"type\":\"agent_message\"")
                || l.contains("\"type\":\"UserMessage\"")
                || l.contains("\"type\":\"AgentMessage\""))
                && l.contains("\"type\":\"event_msg\"")
        })
    });
    Some(ImportCandidate {
        provider: "codex".into(),
        session_id: id,
        cwd,
        title: title_from(&prompt),
        updated: mtime,
        message_count,
        git_branch: branch,
        bytes,
        account: None,
        project: None,
        cwd_exists: false,
    })
}

fn codex_transcript(path: &Path) -> Result<Transcript, String> {
    let mut reader =
        BufReader::new(fs::File::open(path).map_err(|e| format!("Cannot open session file: {e}"))?);
    let (mut buf, mut read, mut n) = (Vec::new(), 0u64, 0usize);
    let mut messages: Vec<Message> = vec![];
    let mut truncated = false;
    let mut last_user: Option<String> = None;
    loop {
        if read >= TRANSCRIPT_MAX_BYTES {
            truncated = true;
            break;
        }
        let Some(complete) = read_capped_line(&mut reader, &mut buf, TRANSCRIPT_LINE_MAX)
            .map_err(|e| e.to_string())?
        else {
            break;
        };
        read += buf.len() as u64;
        if !complete {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&buf) else {
            continue;
        };
        let (role, text) = if let Some(t) = codex_user_text(&v).filter(|t| !is_injected(t)) {
            // Some rollouts record the same prompt twice (event + item); keep one.
            if last_user.as_deref() == Some(t.as_str()) {
                continue;
            }
            last_user = Some(t.clone());
            ("user", cap(&t, TEXT_MAX))
        } else if let Some(t) = codex_assistant_text(&v).filter(|t| !t.trim().is_empty()) {
            last_user = None;
            ("assistant", cap(&t, TEXT_MAX))
        } else if let Some(t) = codex_tool(&v) {
            last_user = None;
            ("tool", t)
        } else {
            continue;
        };
        n += 1;
        messages.push(Message {
            id: format!("imp-{n}"),
            role: role.into(),
            text: text.into(),
            attachments: vec![],
        });
    }
    Ok(finish(messages, truncated))
}

// ---------------------------------------------------------------- public API

/// Lists importable sessions under `roots`, newest first. Never reads more than a header per file.
pub fn discover(roots: &[ImportRoot]) -> Vec<ImportCandidate> {
    let mut out = vec![];
    for root in roots {
        let mut files = match root.provider.as_str() {
            "claude" => claude_files(&root.home),
            "codex" => codex_files(&root.home),
            _ => continue,
        };
        files.sort_by(|a, b| b.2.cmp(&a.2));
        files.truncate(MAX_FILES_PER_ROOT);
        for (path, bytes, mtime) in files {
            let found = if root.provider == "claude" {
                claude_header(&path, bytes, mtime)
            } else {
                codex_header(&path, bytes, mtime)
            };
            if let Some(mut c) = found {
                c.account = root.account.clone();
                out.push(c);
            }
        }
    }
    out.sort_by(|a, b| {
        b.updated
            .cmp(&a.updated)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    out
}

/// Finds one session file inside a provider home by id (the client never supplies paths).
pub fn locate(provider: &str, home: &Path, session_id: &str) -> Option<PathBuf> {
    match provider {
        "claude" => claude_locate(home, session_id),
        "codex" => codex_locate(home, session_id),
        _ => None,
    }
}

pub fn header(provider: &str, path: &Path) -> Option<ImportCandidate> {
    let meta = fs::metadata(path).ok()?;
    match provider {
        "claude" => claude_header(path, meta.len(), mtime_ms(&meta)),
        "codex" => codex_header(path, meta.len(), mtime_ms(&meta)),
        _ => None,
    }
}

pub fn transcript(provider: &str, path: &Path) -> Result<Transcript, String> {
    match provider {
        "claude" => claude_transcript(path),
        "codex" => codex_transcript(path),
        _ => Err("Import is supported for Claude Code and Codex sessions only.".into()),
    }
}
