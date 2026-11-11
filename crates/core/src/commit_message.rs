//! Commit-message suggestions for the thread-list "Ship it" button. Generated only on an explicit
//! request, through the same tool-free one-off side request the daily summaries use, with the
//! project's own default agent (never a substituted one). Failures are returned, never invented over.
use crate::day_summary::{side_claude, side_codex};
use crate::runtime::{Account, Database, Runtime};
use serde_json::{json, Value};
use std::{collections::HashMap, process::Command, sync::Mutex, time::Duration};

const SIDE_TIMEOUT: Duration = Duration::from_secs(120);
/// Characters of diff sent to the agent; the rest is counted in the prompt, never silently dropped.
pub const DIFF_CAP: usize = 16_000;

#[derive(Clone)]
enum Job {
    Running,
    Done(String),
    Failed(String),
}
static JOBS: Mutex<Option<HashMap<String, Job>>> = Mutex::new(None);
fn set(project: &str, j: Option<Job>) {
    let mut g = JOBS.lock().unwrap();
    let m = g.get_or_insert_with(HashMap::new);
    match j {
        Some(j) => {
            m.insert(project.into(), j);
        }
        None => {
            m.remove(project);
        }
    }
}

pub fn build_prompt(stat: &str, diff: &str) -> String {
    let total = diff.chars().count();
    let shown: String = diff.chars().take(DIFF_CAP).collect();
    let note = if total > DIFF_CAP {
        format!("\n(diff truncated: showing {DIFF_CAP} of {total} characters)\n")
    } else {
        String::new()
    };
    format!(
        "Write a git commit message for the changes below. First line: imperative summary, at most 72 characters, no trailing period. \
         If useful, add a blank line and up to 4 short bullet points. Output only the commit message, no quotes, no code fences, no commentary. \
         Do not use tools. Only use the information below.\n\n## git diff --stat\n{stat}\n\n## diff\n{shown}{note}"
    )
}

/// Strips code fences / quotes an agent may wrap around the message.
pub fn clean(raw: &str) -> String {
    let t = raw.trim();
    let t = t
        .strip_prefix("```")
        .map(|r| r.split_once('\n').map(|x| x.1).unwrap_or(r))
        .unwrap_or(t);
    t.trim()
        .trim_end_matches("```")
        .trim()
        .trim_matches('"')
        .trim()
        .to_owned()
}

/// Runs the side request synchronously with the given project's account.
pub fn generate(
    db: &Database,
    project: &str,
    stat: &str,
    diff: &str,
    make_cmd: &dyn Fn(&Account) -> Result<Command, String>,
) -> Result<String, String> {
    let p = db
        .projects
        .iter()
        .find(|p| p.id == project)
        .ok_or("Unknown project")?;
    let id = p.account.as_deref().ok_or("This project has no default agent, so no commit message can be generated. Type one instead.")?;
    let account =
        db.accounts.iter().find(|a| a.id == id).ok_or(
            "The project's default agent account no longer exists. Type a message instead.",
        )?;
    if !["codex", "claude"].contains(&account.provider.as_str()) {
        return Err(format!("The project's default agent ({}) cannot write commit messages (only Codex and Claude can). Type one instead.", account.provider));
    }
    crate::timing::log(
        "host",
        format_args!(
            "ev=commit_message.requested project={project} provider={} route=side_request",
            account.provider
        ),
    );
    let (model, effort) = crate::model_levels::resolve(&db.preferences.model_configuration, &account.provider, None, None, &|| make_cmd(account))?;
    let cmd = make_cmd(account).map_err(|e| format!("{} is unavailable: {e}", account.provider))?;
    let prompt = build_prompt(stat, diff);
    let raw = match account.provider.as_str() {
        "codex" => side_codex(cmd, &p.path, &prompt, SIDE_TIMEOUT, model.as_deref(), effort.as_deref()),
        _ => side_claude(cmd, &p.path, &prompt, SIDE_TIMEOUT, model.as_deref(), effort.as_deref()),
    }
    .map_err(|e| format!("{} request failed: {e}", account.provider))?;
    let msg = clean(&raw);
    if msg.is_empty() {
        return Err(format!(
            "{} returned an empty commit message.",
            account.provider
        ));
    }
    Ok(msg)
}

/// Starts generation on a detached thread (the host socket has a short timeout); the UI polls `state`.
pub fn start(rt: &Runtime, project: &str, stat: &str, diff: &str) -> Result<Value, String> {
    {
        let mut g = JOBS.lock().unwrap();
        let m = g.get_or_insert_with(HashMap::new);
        if matches!(m.get(project), Some(Job::Running)) {
            return Err("A commit message is already being generated for this project.".into());
        }
        m.insert(project.into(), Job::Running);
    }
    let (db, root, project, stat, diff) = (
        rt.snapshot(),
        rt.root_dir(),
        project.to_owned(),
        stat.to_owned(),
        diff.to_owned(),
    );
    std::thread::spawn(move || {
        let r = generate(&db, &project, &stat, &diff, &|a| {
            crate::runtime::command(a, &root)
        });
        if let Err(e) = &r {
            crate::timing::log(
                "host",
                format_args!("ev=commit_message.failed project={project} reason={e:?}"),
            );
        }
        set(
            &project,
            Some(match r {
                Ok(m) => Job::Done(m),
                Err(e) => Job::Failed(e),
            }),
        );
    });
    Ok(json!({"running":true}))
}

/// `{running, message, error}`. A finished result is consumed by the read.
pub fn state(project: &str) -> Value {
    let job = JOBS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|m| m.get(project).cloned());
    match job {
        Some(Job::Running) => json!({"running":true,"message":null,"error":null}),
        Some(Job::Done(m)) => {
            set(project, None);
            json!({"running":false,"message":m,"error":null})
        }
        Some(Job::Failed(e)) => {
            set(project, None);
            json!({"running":false,"message":null,"error":e})
        }
        None => {
            json!({"running":false,"message":null,"error":"No commit message request is in progress."})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prompt_truncates_and_says_so() {
        let p = build_prompt("a | 1 +", &"x".repeat(DIFF_CAP + 10));
        assert!(p.contains("diff truncated"));
        assert!(!build_prompt("a | 1 +", "small").contains("truncated"));
    }
    #[test]
    fn clean_strips_fences_and_quotes() {
        assert_eq!(clean("```\nFix thing\n```"), "Fix thing");
        assert_eq!(clean("\"Fix thing\"\n"), "Fix thing");
        assert_eq!(clean("Fix\n\n- a"), "Fix\n\n- a");
    }
    #[test]
    fn unsupported_or_missing_agent_is_an_error() {
        let db: Database = serde_json::from_value(json!({"accounts":[],"projects":[{"id":"p","name":"p","path":"/tmp","color":"x","policy":"p","account":null,"last":null}],"sessions":[],"preferences":{"prefer_last":false,"fallback":null,"last":null}})).unwrap_or_else(|e| panic!("{e}"));
        let e = generate(&db, "p", "", "", &|_| Err("no".into())).unwrap_err();
        assert!(e.contains("no default agent"), "{e}");
        assert!(generate(&db, "zzz", "", "", &|_| Err("no".into())).is_err());
    }
}
