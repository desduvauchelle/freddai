//! Scout IPC (docs/scout.md "Scout IPC"). Every mutating command returns the full state.
use crate::desktop::{rpc, Host};
use scout_core::model::{Item, Lane, Project, Rule, ScoutState, Settings, Source, Workspace};
use scout_core::store::ScoutStore;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::State;

pub struct Scout(pub Mutex<Result<ScoutStore, String>>);

impl Scout {
    fn with<T>(&self, f: impl FnOnce(&mut ScoutStore) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Ok(store) => f(store),
            Err(load_error) => Err(format!("Scout data could not be loaded: {load_error}")),
        }
    }
}

/// Scout needs only accounts, projects, preferences and session metadata, so it asks for the
/// desktop's scoped snapshot (revision 0, no open threads: tool/reasoning bodies are dropped and
/// the reply is read incrementally). The unscoped `snapshot` serialises every message of every
/// thread and exceeds the host reply cap on large workspaces.
async fn freddai_snapshot(host: &State<'_, Host>) -> Result<Value, String> {
    rpc(host.inner().clone(), "snapshot_since", json!({"revision": 0, "openThreads": []}))
        .await
        .map_err(|e| format!("Could not read Freddai data: {e}"))
}

/// Which email, calendar, chat and meeting connections exist on this computer (presence only).
/// A failing signal comes back as a warning, never as an empty list.
#[tauri::command]
pub async fn scout_detect_connections(h: State<'_, Host>) -> Result<scout_core::detect::Detection, String> {
    let google = rpc(h.inner().clone(), "google_accounts", json!({})).await;
    tauri::async_runtime::spawn_blocking(move || scout_core::detect::detect(&scout_core::detect::Locations::system(), google))
        .await
        .map_err(|e| format!("Connection detection failed: {e}"))
}
/// Seconds each account's CLI health check may take (`claude mcp list` checks every server).
const CONNECTOR_CLI_TIMEOUT_SECS: u64 = 25;
const CONNECTOR_ENV_REMOVE: &[&str] = &[
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT",
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN",
];

fn run_account_cli(spec: &scout_core::connectors::AccountSpec, args: &[&str]) -> scout_core::connectors::CliOutcome {
    use scout_core::connectors::CliOutcome;
    use std::io::Read;
    use std::process::Stdio;
    let program = match spec.provider.as_str() {
        "claude" => "claude",
        "codex" => "codex",
        "antigravity" => "agy",
        other => return CliOutcome::Unavailable(format!("no CLI for {other}")),
    };
    let Some(binary) = freddai_core::platform::cli_dirs().into_iter().map(|d| d.join(program)).find(|p| p.is_file()) else {
        return CliOutcome::Unavailable(format!("Install {program} CLI to read this account's connectors."));
    };
    let mut cmd = freddai_core::platform::quiet_command(binary);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for k in CONNECTOR_ENV_REMOVE {
        cmd.env_remove(k);
    }
    match spec.provider.as_str() {
        "claude" if spec.claude_default_config => {
            cmd.env_remove("CLAUDE_CONFIG_DIR");
        }
        "claude" => {
            cmd.env("CLAUDE_CONFIG_DIR", &spec.home);
        }
        "codex" => {
            cmd.env("CODEX_HOME", &spec.home);
        }
        _ => {
            cmd.env("HOME", &spec.home);
        }
    }
    match freddai_core::platform::cli_path() {
        Ok(path) => {
            cmd.env("PATH", path);
        }
        Err(e) => return CliOutcome::Unavailable(format!("could not build PATH: {e}")),
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return CliOutcome::Unavailable(format!("could not start {program}: {e}")),
    };
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let t_out = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(o) = out.as_mut() {
            let _ = o.read_to_string(&mut s);
        }
        s
    });
    let t_err = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(o) = err.as_mut() {
            let _ = o.read_to_string(&mut s);
        }
        s
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(CONNECTOR_CLI_TIMEOUT_SECS);
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Ok(st),
            Ok(None) if std::time::Instant::now() >= deadline => break Err(None),
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(e) => break Err(Some(e.to_string())),
        }
    };
    match status {
        Ok(st) => CliOutcome::Done { code: st.code(), stdout: t_out.join().unwrap_or_default(), stderr: t_err.join().unwrap_or_default() },
        Err(why) => {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            // Pipes close once the process group is dead; do not leak the reader threads.
            let _ = (t_out.join(), t_err.join());
            match why {
                None => CliOutcome::TimedOut { secs: CONNECTOR_CLI_TIMEOUT_SECS },
                Some(e) => CliOutcome::Unavailable(format!("waiting for {program} failed: {e}")),
            }
        }
    }
}

/// Parses the `accounts` array of the host snapshot into specs. Missing config folder is reported by the caller.
fn account_specs(snapshot: &Value, root: &std::path::Path) -> Result<Vec<(String, scout_core::connectors::AccountSpec)>, String> {
    let accounts = snapshot.get("accounts").and_then(Value::as_array).ok_or("Freddai snapshot has no accounts list")?;
    let mut out = vec![];
    for a in accounts {
        let field = |k: &str| a.get(k).and_then(Value::as_str).map(str::to_owned);
        let (Some(id), Some(provider)) = (field("id"), field("provider")) else {
            return Err("Freddai snapshot account is missing id or provider".into());
        };
        let name = field("name").unwrap_or_default();
        let home = field("config_home").map(std::path::PathBuf::from).unwrap_or_else(|| root.join("accounts").join(&id));
        let claude_default_config = a.get("claude_default_config").and_then(Value::as_bool).unwrap_or(false);
        out.push((name.clone(), scout_core::connectors::AccountSpec { id, name, provider, home, claude_default_config }));
    }
    Ok(out)
}

/// Which connectors (claude.ai connectors, MCP servers) each Freddai agent account already has, with status.
/// Runs each account's CLI in parallel with a timeout; failures come back as that account's `warning`.
#[tauri::command]
pub async fn scout_detect_account_connectors(h: State<'_, Host>) -> Result<scout_core::connectors::AccountDetection, String> {
    use scout_core::connectors::{build_account, cli_args, AccountConnectors, AccountDetection};
    let root = h.inner().root.clone();
    let snapshot = freddai_snapshot(&h).await?;
    let specs = account_specs(&snapshot, &root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let user_home = freddai_core::platform::home_dir().unwrap_or_default();
        let handles: Vec<_> = specs
            .into_iter()
            .map(|(_, spec)| {
                let user_home = user_home.clone();
                std::thread::spawn(move || {
                    if cli_args(&spec.provider).is_some() && !spec.home.is_dir() && !spec.claude_default_config {
                        let warning = format!("Account folder {} does not exist yet; sign in to this account first.", spec.home.display());
                        eprintln!("{}", json!({"event": "scout.detect_account_connectors.warning", "account": spec.id, "provider": spec.provider, "reason": warning}));
                        return AccountConnectors { account: spec.id, connectors: vec![], warning: Some(warning) };
                    }
                    let outcome = cli_args(&spec.provider).map(|args| run_account_cli(&spec, args));
                    build_account(&spec, &user_home, outcome)
                })
            })
            .collect();
        let mut accounts = vec![];
        for h in handles {
            match h.join() {
                Ok(a) => accounts.push(a),
                Err(_) => return Err("Connector detection for an account panicked".to_string()),
            }
        }
        Ok(AccountDetection { accounts })
    })
    .await
    .map_err(|e| format!("Connector detection failed: {e}"))?
}

#[tauri::command(async)]
pub fn scout_state(s: State<'_, Scout>) -> Result<ScoutState, String> {
    s.with(|st| Ok(st.state.clone()))
}
#[tauri::command(async)]
pub fn scout_workspace_save(s: State<'_, Scout>, workspace: Workspace) -> Result<ScoutState, String> {
    s.with(|st| st.workspace_save(workspace))
}
#[tauri::command(async)]
pub fn scout_workspace_delete(s: State<'_, Scout>, id: String) -> Result<ScoutState, String> {
    s.with(|st| st.workspace_delete(&id))
}
#[tauri::command(async)]
pub fn scout_workspace_reorder(s: State<'_, Scout>, ids: Vec<String>) -> Result<ScoutState, String> {
    s.with(|st| st.workspace_reorder(&ids))
}
#[tauri::command(async)]
pub fn scout_project_save(s: State<'_, Scout>, project: Project) -> Result<ScoutState, String> {
    s.with(|st| st.project_save(project))
}
#[tauri::command(async)]
pub fn scout_project_delete(s: State<'_, Scout>, id: String) -> Result<ScoutState, String> {
    s.with(|st| st.project_delete(&id))
}
#[tauri::command(async)]
pub fn scout_project_move(s: State<'_, Scout>, id: String, workspace: String, index: i64) -> Result<ScoutState, String> {
    s.with(|st| st.project_move(&id, &workspace, index))
}
#[tauri::command(async)]
pub fn scout_item_save(s: State<'_, Scout>, item: Item) -> Result<ScoutState, String> {
    s.with(|st| st.item_save(item))
}
#[tauri::command(async)]
pub fn scout_item_delete(s: State<'_, Scout>, id: String) -> Result<ScoutState, String> {
    s.with(|st| st.item_delete(&id))
}
#[tauri::command(async)]
pub fn scout_item_move(s: State<'_, Scout>, id: String, lane: Lane, index: i64) -> Result<ScoutState, String> {
    s.with(|st| st.item_move(&id, lane, index))
}
#[tauri::command(async)]
pub fn scout_rule_save(s: State<'_, Scout>, rule: Rule) -> Result<ScoutState, String> {
    s.with(|st| st.rule_save(rule))
}
#[tauri::command(async)]
pub fn scout_rule_delete(s: State<'_, Scout>, id: String) -> Result<ScoutState, String> {
    s.with(|st| st.rule_delete(&id))
}
#[tauri::command(async)]
pub fn scout_source_save(s: State<'_, Scout>, source: Source) -> Result<ScoutState, String> {
    s.with(|st| st.source_save(source))
}
#[tauri::command(async)]
pub fn scout_source_delete(s: State<'_, Scout>, id: String) -> Result<ScoutState, String> {
    s.with(|st| st.source_delete(&id))
}
#[tauri::command(async)]
pub fn scout_settings_save(s: State<'_, Scout>, settings: Settings) -> Result<ScoutState, String> {
    s.with(|st| st.settings_save(settings))
}
#[tauri::command]
pub async fn scout_import_freddai(s: State<'_, Scout>, h: State<'_, Host>) -> Result<ScoutState, String> {
    let snapshot = freddai_snapshot(&h).await?;
    let now = scout_core::chrono::Utc::now();
    s.with(|st| st.mutate(|state| scout_core::import::import_freddai(state, &snapshot, now)))
}
#[tauri::command]
pub async fn scout_sample_data(s: State<'_, Scout>, h: State<'_, Host>, load: bool) -> Result<ScoutState, String> {
    if !load {
        return s.with(|st| st.mutate(|state| Ok(scout_core::sample::clear_sample(state))));
    }
    // Sample sources point at the first Freddai account; a failed snapshot is an error, not a fallback.
    let snapshot = freddai_snapshot(&h).await?;
    let account = snapshot
        .pointer("/accounts/0/id")
        .and_then(Value::as_str)
        .unwrap_or(scout_core::sample::SAMPLE_ACCOUNT)
        .to_string();
    let now = scout_core::chrono::Utc::now();
    s.with(|st| st.mutate(|state| Ok(scout_core::sample::load_sample(state, now, &account))))
}

#[cfg(test)]
mod account_connector_tests {
    /// Real run against this machine's Freddai accounts. `cargo test -p freddai-native real_account_detection -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_account_detection() {
        use scout_core::connectors::*;
        let root = freddai_core::platform::home_dir().unwrap().join("Library/Application Support/com.freddai.desktop");
        let ws: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join("workspace.json")).unwrap()).unwrap();
        let specs = super::account_specs(&ws, &root).unwrap();
        let handles: Vec<_> = specs.into_iter().map(|(_, s)| std::thread::spawn(move || {
            let o = cli_args(&s.provider).map(|a| super::run_account_cli(&s, a));
            (s.provider.clone(), s.name.clone(), build_account(&s, &freddai_core::platform::home_dir().unwrap(), o))
        })).collect();
        for h in handles {
            let (p, n, r) = h.join().unwrap();
            println!("== {p} · {n} warning={:?}", r.warning);
            for c in r.connectors.iter().filter(|c| c.via != "claude_plugin_mcp") {
                println!("   {:<22} {:<10?} {:<10?} {:?} [{}]", c.label, c.kind, c.status, c.raw_name, c.via);
            }
            println!("   (+{} plugin servers)", r.connectors.iter().filter(|c| c.via == "claude_plugin_mcp").count());
        }
    }
}
