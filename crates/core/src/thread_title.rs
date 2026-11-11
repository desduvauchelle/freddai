/// Compact fallback for providers that do not publish session titles. This runs
/// locally and never starts an extra agent turn or sends the prompt elsewhere.
pub fn from_prompt(prompt: &str) -> String {
    let first = prompt
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let mut topic = first.trim_start_matches('#').trim();
    for prefix in [
        "can you please ",
        "could you please ",
        "would you please ",
        "can you ",
        "could you ",
        "would you ",
        "please ",
        "i want you to ",
        "i would like to ",
        "i want to ",
    ] {
        if topic
            .get(..prefix.len())
            .is_some_and(|p| p.eq_ignore_ascii_case(prefix))
        {
            topic = topic[prefix.len()..].trim();
            break;
        }
    }
    let words: Vec<_> = topic.split_whitespace().collect();
    let mut title = String::new();
    let mut shortened = false;
    for (index, word) in words.iter().enumerate() {
        if index >= 8
            || (!title.is_empty() && title.chars().count() + 1 + word.chars().count() > 56)
        {
            shortened = true;
            break;
        }
        if !title.is_empty() {
            title.push(' ');
        }
        title.extend(word.chars().take(56));
        if word.chars().count() > 56 {
            shortened = true;
            break;
        }
    }
    title = title.trim_end_matches(['.', '?', '!']).to_owned();
    if shortened {
        title.push('…');
    }
    clean(&title).unwrap_or_else(|| "New task".into())
}

pub fn clean(title: &str) -> Option<String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = title.trim_matches(['"', '\'']).trim();
    if title.is_empty() {
        None
    } else {
        Some(title.chars().take(100).collect())
    }
}

/// True while a thread still carries only Freddai's local prompt-derived title, so a
/// provider-generated title is still wanted. Used for the first completed Codex turn.
pub fn needs_generated_title(
    title: &str,
    title_manual: Option<bool>,
    user_messages: &[&str],
) -> bool {
    if title_manual == Some(true) || user_messages.len() != 1 {
        return false;
    }
    let first = user_messages[0];
    title == from_prompt(first) || title == first.chars().take(100).collect::<String>()
}

/// Prompt for the tool-free side thread that names a Codex thread.
pub fn codex_prompt(user: &str, assistant: &str) -> String {
    let user: String = user.chars().take(1500).collect();
    let assistant: String = assistant.chars().take(400).collect();
    let mut prompt = format!("Write a short title for this conversation. Reply with ONLY the title: 3 to 6 words, no quotes, no trailing punctuation, no explanation.\n\nFirst user message:\n{user}\n");
    if !assistant.trim().is_empty() {
        prompt.push_str(&format!("\nStart of the assistant reply:\n{assistant}\n"));
    }
    prompt
}

/// Normalises a model-generated title: first non-empty line, drops a leading "Title:"
/// label, markdown/quote wrappers and trailing punctuation, and caps the word count.
pub fn parse_generated(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut t = line.trim_start_matches('#').trim();
    if t.get(..6).is_some_and(|p| p.eq_ignore_ascii_case("title:")) {
        t = t[6..].trim();
    }
    let junk = |c: char| {
        matches!(
            c,
            '"' | '\''
                | '`'
                | '*'
                | '.'
                | '!'
                | '?'
                | ':'
                | ';'
                | ','
                | '\u{201c}'
                | '\u{201d}'
                | '\u{2018}'
                | '\u{2019}'
        )
    };
    let t = t.trim_matches(junk).trim();
    let words: Vec<_> = t.split_whitespace().take(8).collect();
    clean(&words.join(" "))
}

pub struct Generated {
    pub title: String,
    pub name_set: Result<(), String>,
}

/// Generates a title through a throwaway Codex app-server process using the same account
/// configuration: an ephemeral, read-only, never-approve thread at low reasoning effort.
/// Being a separate connection, nothing it emits can reach the user's transcript. After the
/// title is produced it is also written to the real thread with `thread/name/set`.
pub fn generate_codex(
    mut cmd: std::process::Command,
    cwd: &str,
    model: Option<&str>,
    effort: Option<&str>,
    real_thread: &str,
    prompt: &str,
    timeout: std::time::Duration,
) -> Result<Generated, String> {
    use serde_json::{json, Value};
    use std::io::{BufRead, BufReader, Write};
    use std::process::Stdio;
    cmd.args(["app-server", "--stdio"])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    let (mut child, job) = crate::windows_process::spawn(&mut cmd).map_err(|e|e.to_string())?;
    #[cfg(not(windows))]
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    #[cfg(not(windows))]
    let _guard = crate::watchdog::Guard::start(child.id());
    let result = (|| -> Result<Generated, String> {
        let mut stdin = child.stdin.take().ok_or("stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("stdout unavailable")?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let mut send = |v: Value| -> Result<(), String> {
            stdin
                .write_all(format!("{v}\n").as_bytes())
                .and_then(|_| stdin.flush())
                .map_err(|e| e.to_string())
        };
        send(
            json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"freddai-title","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
        )?;
        let deadline = std::time::Instant::now() + timeout;
        let (mut side, mut text, mut title) = (String::new(), String::new(), None::<String>);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            let line = if left.is_zero() {
                Err(())
            } else {
                rx.recv_timeout(left).map_err(|_| ())
            };
            let Ok(line) = line else {
                return match title {
                    Some(title) => Ok(Generated {
                        title,
                        name_set: Err(
                            "timed out or app-server closed before thread/name/set finished".into(),
                        ),
                    }),
                    None => {
                        Err("timed out or app-server closed before a title was produced".into())
                    }
                };
            };
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let method = v["method"].as_str().unwrap_or("");
            if !v["id"].is_null() && !method.is_empty() {
                send(
                    json!({"id":v["id"],"error":{"code":-32601,"message":"not supported for title generation"}}),
                )?;
                continue;
            }
            let failed = |step: &str| {
                format!(
                    "{step}: {}",
                    v["error"]["message"].as_str().unwrap_or("rejected")
                )
            };
            match v["id"].as_i64() {
                Some(1) if !v["error"].is_null() => return Err(failed("initialize")),
                Some(1) => {
                    send(json!({"method":"initialized","params":{}}))?;
                    let mut p = json!({"cwd":cwd,"ephemeral":true,"approvalPolicy":"never","sandbox":"read-only","baseInstructions":"You write concise conversation titles. Never use tools."});
                    if let Some(m) = model {
                        p["model"] = json!(m);
                    }
                    send(json!({"id":2,"method":"thread/start","params":p}))?;
                }
                Some(2) if !v["error"].is_null() => return Err(failed("thread/start")),
                Some(2) => {
                    side = v["result"]["thread"]["id"]
                        .as_str()
                        .ok_or("missing side thread id")?
                        .into();
                    send(
                        json!({"id":3,"method":"turn/start","params":{"threadId":side,"effort":effort,"input":[{"type":"text","text":prompt}]}}),
                    )?;
                }
                Some(3) if !v["error"].is_null() => return Err(failed("turn/start")),
                Some(4) if !v["error"].is_null() => {
                    return Ok(Generated {
                        title: title.unwrap_or_default(),
                        name_set: Err(failed("thread/resume")),
                    })
                }
                Some(4) => send(
                    json!({"id":5,"method":"thread/name/set","params":{"threadId":real_thread,"name":title.clone().unwrap_or_default()}}),
                )?,
                Some(5) => {
                    return Ok(Generated {
                        title: title.unwrap_or_default(),
                        name_set: if v["error"].is_null() {
                            Ok(())
                        } else {
                            Err(failed("thread/name/set"))
                        },
                    })
                }
                _ => {}
            }
            let params = &v["params"];
            if method == "item/completed"
                && params["threadId"] == side.as_str()
                && params["item"]["type"] == "agentMessage"
            {
                text = params["item"]["text"].as_str().unwrap_or("").into();
            }
            if method == "turn/completed" && params["threadId"] == side.as_str() {
                if params["turn"]["status"] != "completed" {
                    return Err(format!(
                        "title turn ended with status {}",
                        params["turn"]["status"]
                    ));
                }
                let t = parse_generated(&text).ok_or("model returned an empty title")?;
                if real_thread.is_empty() {
                    return Ok(Generated {
                        title: t,
                        name_set: Err("no codex thread id".into()),
                    });
                }
                title = Some(t);
                send(json!({"id":4,"method":"thread/resume","params":{"threadId":real_thread}}))?;
            }
        }
    })();
    #[cfg(windows)]
    drop(job);
    crate::runtime::terminate(&mut child);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concise_local_titles_handle_requests_and_unicode() {
        assert_eq!(
            from_prompt("Can you please fix the login redirect?"),
            "fix the login redirect"
        );
        assert_eq!(from_prompt("\n## Fix login\nLong details"), "Fix login");
        assert_eq!(from_prompt(""), "New task");
        assert_eq!(from_prompt("修复登录问题"), "修复登录问题");
        assert!(from_prompt(&"🦀".repeat(200)).chars().count() <= 57);
        assert_eq!(clean("  \"Fix\n login\" "), Some("Fix login".into()));
        assert_eq!(clean("  "), None);
    }
    #[test]
    fn generated_titles_are_sanitised() {
        assert_eq!(
            parse_generated("\"Fix login redirect.\"\n\nExplanation"),
            Some("Fix login redirect".into())
        );
        assert_eq!(
            parse_generated("Title: **Plan the launch**"),
            Some("Plan the launch".into())
        );
        assert_eq!(
            parse_generated("\n\n`Debug flaky tests`!"),
            Some("Debug flaky tests".into())
        );
        assert_eq!(
            parse_generated("one two three four five six seven eight nine ten")
                .unwrap()
                .split(' ')
                .count(),
            8
        );
        assert_eq!(parse_generated(" \n \"\" "), None);
    }
    #[test]
    fn generated_title_trigger_is_first_turn_only_and_respects_ownership() {
        let first = "Can you please fix the login redirect?";
        let fallback = from_prompt(first);
        assert!(needs_generated_title(&fallback, Some(false), &[first]));
        assert!(needs_generated_title(
            &first.chars().take(100).collect::<String>(),
            None,
            &[first]
        ));
        assert!(
            !needs_generated_title(&fallback, Some(true), &[first]),
            "manual title"
        );
        assert!(
            !needs_generated_title("Provider title", Some(false), &[first]),
            "provider title already set"
        );
        assert!(
            !needs_generated_title(&fallback, Some(false), &[first, "follow up"]),
            "not the first turn"
        );
        assert!(!needs_generated_title(&fallback, Some(false), &[]));
        assert!(codex_prompt(first, "").contains(first));
    }
}
