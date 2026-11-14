//! Local host: Unix sockets on macOS/Linux, owner-restricted named pipes on Windows.
#[cfg(windows)]
#[path = "windows_host.rs"]
mod windows_host;
use crate::runtime::Runtime;
#[cfg(unix)]
use std::io::Write;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::{
    fs::PermissionsExt,
    net::{UnixListener, UnixStream},
};
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::Duration,
};
pub const VERSION: &str = "2";
/// Upper bound for one newline-delimited host message (snapshot replies carry every transcript).
pub const MAX_HOST_MESSAGE_BYTES: u64 = 512 * 1024 * 1024;
/// Read one newline-terminated message, failing loudly if it was truncated by `cap` or is not valid JSON.
fn read_json_line(reader: impl Read, cap: u64, method: &str) -> Result<Value, String> {
    let mut line = String::new();
    BufReader::new(reader)
        .take(cap)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let n = line.len();
    let invalid = |reason: String| {
        eprintln!(
            "{}",
            json!({"event":"host_call.invalid_reply","method":method,"bytes":n,"cap":cap,"reason":reason})
        );
        reason
    };
    if !line.ends_with('\n') && n as u64 >= cap {
        return Err(invalid(format!(
            "Host reply for `{method}` exceeded {cap} bytes and was truncated"
        )));
    }
    serde_json::from_str(&line).map_err(|e| {
        invalid(format!(
            "Invalid host response for `{method}` ({n} bytes): {e}"
        ))
    })
}
#[cfg(unix)]
pub fn call(root: &Path, method: &str, params: Value) -> Result<Value, String> {
    let mut socket = UnixStream::connect(root.join("host.sock"))
        .map_err(|_| "Freddai host is unavailable. Reopen the app to recover.".to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_secs(40)))
        .map_err(|e| e.to_string())?;
    socket
        .set_write_timeout(Some(Duration::from_secs(40)))
        .map_err(|e| e.to_string())?;
    writeln!(
        socket,
        "{}",
        json!({"version":VERSION,"method":method,"params":params})
    )
    .map_err(|e| e.to_string())?;
    let scope: Option<Vec<String>> = if matches!(method, "snapshot" | "snapshot_since") {
        params.get("openThreads").filter(|v| v.is_array()).map(|v| serde_json::from_value(v.clone())).transpose().map_err(|e| format!("Invalid desktop scope: {e}"))?
    } else { None };
    let mut reply = if let Some(open) = scope {
        crate::desktop_snapshot::read_reply(socket.take(MAX_HOST_MESSAGE_BYTES), &open)
            .map_err(|e| format!("Invalid or truncated desktop snapshot: {e}"))?
    } else { read_json_line(socket, MAX_HOST_MESSAGE_BYTES, method)? };
    if let Some(error) = reply["error"].as_str() {
        return Err(error.into());
    }
    Ok(reply["result"].take())
}
pub fn dispatch(rt: &Runtime, method: &str, p: Value) -> Result<Value, String> {
    fn text(p: &Value, key: &str) -> Result<String, String> {
        p[key]
            .as_str()
            .map(String::from)
            .ok_or_else(|| format!("Missing {key}"))
    }
    fn optional(p: &Value, key: &str) -> Option<String> {
        p[key].as_str().map(String::from)
    }
    Ok(match method {
        "hello" => {
            json!({"version":VERSION,"schedule_end_dates":true,"schedule_run_limits":true,"schedule_delivery":true,"mcp_bridge":1,"google_accounts":1,"model_configuration":1,"build":std::env::current_exe().ok().map(|p|p.to_string_lossy().into_owned())})
        }
        "upgrade_idle" => {
            rt.prepare_upgrade()?;
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_millis(150));
                std::process::exit(0)
            });
            Value::Null
        }
        "upgrade_force" => {
            let interrupted = rt.force_upgrade()?;
            eprintln!(
                "{}",
                json!({"event":"host_upgrade.forced","interrupted":interrupted})
            );
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_millis(150));
                std::process::exit(0)
            });
            json!({"interrupted":interrupted})
        }
        "mcp_tool" => crate::mcp::dispatch(rt, &text(&p, "name")?, p.get("arguments").cloned().unwrap_or(json!({})), &crate::mcp::Context {
            project: p["context"]["project"].as_str().map(str::to_owned),
            thread: p["context"]["thread"].as_str().map(str::to_owned),
        })?,
        "mcp_is_commander" => json!(crate::mcp::is_commander_context(rt, &crate::mcp::Context {
            project: p["context"]["project"].as_str().map(str::to_owned),
            thread: p["context"]["thread"].as_str().map(str::to_owned),
        })),
        m if crate::commander::is_host_command(m) => crate::commander::host_call(rt, m, &p)?,
        m if crate::google::triggers::is_host_command(m) => crate::google::triggers::host_call(rt, m, &p)?,
        m if crate::google::is_host_command(m) => crate::google::host_call(&rt.root_dir(), m, &p)?,
        "snapshot" => {
            let (db, wait, held) = rt.snapshot_timed();
            let t = std::time::Instant::now();
            let value = json!(db);
            crate::timing::log(
                "host",
                format_args!(
                    "ev=snapshot_served lock_wait_ms={wait:.2} clone_ms={held:.2} to_value_ms={:.2} sessions={}",
                    crate::timing::ms(t),
                    db.sessions.len()
                ),
            );
            value
        }
        "snapshot_since" => {
            let revision = p["revision"].as_u64().unwrap_or(0);
            let open: Option<Vec<String>> = p.get("openThreads").filter(|v| !v.is_null()).map(|v| serde_json::from_value(v.clone())).transpose().map_err(|e| format!("Invalid thread scope: {e}"))?;
            let (mut value, wait, held, sent, total) = match open {
                Some(ids) => rt.snapshot_for_desktop(revision, p["hostId"].as_str(), &ids),
                None => rt.snapshot_since_with_messages(revision, p["hostId"].as_str(), p["messageDeltas"].as_bool().unwrap_or(false)),
            };
            value["build"] = json!(std::env::current_exe()
                .ok()
                .map(|p| p.to_string_lossy().into_owned()));
            crate::timing::log(
                "host",
                format_args!(
                    "ev=snapshot_since_served client_revision={revision} revision={} unchanged={} lock_wait_ms={wait:.2} clone_ms={held:.2} sessions_sent={sent} sessions_total={total}",
                    value["revision"],
                    value["unchanged"].as_bool().unwrap_or(false)
                ),
            );
            value
        }
        "companion_snapshot" => rt.companion_snapshot(p["thread"].as_str())?,
        "thread_history" => rt.thread_history(&text(&p, "thread")?, p["before"].as_str())?,
        "generated_file" => rt.generated_file(&text(&p, "thread")?, &text(&p, "href")?, p["offset"].as_u64().unwrap_or(0), p["length"].as_u64())?,
        "tool_text" => rt.tool_text(&text(&p, "thread")?, &text(&p, "message")?, p["offset"].as_u64().unwrap_or(0) as usize, p["hash"].as_str())?,
        "detect_agents" => json!(crate::runtime::detect_agents()),
        "detect_existing_sign_ins" => json!(crate::runtime::detect_existing_sign_ins()),
        "save_claude_login" => json!(rt.connect_existing_named("claude", Some(&text(&p, "name")?), Some(&text(&p, "color")?))?),
        "connect_existing" => json!(rt.connect_existing_named(&text(&p, "provider")?, p["name"].as_str(), p["color"].as_str())?),
        "rename_account" => {
            rt.rename_account(&text(&p, "account")?, &text(&p, "name")?)?;
            Value::Null
        }
        "remove_account" => {
            rt.remove_account(&text(&p, "account")?)?;
            Value::Null
        }
        "add_account" => {
            json!(rt.account(text(&p, "name")?, text(&p, "provider")?, text(&p, "color")?)?)
        }
        "import_project" => json!(rt.import_project(&text(&p, "path")?, text(&p, "color")?)?),
        "import_candidates" => json!(rt.import_candidates()?),
        "import_sessions" => json!(rt.import_sessions(
            serde_json::from_value(p["sessions"].clone())
                .map_err(|e| format!("Invalid import request: {e}"))?
        )?),
        "update_project_organization" => {
            let name = text(&p, "name")?.trim().to_owned();
            let color = text(&p, "color")?;
            if name.is_empty() || name.len() > 200 || color.len() != 7 || !color.starts_with('#') || !color[1..].bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Invalid project name or color".into());
            }
            rt.update_project(&text(&p, "project")?, |project| { project.name = name; project.color = color; })?;
            Value::Null
        }
        "save_project" => json!(
            rt.project(serde_json::from_value(p["project"].clone()).map_err(|e| e.to_string())?)?
        ),
        "save_preferences" => {
            if p["patch"].is_object() {
                rt.preferences_patch(p["patch"].clone())?;
            } else {
                rt.preferences(
                    serde_json::from_value(p["preferences"].clone()).map_err(|e| e.to_string())?,
                )?;
            }
            Value::Null
        }
        "consume_reset" => json!(rt.consume_reset(
            &text(&p, "account")?,
            &text(&p, "creditId")?,
            &text(&p, "idempotencyKey")?
        )?),
        "account_models" => rt.account_models(&text(&p, "account")?)?,
        "account_usage" => json!(rt.account_usage(&text(&p, "account")?)?),
        "login" => {
            rt.login(&text(&p, "account")?)?;
            Value::Null
        }
        "login_state" => json!(rt.login_state(&text(&p, "account")?)),
        "cancel_login" => {
            rt.cancel_login(&text(&p, "account")?);
            Value::Null
        }
        "auth_check" => {
            let state = serde_json::to_value(rt.auth_check(&text(&p, "account")?)?).map_err(|e| e.to_string())?;
            let mut state = state;
            state["expired_accounts"] = json!(crate::runtime::auth_expired_accounts());
            state
        }
        "auth_status" => json!(rt.auth_status(&text(&p, "account")?)?),
        "launch" => json!(rt.launch_with(
            text(&p, "project")?,
            optional(&p, "account"),
            text(&p, "prompt")?,
            optional(&p, "existing"),
            serde_json::from_value(
                p.get("options")
                    .filter(|x| !x.is_null())
                    .cloned()
                    .unwrap_or(json!({}))
            )
            .map_err(|e| e.to_string())?
        )?),
        "hidden_launch" => json!(rt.launch_hidden(
            text(&p, "project")?,
            optional(&p, "account"),
            text(&p, "prompt")?,
            serde_json::from_value(p.get("options").filter(|x| !x.is_null()).cloned().unwrap_or(json!({}))).map_err(|e| e.to_string())?
        )?),
        "hidden_result" => rt.hidden_result(&text(&p, "session")?)?,
        "hidden_purge" => json!(rt.purge_hidden(p["session"].as_str())?),
        "list_slash_commands" => {
            let (account, dir) = rt.composer_context(
                optional(&p, "session").as_deref(),
                optional(&p, "project").as_deref(),
                optional(&p, "account").as_deref(),
            )?;
            let account = account.ok_or("Choose an agent account to list its slash commands")?;
            let home =
                crate::commands::default_home(&account.provider, account.config_home.as_deref());
            json!(crate::commands::discover(
                &account.provider,
                home.as_deref(),
                dir.as_deref(),
                optional(&p, "session").as_deref()
            ))
        }
        "list_project_files" => {
            let (_, dir) = rt.composer_context(
                optional(&p, "session").as_deref(),
                optional(&p, "project").as_deref(),
                None,
            )?;
            json!(crate::commands::list_files(
                &dir.ok_or("Choose a project to list its files")?
            )?)
        }
        "queue_message" => {
            rt.queue_message(
                &text(&p, "session")?,
                text(&p, "prompt")?,
                serde_json::from_value(p["options"].clone()).map_err(|e| e.to_string())?,
            )?;
            // Persist first, then dispatch eligible FIFO work now rather than waiting
            // for the two-second scheduler tick. Busy and paused queues stay queued.
            rt.queue_tick();
            Value::Null
        }
        "steer_message" => {
            rt.steer_message(
                &text(&p, "session")?,
                text(&p, "prompt")?,
                serde_json::from_value(p["options"].clone()).map_err(|e| e.to_string())?,
            )?;
            Value::Null
        }
        "queue_action" if p["action"] == "edit" => {
            rt.edit_queued_message(
                &text(&p, "session")?,
                &text(&p, "message")?,
                text(&p, "prompt")?,
            )?;
            Value::Null
        }
        "queue_action" => {
            rt.queue_action(
                &text(&p, "session")?,
                &text(&p, "action")?,
                p["message"].as_str(),
            )?;
            if p["action"] == "resume" {
                rt.queue_tick();
            }
            Value::Null
        }
        "stop" => {
            rt.stop(&text(&p, "session")?)?;
            Value::Null
        }
        "respond" => {
            rt.respond(
                &text(&p, "session")?,
                &text(&p, "requestId")?,
                p["allow"].as_bool().unwrap_or(false),
                p["answers"].clone(),
            )?;
            Value::Null
        }
        "stage_attachments" => json!(rt.stage_attachments(
            serde_json::from_value(p["paths"].clone()).map_err(|e| e.to_string())?
        )?),
        "thread_action" => {
            rt.thread_action(
                &text(&p, "session")?,
                &text(&p, "action")?,
                p["project"].as_str(),
            )?;
            Value::Null
        }
        "rename_session" => {
            rt.rename_session(&text(&p, "session")?, &text(&p, "title")?)?;
            Value::Null
        }
        "remove_worktree" => {
            rt.remove_worktree(&text(&p, "session")?)?;
            Value::Null
        }
        "schedule_notifications" => serde_json::to_value(rt.schedule_notifications()).map_err(|e|e.to_string())?,
        "ack_schedule_notification" => { rt.acknowledge_schedule_notification(&text(&p,"notice")?)?; Value::Null }
        "save_schedule" => {
            rt.save_schedule(
                serde_json::from_value(p["schedule"].clone()).map_err(|e| e.to_string())?,
            )?;
            Value::Null
        }
        "schedule_action" => {
            rt.schedule_action(&text(&p, "schedule")?, &text(&p, "action")?)?;
            Value::Null
        }
        "mark_read" => {
            rt.mark_read(&text(&p, "thread")?, p["at"].as_u64().ok_or("Missing at")?)?;
            Value::Null
        }
        "merge_read" => {
            let cursors = p["cursors"].as_object().ok_or("Missing cursors")?;
            let list = cursors
                .iter()
                .filter_map(|(id, at)| at.as_u64().map(|at| (id.clone(), at)))
                .collect::<Vec<_>>();
            json!({"unknown": rt.merge_read(&list)?})
        }
        "day_summary" => crate::day_summary::state(rt, &text(&p, "date")?)?,
        "summarize_day" => crate::day_summary::start(
            rt,
            &text(&p, "date")?,
            p["force"].as_bool().unwrap_or(false),
        )?,
        "commit_message_start" => crate::commit_message::start(
            rt,
            &text(&p, "project")?,
            &text(&p, "stat")?,
            &text(&p, "diff")?,
        )?,
        "commit_message_state" => crate::commit_message::state(&text(&p, "project")?),
        "stop_all" => {
            rt.stop_all();
            Value::Null
        }
        _ => return Err(format!("Unknown host command: {method}")),
    })
}
#[cfg(unix)]
static SHUTDOWN_SIGNAL: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
#[cfg(unix)]
extern "C" fn on_shutdown_signal(sig: libc::c_int) {
    SHUTDOWN_SIGNAL.store(sig, std::sync::atomic::Ordering::SeqCst);
}
/// Persistence is debounced, so a terminating signal must flush before the process dies.
/// The handler only sets a flag (async-signal-safe); a watcher thread flushes and re-raises.
#[cfg(unix)]
fn install_shutdown_flush(rt: Runtime) {
    unsafe {
        for sig in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::signal(
                sig,
                on_shutdown_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
            );
        }
    }
    std::thread::spawn(move || loop {
        let sig = SHUTDOWN_SIGNAL.load(std::sync::atomic::Ordering::SeqCst);
        if sig != 0 {
            if let Err(e) = rt.flush() {
                eprintln!("Workspace flush on shutdown failed: {e}");
            }
            unsafe {
                libc::signal(sig, libc::SIG_DFL);
                libc::raise(sig);
            }
            std::process::exit(128 + sig);
        }
        std::thread::sleep(Duration::from_millis(50));
    });
}
pub fn serve(root: PathBuf) -> Result<(), String> {
    use fs2::FileExt;
    crate::runtime::private_dir(&root)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("host.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock_exclusive()
        .map_err(|_| "A Freddai host already owns this workspace")?;
    let rt = Runtime::open(root.clone())?;
    // Loud, but not fatal: the rest of the app must still work if the Commander folder is unusable.
    if let Err(error) = rt.ensure_commander() {
        eprintln!("{}", json!({"event":"commander.ensure_failed","error":error}));
    }
    #[cfg(unix)]
    install_shutdown_flush(rt.clone());
    let scheduler = rt.clone();
    std::thread::spawn(move || loop {
        scheduler.scheduler_tick();
        scheduler.queue_tick();
        crate::commander_autonomy::tick(&scheduler);
        std::thread::sleep(Duration::from_secs(2));
    });
    // Google triggers poll on their own thread: blocking HTTP must never stall the tick above.
    // (Also covers Windows: `windows_host::serve` below shares this start path.)
    crate::google::triggers::spawn_poller(rt.clone());
    #[cfg(windows)]
    return windows_host::serve(&root, rt);
    #[cfg(unix)]
    {
    let path = root.join("host.sock");
    if path.exists() { fs::remove_file(&path).map_err(|e|e.to_string())?; }
    let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    for socket in listener.incoming() {
        let Ok(mut socket) = socket else { continue };
        let rt = rt.clone();
        std::thread::spawn(move || {
            let _ = socket.set_read_timeout(Some(Duration::from_secs(10)));
            let mut line = String::new();
            let mut method = String::new();
            let result = (|| {
                BufReader::new(socket.try_clone().map_err(|e| e.to_string())?)
                    .take(MAX_HOST_MESSAGE_BYTES)
                    .read_line(&mut line)
                    .map_err(|e| e.to_string())?;
                let req: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                if req["version"] != VERSION {
                    return Err(
                        "Host version mismatch. Stop active work and restart the background host."
                            .into(),
                    );
                }
                method = req["method"].as_str().unwrap_or("").to_string();
                dispatch(&rt, &method, req["params"].clone())
            })();
            let reply = match result {
                Ok(result) => {
                    let mut envelope = serde_json::Map::new();
                    envelope.insert("result".into(), result);
                    Value::Object(envelope)
                },
                Err(error) => json!({"error":error}),
            };
            let t = std::time::Instant::now();
            let mut writer = std::io::BufWriter::new(&mut socket);
            let written = serde_json::to_writer(&mut writer, &reply)
                .map_err(std::io::Error::other)
                .and_then(|_| writer.write_all(b"\n"))
                .and_then(|_| writer.flush());
            if method.starts_with("snapshot") {
                crate::timing::log(
                    "host",
                    format_args!(
                        "ev=snapshot_reply method={method} write_ms={:.2} success={}",
                        crate::timing::ms(t),
                        written.is_ok()
                    ),
                );
            }

        });
    }
    Ok(())
    }
}
#[cfg(windows)]
pub fn call(root: &Path, method: &str, params: Value) -> Result<Value, String> {
    windows_host::call(root, method, params)
}

#[cfg(test)]
mod tests {
    use super::read_json_line;
    #[test]
    fn truncated_reply_is_explicit() {
        let data = format!("{{\"result\":\"{}\"}}\n", "x".repeat(100));
        let e = read_json_line(data.as_bytes(), 50, "snapshot").unwrap_err();
        assert!(
            e.contains("`snapshot` exceeded 50 bytes and was truncated"),
            "{e}"
        );
    }
    #[test]
    fn invalid_reply_names_method_and_size() {
        let e = read_json_line(&b"nope\n"[..], 1024, "snapshot").unwrap_err();
        assert!(
            e.contains("Invalid host response for `snapshot` (5 bytes)"),
            "{e}"
        );
    }
    #[test]
    fn valid_reply_parses() {
        assert_eq!(
            read_json_line(&b"{\"result\":1}\n"[..], 1024, "x").unwrap()["result"],
            1
        );
    }
}
