//! Host side of a Mac satellite: runs desktop (Tauri) commands by name for the `/v1/desktop` companion route.
//!
//! The satellite runs the full desktop UI and forwards each `invoke(command, args)` here. This process is
//! the headless companion server (no `AppHandle`), so every command is mapped onto what the desktop command
//! body does: a host RPC (via `desktop::rpc`, which keeps host restart/upgrade recovery), a free function
//! against the host's data root, a git action, or a headless PTY. Commands that only make sense on the
//! satellite's own screen/machine return a loud error so a mis-route cannot go unnoticed.
//!
//! Args arrive exactly as the webview sent them. Tauri accepts camelCase and snake_case from JS, so
//! `get` tries the snake_case name and then its camelCase form.
use crate::{desktop, satellite_terminals as terminals};
use desktop::Host;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

/// Commands that act on the satellite's own windows, screen, microphone, updater or scout/bug-walk state.
/// Each prefix/name is matched by `runs_on_satellite`.
const SATELLITE_PREFIXES: [&str; 5] = ["voice_", "bug_walk_", "scout_", "satellite_", "updater_"];
const SATELLITE_ONLY: [&str; 12] = [
    "open_project_vscode", "open_thread_window", "open_app_window", "focus_main_window", "browser_view",
    "preview_open", "preview_file_url", "capture_screenshot", "platform", "check_for_updates",
    "install_update", "restart_app",
];
/// Host-side flows that open a browser or loopback listener on the host Mac.
const HOST_BROWSER_FLOWS: [&str; 6] = [
    "google_config_get", "google_config_set", "google_connect_start", "google_connect_status", "login", "cancel_login",
];

fn runs_on_satellite(command: &str) -> bool {
    SATELLITE_ONLY.contains(&command) || command == "open_release_page" || SATELLITE_PREFIXES.iter().any(|p| command.starts_with(p))
}

/// Read-only commands the satellite polls continuously; the relay skips its exactly-once receipt for them.
pub fn is_read_only(command: &str) -> bool {
    matches!(
        command,
        "snapshot" | "snapshot_since" | "terminal_poll" | "tool_text" | "generated_file" | "preview_attachment"
            | "load_project_order" | "load_account_order" | "startup_status" | "awake_status" | "auth_status"
            | "login_state" | "account_usage" | "account_models" | "git_status" | "git_history" | "git_diff_file"
            | "git_branches" | "git_pr_status" | "git_ship_preview" | "git_commit_message_state"
            | "detect_agents" | "detect_existing_sign_ins" | "list_slash_commands" | "list_project_files"
            | "import_candidates" | "commander_state" | "commander_todos" | "commander_notes" | "commander_note_read"
            | "commander_proposals" | "commander_settings_get" | "commander_profile" | "commander_memory"
            | "day_summary" | "google_accounts" | "google_triggers" | "google_capability" | "companion_devices"
            | "vscode_available"
    )
}

fn camel(name: &str) -> String {
    let mut out = String::new();
    let mut upper = false;
    for c in name.chars() {
        if c == '_' { upper = true } else if upper { out.extend(c.to_uppercase()); upper = false } else { out.push(c) }
    }
    out
}

/// Deserializes one argument like Tauri would: absent/null becomes `None` for `Option`, an error otherwise.
fn get<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    let value = args.get(name).or_else(|| args.get(camel(name))).cloned().unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|e| format!("Invalid argument `{name}`: {e}"))
}

fn ser<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

struct Ctx<'a> {
    root: &'a Path,
    make: &'a dyn Fn() -> Result<Host, String>,
    host: std::cell::OnceCell<Host>,
}

impl Ctx<'_> {
    /// Built at most once per dispatch, and only for commands that need the host.
    fn host(&self) -> Result<&Host, String> {
        if let Some(h) = self.host.get() { return Ok(h); }
        let h = (self.make)()?;
        Ok(self.host.get_or_init(|| h))
    }
    fn rpc(&self, op: &'static str, payload: Value) -> Result<Value, String> {
        let host = self.host()?.clone();
        tauri::async_runtime::block_on(desktop::rpc(host, op, payload))
    }
}

/// Process-wide host handle per root: `host_binary` hashes the whole executable, which must not happen per poll.
fn shared_host(root: &Path) -> Result<Host, String> {
    static CACHE: Mutex<Option<(PathBuf, Host)>> = Mutex::new(None);
    let mut cache = CACHE.lock().map_err(|_| "Host handle is unavailable".to_string())?;
    if let Some((cached_root, host)) = cache.as_ref() {
        if cached_root == root { return Ok(host.clone()); }
    }
    let host = Host::new(root.to_path_buf(), desktop::host_binary(root)?);
    *cache = Some((root.to_path_buf(), host.clone()));
    Ok(host)
}

pub fn dispatch(root: &Path, command: &str, args: &Value) -> Result<Value, String> {
    let make = || shared_host(root);
    dispatch_with(root, &make, command, args)
}

fn dispatch_with(root: &Path, make: &dyn Fn() -> Result<Host, String>, command: &str, args: &Value) -> Result<Value, String> {
    let ctx = Ctx { root, make, host: Default::default() };
    let result = run(&ctx, command, args);
    if let Err(error) = &result {
        eprintln!("{}", json!({"event": "satellite.desktop_command_failed", "command": command, "error": error}));
    }
    result
}

fn run(ctx: &Ctx, command: &str, args: &Value) -> Result<Value, String> {
    if command == "vscode_available" { return Ok(json!(false)); } // the editor would open on the host, never here
    if runs_on_satellite(command) {
        return Err(format!("{command} runs on the satellite Mac, not the host"));
    }
    if HOST_BROWSER_FLOWS.contains(&command) {
        // `login` spawns the provider CLI's browser/loopback sign-in (codex/grok `login`, or a Terminal
        // session for Claude/Gemini) on the host Mac, and Google OAuth redirects to a loopback listener on the
        // host, so neither can be completed from a satellite. `cancel_login` only pairs with `login`.
        return Err(match command {
            "login" | "cancel_login" => "Sign in on your original Mac: the login flow opens a browser there.".to_string(),
            _ => format!("{command} must be done on your original Mac: the Google sign-in lands on its browser."),
        });
    }
    let root = ctx.root;
    match command {
        // ---- forwarded host ops (payloads mirror desktop.rs) ----
        "snapshot" => ctx.rpc("snapshot", json!({})),
        "snapshot_since" => {
            let (revision, host_id, open): (u64, Option<String>, Option<Vec<String>>) =
                (get(args, "revision")?, get(args, "host_id")?, get(args, "open_threads")?);
            // Older hosts ignore openThreads; request whole changed sessions so compatibility projection is lossless.
            ctx.rpc("snapshot_since", json!({"revision": revision, "hostId": host_id, "messageDeltas": open.is_none(), "openThreads": open}))
        }
        "tool_text" => {
            let (thread, message, offset, hash): (String, String, u64, Option<String>) =
                (get(args, "thread")?, get(args, "message")?, get(args, "offset")?, get(args, "hash")?);
            let host = ctx.host()?;
            match desktop::call_with_recovery(host, "tool_text", json!({"thread": thread, "message": message, "offset": offset, "hash": hash})) {
                Err(e) if e.contains("Unknown host command") => {
                    let db = desktop::call_with_recovery(host, "snapshot", json!({}))?;
                    let text = db["sessions"].as_array().and_then(|s| s.iter().find(|s| s["id"] == thread))
                        .and_then(|s| s["messages"].as_array()).and_then(|m| m.iter().find(|m| m["id"] == message && m["role"] == "tool"))
                        .and_then(|m| m["text"].as_str()).ok_or("Tool output unavailable")?;
                    freddai_core::desktop_snapshot::text_chunk(text, offset as usize, hash.as_deref())
                }
                other => other,
            }
        }
        "generated_file" => {
            let (thread, href, offset, length): (String, String, u64, Option<u64>) =
                (get(args, "thread")?, get(args, "href")?, get(args, "offset")?, get(args, "length")?);
            tauri::async_runtime::block_on(desktop::generated_chunk(ctx.host()?.clone(), thread, href, offset, length))
        }
        "detect_agents" => ctx.rpc("detect_agents", json!({})),
        "detect_existing_sign_ins" => ctx.rpc("detect_existing_sign_ins", json!({})),
        "connect_existing" => ctx.rpc("connect_existing", json!({"provider": get::<String>(args, "provider")?, "name": get::<Option<String>>(args, "name")?, "color": get::<Option<String>>(args, "color")?})),
        "save_claude_login" => ctx.rpc("save_claude_login", json!({"name": get::<String>(args, "name")?, "color": get::<String>(args, "color")?})),
        "add_account" => ctx.rpc("add_account", json!({"name": get::<String>(args, "name")?, "provider": get::<String>(args, "provider")?, "color": get::<String>(args, "color")?})),
        "remove_account" => ctx.rpc("remove_account", json!({"account": get::<String>(args, "account")?})),
        "rename_account" => ctx.rpc("rename_account", json!({"account": get::<String>(args, "account")?, "name": get::<String>(args, "name")?})),
        "save_project" => ctx.rpc("save_project", json!({"project": get::<Value>(args, "project")?})),
        "import_project" => ctx.rpc("import_project", json!({"path": get::<String>(args, "path")?, "color": get::<String>(args, "color")?})),
        "import_candidates" => ctx.rpc("import_candidates", json!({})),
        "import_sessions" => ctx.rpc("import_sessions", json!({"sessions": get::<Value>(args, "sessions")?})),
        "save_preferences" => ctx.rpc("save_preferences", json!({"preferences": get::<Option<Value>>(args, "preferences")?, "patch": get::<Option<Value>>(args, "patch")?})),
        "commander_state" => ctx.rpc("commander_state", json!({})),
        "commander_todos" => ctx.rpc("commander_todos", json!({})),
        "commander_todo_save" => ctx.rpc("commander_todo_save", json!({"todo": get::<Value>(args, "todo")?})),
        "commander_notes" => ctx.rpc("commander_notes", json!({})),
        "commander_note_read" => ctx.rpc("commander_note_read", json!({"name": get::<String>(args, "name")?})),
        "commander_note_write" => ctx.rpc("commander_note_write", json!({"name": get::<String>(args, "name")?, "body": get::<String>(args, "body")?})),
        "commander_proposals" => ctx.rpc("commander_proposals", json!({})),
        "commander_proposal_respond" => ctx.rpc("commander_proposal_respond", json!({"id": get::<String>(args, "id")?, "approve": get::<bool>(args, "approve")?, "prompt": get::<Option<String>>(args, "prompt")?})),
        "commander_settings_get" => ctx.rpc("commander_settings_get", json!({})),
        "commander_settings_save" => ctx.rpc("commander_settings_save", json!({"settings": get::<Value>(args, "settings")?})),
        "commander_profile" => ctx.rpc("commander_profile", json!({})),
        "commander_profile_save" => ctx.rpc("commander_profile_save", json!({"name": get::<Option<String>>(args, "name")?, "soul": get::<Option<String>>(args, "soul")?, "user": get::<Option<String>>(args, "user")?, "reason": get::<Option<String>>(args, "reason")?})),
        "commander_revision_restore" => ctx.rpc("commander_revision_restore", json!({"file": get::<String>(args, "file")?, "at": get::<String>(args, "at")?})),
        "commander_memory" => ctx.rpc("commander_memory", json!({})),
        "commander_memory_save" => ctx.rpc("commander_memory_save", json!({"memory": get::<Value>(args, "memory")?})),
        "project_objective_set" => ctx.rpc("project_objective_set", json!({"project": get::<String>(args, "project")?, "objective": get::<Option<String>>(args, "objective")?})),
        "commander_settings_set" => {
            // Raw body: an explicit `null` clears a setting, an absent key leaves it alone.
            let body = args.as_object().ok_or("commander_settings_set expects a JSON object")?;
            let mut p = serde_json::Map::new();
            for key in ["account", "model"] {
                if let Some(value) = body.get(key) { p.insert(key.into(), value.clone()); }
            }
            ctx.rpc("commander_settings_set", Value::Object(p))
        }
        "login_state" => ctx.rpc("login_state", json!({"account": get::<String>(args, "account")?})),
        "auth_status" => ctx.rpc("auth_status", json!({"account": get::<String>(args, "account")?})),
        "auth_check" => ctx.rpc("auth_check", json!({"account": get::<String>(args, "account")?})),
        "account_models" => ctx.rpc("account_models", json!({"account": get::<String>(args, "account")?})),
        "account_usage" => ctx.rpc("account_usage", json!({"account": get::<String>(args, "account")?})),
        "consume_reset" => ctx.rpc("consume_reset", json!({"account": get::<String>(args, "account")?, "creditId": get::<String>(args, "credit_id")?, "idempotencyKey": get::<String>(args, "idempotency_key")?})),
        "day_summary" => ctx.rpc("day_summary", json!({"date": get::<String>(args, "date")?})),
        "summarize_day" => ctx.rpc("summarize_day", json!({"date": get::<String>(args, "date")?, "force": get::<Option<bool>>(args, "force")?.unwrap_or(false)})),
        "launch" => ctx.rpc("launch", json!({"project": get::<String>(args, "project")?, "account": get::<Option<String>>(args, "account")?, "prompt": get::<String>(args, "prompt")?, "existing": get::<Option<String>>(args, "existing")?, "options": get::<Option<Value>>(args, "options")?})),
        "list_slash_commands" => ctx.rpc("list_slash_commands", json!({"session": get::<Option<String>>(args, "session")?, "project": get::<Option<String>>(args, "project")?, "account": get::<Option<String>>(args, "account")?})),
        "list_project_files" => ctx.rpc("list_project_files", json!({"session": get::<Option<String>>(args, "session")?, "project": get::<Option<String>>(args, "project")?})),
        "queue_message" => ctx.rpc("queue_message", json!({"session": get::<String>(args, "session")?, "prompt": get::<String>(args, "prompt")?, "options": get::<Value>(args, "options")?})),
        "steer_message" => ctx.rpc("steer_message", json!({"session": get::<String>(args, "session")?, "prompt": get::<String>(args, "prompt")?, "options": get::<Value>(args, "options")?})),
        "queue_action" => ctx.rpc("queue_action", json!({"session": get::<String>(args, "session")?, "action": get::<String>(args, "action")?, "message": get::<Option<String>>(args, "message")?, "prompt": get::<Option<String>>(args, "prompt")?})),
        "stop" => ctx.rpc("stop", json!({"session": get::<String>(args, "session")?})),
        "stop_all" => ctx.rpc("stop_all", json!({})),
        "respond" => ctx.rpc("respond", json!({"session": get::<String>(args, "session")?, "requestId": get::<String>(args, "request_id")?, "allow": get::<bool>(args, "allow")?, "answers": get::<Value>(args, "answers")?})),
        // Paths are HOST paths: the satellite converts local files into uploads before calling.
        "stage_attachments" => ctx.rpc("stage_attachments", json!({"paths": get::<Vec<String>>(args, "paths")?})),
        "thread_action" => ctx.rpc("thread_action", json!({"session": get::<String>(args, "session")?, "action": get::<String>(args, "action")?, "project": get::<Option<String>>(args, "project")?})),
        "mark_read" => ctx.rpc("mark_read", json!({"thread": get::<String>(args, "thread")?, "at": get::<u64>(args, "at")?})),
        "merge_read" => ctx.rpc("merge_read", json!({"cursors": get::<Value>(args, "cursors")?})),
        "rename_session" => ctx.rpc("rename_session", json!({"session": get::<String>(args, "session")?, "title": get::<String>(args, "title")?})),
        "remove_worktree" => ctx.rpc("remove_worktree", json!({"session": get::<String>(args, "session")?})),
        "save_schedule" => {
            let schedule: Value = get(args, "schedule")?;
            // Old hosts ignore unknown JSON fields; never silently discard routine controls.
            if crate::companion_operations::schedule_needs_hello(&schedule) {
                let hello = ctx.rpc("hello", json!({}))?;
                crate::companion_operations::require_schedule_support(&schedule, &hello)?;
            }
            ctx.rpc("save_schedule", json!({"schedule": schedule}))
        }
        "schedule_action" => ctx.rpc("schedule_action", json!({"schedule": get::<String>(args, "schedule")?, "action": get::<String>(args, "action")?})),
        "google_accounts" => ctx.rpc("google_accounts", json!({})),
        "google_disconnect" => ctx.rpc("google_disconnect", json!({"email": get::<String>(args, "email")?})),
        "google_triggers" => ctx.rpc("google_triggers", json!({})),
        "google_trigger_save" => ctx.rpc("google_trigger_save", json!({"trigger": get::<Value>(args, "trigger")?})),
        "google_trigger_delete" => ctx.rpc("google_trigger_delete", json!({"id": get::<String>(args, "id")?})),
        "git_commit_message_start" => ctx.rpc("commit_message_start", json!({"project": get::<String>(args, "project")?, "stat": get::<String>(args, "stat")?, "diff": get::<String>(args, "diff")?})),
        "git_commit_message_state" => ctx.rpc("commit_message_state", json!({"project": get::<String>(args, "project")?})),

        // ---- free functions against the host's data root ----
        "load_project_order" => ser(crate::thread_list_settings::project_order(root)?),
        "save_project_order" => ser(crate::thread_list_settings::save_project_order(root, &get::<Vec<String>>(args, "order")?)?),
        "load_account_order" => ser(crate::thread_list_settings::load_account_order(root)?),
        "save_account_order" => {
            crate::thread_list_settings::save_account_order(root, &get::<Vec<String>>(args, "order")?)?;
            // Same as the desktop command: the next snapshot_since must be answered in full so it carries the new order.
            desktop::ACCOUNT_ORDER_DIRTY.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(Value::Null)
        }
        "save_thread_list" => {
            let settings: crate::thread_list_settings::ThreadListSettings = get(args, "settings")?;
            let dir = root.join("companion");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let temporary = dir.join("thread-list.json.tmp");
            std::fs::write(&temporary, serde_json::to_vec(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            std::fs::rename(temporary, dir.join("thread-list.json")).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "agent_config" => {
            let request: freddai_core::agent_config::Request = serde_json::from_value(get::<Value>(args, "request")?).map_err(|e| format!("agent config request: {e}"))?;
            freddai_core::agent_config::handle(root, request)
        }
        "preview_attachment" => ser(freddai_core::attachments::preview(root, &get::<String>(args, "id")?)?),
        "google_capability" => Ok(crate::companion_operations::google_capability(&ctx.rpc("hello", json!({}))?)),
        "startup_status" => Ok(json!(desktop::startup_status())),
        "set_start_at_login" => {
            desktop::configure_start_at_login(ctx.host()?, get::<bool>(args, "enabled")?)?;
            Ok(Value::Null)
        }
        "restart_host_now" => ser(desktop::force_upgrade_host(ctx.host()?)?),
        "companion_devices" => crate::companion_pairing::status(root),
        "companion_device_action" => {
            let (action, id): (String, String) = (get(args, "action")?, get(args, "id")?);
            // Desktop also (re)starts the companion server on "begin"; this process already is that server.
            if action == "begin" { crate::companion_pairing::provision(root)?; }
            crate::companion_pairing::control(root, &action, &id)
        }
        "awake_status" => crate::awake::status(root),
        "awake_set_settings" => {
            crate::awake::save_settings(root, &crate::awake::AwakeSettings { while_working: get(args, "while_working")?, while_paired: get(args, "while_paired")? })?;
            crate::awake::status(root)
        }

        // ---- git (blocking, in this process) ----
        "git_history" => ser(crate::git_history::read(&get::<String>(args, "path")?)?),
        "git_status" => ser(crate::git_actions::status(&get::<String>(args, "path")?)?),
        "git_diff_file" => ser(crate::git_actions::diff_file(&get::<String>(args, "path")?, &get::<String>(args, "file")?, &get::<String>(args, "group")?)?),
        "git_stage" => {
            let path: String = get(args, "path")?;
            match get::<Option<Vec<String>>>(args, "files")? { Some(f) => crate::git_actions::stage(&path, &f)?, None => crate::git_actions::stage_all(&path)? }
            Ok(Value::Null)
        }
        "git_unstage" => {
            let path: String = get(args, "path")?;
            match get::<Option<Vec<String>>>(args, "files")? { Some(f) => crate::git_actions::unstage(&path, &f)?, None => crate::git_actions::unstage_all(&path)? }
            Ok(Value::Null)
        }
        "git_discard" => {
            crate::git_actions::discard(&get::<String>(args, "path")?, &get::<String>(args, "file")?, &get::<String>(args, "group")?, &get::<String>(args, "code")?)?;
            Ok(Value::Null)
        }
        "git_commit" => ser(crate::git_actions::commit(&get::<String>(args, "path")?, &get::<String>(args, "message")?, get::<Option<bool>>(args, "all")?.unwrap_or(false))?),
        "git_push" => ser(crate::git_actions::push(&get::<String>(args, "path")?)?),
        "git_pull" => ser(crate::git_actions::pull(&get::<String>(args, "path")?)?),
        "git_branches" => ser(crate::git_actions::branches(&get::<String>(args, "path")?)?),
        "git_switch_branch" => {
            crate::git_actions::switch_branch(&get::<String>(args, "path")?, &get::<String>(args, "name")?, get::<Option<bool>>(args, "create")?.unwrap_or(false))?;
            Ok(Value::Null)
        }
        "git_pr_status" => ser(crate::git_actions::pr_status(&get::<String>(args, "path")?)),
        "git_create_pr" => ser(crate::git_actions::create_pr(&get::<String>(args, "path")?, &get::<String>(args, "title")?, &get::<String>(args, "body")?)?),
        "git_ship_preview" => ser(crate::git_actions::ship_preview(&get::<String>(args, "path")?)?),

        // ---- terminal (headless PTY, polled) ----
        "terminal_open" => ser(terminals::open(&get::<String>(args, "cwd")?, get(args, "cols")?, get(args, "rows")?)?),
        "terminal_write" => { terminals::write(get(args, "id")?, &get::<String>(args, "data")?)?; Ok(Value::Null) }
        "terminal_resize" => { terminals::resize(get(args, "id")?, get(args, "cols")?, get(args, "rows")?)?; Ok(Value::Null) }
        "terminal_close" => { terminals::close(get(args, "id")?)?; Ok(Value::Null) }
        "terminal_poll" => terminals::poll(get(args, "id")?, get::<Option<u64>>(args, "after")?.unwrap_or(0)),

        _ => Err(format!("Unknown desktop command: {command}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::{BufRead, BufReader, Write}, os::unix::net::UnixListener, sync::mpsc};

    /// Fake host answering `replies` in order; returns (root, received requests, join handle).
    fn fake_host(tag: &str, replies: Vec<(&'static str, Value)>) -> (PathBuf, mpsc::Receiver<Value>, std::thread::JoinHandle<()>) {
        let root = std::env::temp_dir().join(format!("fr-sat-{tag}-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            for (method, reply) in replies {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], method);
                tx.send(request).unwrap();
                writeln!(connection, "{}", json!({"result": reply})).unwrap();
            }
        });
        (root.clone(), rx, handle)
    }
    fn run_with(root: &Path, command: &str, args: Value) -> Result<Value, String> {
        let make = || Ok(Host::new(root.to_path_buf(), PathBuf::from("/fake/freddai")));
        dispatch_with(root, &make, command, &args)
    }

    #[test]
    fn respond_forwards_with_host_payload_names() {
        let (root, rx, host) = fake_host("respond", vec![("respond", json!({"ok": true}))]);
        let out = run_with(&root, "respond", json!({"session":"s","requestId":"r","allow":true,"answers":{}})).unwrap();
        assert_eq!(out, json!({"ok": true}));
        assert_eq!(rx.recv().unwrap()["params"], json!({"session":"s","requestId":"r","allow":true,"answers":{}}));
        host.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snake_case_args_are_accepted_too() {
        let (root, rx, host) = fake_host("snake", vec![("respond", json!(null))]);
        run_with(&root, "respond", json!({"session":"s","request_id":"r","allow":false,"answers":{"q":"a"}})).unwrap();
        assert_eq!(rx.recv().unwrap()["params"]["requestId"], "r");
        host.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }

    /// One test owns the process-wide ACCOUNT_ORDER_DIRTY flag so parallel tests cannot interleave with it.
    #[test]
    fn snapshot_since_payload_and_account_order_forcing_a_full_snapshot() {
        let current = json!({"desktopProjection": true, "build": "/fake/freddai"});
        let (root, rx, host) = fake_host("since", vec![
            ("snapshot_since", current.clone()),
            ("snapshot_since", current.clone()),
            ("snapshot", current.clone()),
            ("hello", json!({"build": "/fake/freddai"})),
        ]);
        desktop::ACCOUNT_ORDER_DIRTY.store(false, std::sync::atomic::Ordering::SeqCst);
        run_with(&root, "snapshot_since", json!({"revision":3,"hostId":"h","openThreads":["t"]})).unwrap();
        assert_eq!(rx.recv().unwrap()["params"], json!({"revision":3,"hostId":"h","messageDeltas":false,"openThreads":["t"]}));
        run_with(&root, "snapshot_since", json!({"revision":4})).unwrap();
        let p = rx.recv().unwrap()["params"].clone();
        assert_eq!(p["messageDeltas"], true);
        assert!(p["openThreads"].is_null());
        // Saving the account order makes the next snapshot_since a full snapshot, like the desktop command.
        run_with(&root, "save_account_order", json!({"order":["b","a"]})).unwrap();
        assert_eq!(run_with(&root, "load_account_order", json!({})).unwrap(), json!(["b", "a"]));
        let full = run_with(&root, "snapshot_since", json!({"revision":5})).unwrap();
        assert_eq!(full["hostId"], "reorder");
        host.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn commander_settings_set_keeps_explicit_nulls() {
        let (root, rx, host) = fake_host("cmd-set", vec![("commander_settings_set", json!(null))]);
        run_with(&root, "commander_settings_set", json!({"account":null,"model":"m","ignored":1})).unwrap();
        assert_eq!(rx.recv().unwrap()["params"], json!({"account":null,"model":"m"}));
        host.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn blocked_and_satellite_commands_error_without_touching_the_host() {
        // No host socket exists: any host call would fail with "host is unavailable", not these messages.
        let root = std::env::temp_dir().join("fr-sat-no-host");
        for command in ["google_config_get", "google_connect_start", "login", "cancel_login"] {
            let e = run_with(&root, command, json!({})).unwrap_err();
            assert!(e.contains("original Mac"), "{command}: {e}");
        }
        for command in ["preview_open", "voice_status", "bug_walk_start", "scout_state", "satellite_mode", "platform", "check_for_updates", "open_thread_window"] {
            let e = run_with(&root, command, json!({})).unwrap_err();
            assert_eq!(e, format!("{command} runs on the satellite Mac, not the host"));
        }
        assert_eq!(run_with(&root, "vscode_available", json!(null)).unwrap(), json!(false));
    }

    #[test]
    fn unknown_command_errors() {
        let root = std::env::temp_dir().join("fr-sat-no-host");
        assert_eq!(run_with(&root, "format_disk", json!({})).unwrap_err(), "Unknown desktop command: format_disk");
    }

    #[test]
    fn missing_required_argument_is_named() {
        let root = std::env::temp_dir().join("fr-sat-no-host");
        assert!(run_with(&root, "stop", json!({})).unwrap_err().contains("`session`"));
    }

    #[test]
    fn read_only_classification() {
        for c in ["snapshot_since", "terminal_poll", "git_status", "load_account_order", "commander_memory"] { assert!(is_read_only(c), "{c}"); }
        for c in ["respond", "launch", "terminal_write", "git_push", "save_account_order", "unknown"] { assert!(!is_read_only(c), "{c}"); }
    }
}
