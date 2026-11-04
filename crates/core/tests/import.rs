use freddai_core::import::{discover, header, locate, transcript, ImportRoot};
use freddai_core::runtime::{ImportRequest, Runtime};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
};

const CLAUDE_ID: &str = "11111111-1111-4111-8111-111111111111";
const CODEX_ID: &str = "22222222-2222-4222-8222-222222222222";

fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("freddai-import-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(dir).unwrap()
}
fn fixture(name: &str, cwd: &Path) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/import")
            .join(name),
    )
    .unwrap()
    .replace("__CWD__", &cwd.to_string_lossy())
}
/// Lays out fake `.claude` and `.codex` homes (never the real ones) and returns (base, project dir).
fn layout(name: &str) -> (PathBuf, PathBuf) {
    let base = tmp(name);
    let project = base.join("work/app");
    fs::create_dir_all(&project).unwrap();
    let claude = base.join("claude/projects/-work-app");
    fs::create_dir_all(&claude).unwrap();
    fs::write(
        claude.join(format!("{CLAUDE_ID}.jsonl")),
        fixture("claude.jsonl", &project),
    )
    .unwrap();
    fs::write(
        claude.join("agent-abc.jsonl"),
        fixture("claude-subagent.jsonl", &project),
    )
    .unwrap();
    fs::write(
        claude.join("22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl"),
        fixture("claude-subagent.jsonl", &project),
    )
    .unwrap(); // sidechain-only
    let codex = base.join("codex/sessions/2026/10/31");
    fs::create_dir_all(&codex).unwrap();
    fs::write(
        codex.join(format!("rollout-2026-10-31T08-24-45-{CODEX_ID}.jsonl")),
        fixture("codex.jsonl", &project),
    )
    .unwrap();
    fs::write(
        codex.join("rollout-2026-10-31T09-00-00-33333333-3333-4333-8333-333333333333.jsonl"),
        fixture("codex-subagent.jsonl", &project),
    )
    .unwrap();
    (base, project)
}
fn roots(base: &Path, account: Option<&str>) -> Vec<ImportRoot> {
    vec![
        ImportRoot {
            provider: "claude".into(),
            home: base.join("claude"),
            account: account.map(Into::into),
        },
        ImportRoot {
            provider: "codex".into(),
            home: base.join("codex"),
            account: account.map(Into::into),
        },
    ]
}

#[test]
fn discovers_metadata_and_skips_subagents() {
    let (base, project) = layout("discover");
    let found = discover(&roots(&base, Some("acct")));
    assert_eq!(
        found.len(),
        2,
        "sub-agent and sidechain files are skipped: {found:?}"
    );
    let claude = found.iter().find(|c| c.provider == "claude").unwrap();
    assert_eq!(claude.session_id, CLAUDE_ID);
    assert_eq!(claude.cwd.as_deref(), Some(project.to_str().unwrap()));
    assert_eq!(claude.git_branch.as_deref(), Some("feature/import"));
    assert_eq!(claude.title, "fix the flaky login test in the auth…");
    assert_eq!(claude.account.as_deref(), Some("acct"));
    assert!(claude.message_count.unwrap() >= 5);
    let codex = found.iter().find(|c| c.provider == "codex").unwrap();
    assert_eq!(codex.session_id, CODEX_ID);
    assert_eq!(codex.git_branch.as_deref(), Some("main"));
    assert_eq!(codex.title, "Add a retry to the upload client");
}

#[test]
fn locate_finds_by_id_only() {
    let (base, _) = layout("locate");
    assert!(locate("claude", &base.join("claude"), CLAUDE_ID).is_some());
    assert!(locate("codex", &base.join("codex"), CODEX_ID).is_some());
    assert!(locate("claude", &base.join("claude"), "../../etc/passwd").is_none());
    assert!(locate("claude", &base.join("claude"), "missing").is_none());
    assert!(header(
        "claude",
        &locate("claude", &base.join("claude"), CLAUDE_ID).unwrap()
    )
    .is_some());
}

#[test]
fn converts_claude_transcript() {
    let (base, _) = layout("claude-transcript");
    let path = locate("claude", &base.join("claude"), CLAUDE_ID).unwrap();
    let t = transcript("claude", &path).unwrap();
    let rows: Vec<(&str, &str)> = t
        .messages
        .iter()
        .map(|m| (m.role.as_str(), m.text.as_str()))
        .collect();
    assert_eq!(
        rows[0],
        ("user", "Please fix the flaky login test in the auth module")
    );
    assert_eq!(rows[1], ("assistant", "I will look at the test first."));
    assert_eq!(rows[2].0, "tool");
    assert!(rows[2].1.contains("\"name\": \"Bash\"") && rows[2].1.contains("pnpm test auth"));
    assert_eq!(
        rows[3],
        ("assistant", "The test races with the session refresh.")
    );
    assert_eq!(rows[4], ("user", "Great, apply the fix"));
    assert_eq!(
        rows.len(),
        5,
        "sidechain, command echoes, tool results and bad lines are dropped: {rows:?}"
    );
    assert!(!t.truncated);
    let ids: std::collections::HashSet<_> = t.messages.iter().map(|m| &m.id).collect();
    assert_eq!(ids.len(), 5);
}

#[test]
fn converts_codex_transcript_without_duplicates() {
    let (base, _) = layout("codex-transcript");
    let path = locate("codex", &base.join("codex"), CODEX_ID).unwrap();
    let t = transcript("codex", &path).unwrap();
    let rows: Vec<(&str, &str)> = t
        .messages
        .iter()
        .map(|m| (m.role.as_str(), m.text.as_str()))
        .collect();
    assert_eq!(rows[0], ("user", "Add a retry to the upload client"));
    assert_eq!(rows[1].0, "tool");
    assert!(rows[1].1.contains("\"name\": \"shell\"") && rows[1].1.contains("rg"));
    assert_eq!(rows[2], ("assistant", "Added exponential backoff."));
    assert_eq!(rows[3], ("user", "Now add a test"));
    assert_eq!(rows[4], ("assistant", "Test added."));
    assert_eq!(rows.len(), 5, "{rows:?}");
}

#[test]
fn caps_long_transcripts_to_recent_messages() {
    let (base, project) = layout("cap");
    let path = base.join("claude/projects/-work-app/33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl");
    let mut text = String::new();
    for n in 0..2105 {
        text.push_str(&format!("{{\"type\":\"user\",\"cwd\":\"{}\",\"message\":{{\"role\":\"user\",\"content\":\"msg {n}\"}}}}\n", project.display()));
    }
    fs::write(&path, text).unwrap();
    let t = transcript("claude", &path).unwrap();
    assert_eq!(t.messages.len(), freddai_core::import::MAX_MESSAGES);
    assert!(t.truncated);
    assert_eq!(t.messages.last().unwrap().text, "msg 2104");
}

fn runtime_with_account(base: &Path, provider: &str, home: &Path) -> Runtime {
    let root = base.join("freddai-root");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("workspace.json"), json!({
        "accounts":[{"id":"acct","name":"Test","provider":provider,"color":"#fff","config_home":home}],
        "projects":[],"sessions":[],"preferences":{"prefer_last":false,"fallback":null,"last":null}
    }).to_string()).unwrap();
    Runtime::open(root).unwrap()
}

#[test]
fn imports_once_creates_project_on_confirmation_and_dedupes() {
    let (base, project) = layout("runtime");
    let rt = runtime_with_account(&base, "claude", &base.join("claude"));
    let candidates = rt.import_candidates_with(vec![]).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].project, None);
    assert!(candidates[0].cwd_exists);

    let request = |create| ImportRequest {
        provider: "claude".into(),
        session_id: CLAUDE_ID.into(),
        account: "acct".into(),
        create_project: create,
    };
    let denied = rt.import_sessions(vec![request(false)]).unwrap();
    assert!(
        denied[0]
            .error
            .as_deref()
            .unwrap()
            .contains("No Freddai project"),
        "{denied:?}"
    );
    assert!(
        rt.snapshot().sessions.is_empty(),
        "nothing is created without confirmation"
    );

    let done = rt.import_sessions(vec![request(true)]).unwrap();
    assert!(done[0].error.is_none() && !done[0].skipped, "{done:?}");
    let db = rt.snapshot();
    assert_eq!(db.projects.len(), 1);
    assert_eq!(db.projects[0].path, project.to_string_lossy());
    let s = &db.sessions[0];
    assert_eq!(s.provider_id.as_deref(), Some(CLAUDE_ID));
    assert_eq!(s.account, "acct");
    assert_eq!(s.project, db.projects[0].id);
    assert_eq!(s.status, "done");
    assert_eq!(s.messages.len(), 5);
    assert_eq!(s.read_at, Some(s.updated), "imported history is not unread");

    let again = rt.import_sessions(vec![request(true)]).unwrap();
    assert!(again[0].skipped && again[0].thread.as_deref() == Some(s.id.as_str()));
    assert_eq!(rt.snapshot().sessions.len(), 1, "no duplicate thread");
    assert!(
        rt.import_candidates_with(vec![]).unwrap().is_empty(),
        "owned sessions are no longer offered"
    );
}

#[test]
fn wrong_account_and_missing_folder_fail_loudly() {
    let (base, project) = layout("errors");
    let rt = runtime_with_account(&base, "codex", &base.join("codex"));
    let wrong = rt
        .import_sessions(vec![ImportRequest {
            provider: "claude".into(),
            session_id: CLAUDE_ID.into(),
            account: "acct".into(),
            create_project: true,
        }])
        .unwrap();
    assert!(
        wrong[0]
            .error
            .as_deref()
            .unwrap()
            .contains("belongs to claude"),
        "{wrong:?}"
    );
    let ok = rt
        .import_sessions(vec![ImportRequest {
            provider: "codex".into(),
            session_id: CODEX_ID.into(),
            account: "acct".into(),
            create_project: true,
        }])
        .unwrap();
    assert!(ok[0].error.is_none(), "{ok:?}");
    // Folder removed after discovery: the error names the folder.
    fs::remove_dir_all(&project).unwrap();
    let rt2 = runtime_with_account(&tmp("errors2"), "codex", &base.join("codex"));
    let gone = rt2
        .import_sessions(vec![ImportRequest {
            provider: "codex".into(),
            session_id: CODEX_ID.into(),
            account: "acct".into(),
            create_project: true,
        }])
        .unwrap();
    assert!(
        gone[0]
            .error
            .as_deref()
            .unwrap()
            .contains("no longer exists"),
        "{gone:?}"
    );
    assert!(rt2.import_sessions(vec![]).is_err());
}
