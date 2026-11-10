//! Spoken replies through the macOS `say` command (child process, killable for barge-in).

use super::call::Emit;
use serde::Serialize;
use serde_json::json;
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub language: String,
}

struct Speech {
    id: u64,
    child: Child,
}

static CURRENT: Mutex<Option<Speech>> = Mutex::new(None);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn lock() -> std::sync::MutexGuard<'static, Option<Speech>> {
    CURRENT.lock().unwrap_or_else(|p| p.into_inner())
}

/// Parses `say -v '?'` output: `Name (Qualifier)   en_US    # sample text`.
pub fn parse_voices(out: &str) -> Vec<Voice> {
    out.lines()
        .filter_map(|line| {
            let (head, _) = line.split_once(" # ")?;
            let head = head.trim_end();
            let (name, language) = head.rsplit_once(char::is_whitespace)?;
            let (name, language) = (name.trim(), language.trim());
            if name.is_empty() || language.is_empty() {
                return None;
            }
            Some(Voice {
                id: name.to_string(),
                name: name.to_string(),
                language: language.to_string(),
            })
        })
        .collect()
}

pub fn list_voices() -> Result<Vec<Voice>, String> {
    let out = Command::new("say")
        .args(["-v", "?"])
        .output()
        .map_err(|e| format!("Could not run `say`: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "`say -v ?` failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(parse_voices(&String::from_utf8_lossy(&out.stdout)))
}

/// Kills the current utterance, if any. Idempotent.
pub fn stop(emit: &Emit) {
    let taken = lock().take();
    if let Some(mut s) = taken {
        let _ = s.child.kill();
        let _ = s.child.wait();
        eprintln!("voice.tts.interrupted id={}", s.id);
        emit("voice-tts://end", json!({ "interrupted": true }));
    }
}

pub fn speak(
    emit: &Emit,
    text: &str,
    voice: Option<&str>,
    rate: Option<u32>,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Nothing to speak".into());
    }
    let voice = voice.map(str::trim).filter(|v| !v.is_empty());
    if let Some(v) = voice {
        if !list_voices()?.iter().any(|x| x.id == v) {
            return Err(format!("Unknown system voice \"{v}\""));
        }
    }
    stop(emit);
    let mut cmd = Command::new("say");
    if let Some(v) = voice {
        cmd.args(["-v", v]);
    }
    if let Some(r) = rate {
        cmd.args(["-r", &r.clamp(80, 500).to_string()]);
    }
    // Text goes through stdin so it can never be parsed as an option.
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start `say`: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let owned = text.to_string();
        std::thread::spawn(move || {
            let _ = stdin.write_all(owned.as_bytes());
        });
    }
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    *lock() = Some(Speech { id, child });
    eprintln!(
        "voice.tts.start id={id} chars={} voice={}",
        text.chars().count(),
        voice.unwrap_or("default")
    );
    emit("voice-tts://start", json!({}));
    let emit = emit.clone();
    std::thread::Builder::new()
        .name("voice-tts-watch".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(50));
            let mut g = lock();
            match g.as_mut() {
                Some(s) if s.id == id => match s.child.try_wait() {
                    Ok(None) => {}
                    Ok(Some(status)) => {
                        *g = None;
                        drop(g);
                        if status.success() {
                            eprintln!("voice.tts.end id={id}");
                        } else {
                            eprintln!("voice.tts.failed id={id} status={status}");
                        }
                        emit("voice-tts://end", json!({ "interrupted": false }));
                        return;
                    }
                    Err(e) => {
                        *g = None;
                        drop(g);
                        eprintln!("voice.tts.failed id={id} error={e}");
                        emit("voice-tts://end", json!({ "interrupted": false }));
                        return;
                    }
                },
                _ => return, // replaced or stopped; the stopper emitted the end event
            }
        })
        .map_err(|e| format!("Could not watch `say`: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_say_voice_list() {
        let out = "Albert              en_US    # Hello! My name is Albert.\nEddy (English (US)) en_US    # Hi # there\nBad line\n";
        let v = parse_voices(out);
        assert_eq!(v.len(), 2);
        assert_eq!(
            (v[0].name.as_str(), v[0].language.as_str()),
            ("Albert", "en_US")
        );
        assert_eq!(
            (v[1].id.as_str(), v[1].language.as_str()),
            ("Eddy (English (US))", "en_US")
        );
    }
}
