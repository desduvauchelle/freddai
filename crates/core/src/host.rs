//! Local Unix-socket host. Never exposes a TCP endpoint or provider credentials.
use crate::runtime::Runtime;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::{
    fs::PermissionsExt,
    net::{UnixListener, UnixStream},
};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
pub const VERSION: &str = "2";
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
    let mut line = String::new();
    BufReader::new(socket)
        .take(32 * 1024 * 1024)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let reply: Value = serde_json::from_str(&line).map_err(|_| "Invalid host response")?;
    if let Some(error) = reply["error"].as_str() {
        return Err(error.into());
    }
    Ok(reply["result"].clone())
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
            json!({"version":VERSION,"build":std::env::current_exe().ok().map(|p|p.to_string_lossy().into_owned())})
        }
        "upgrade_idle" => {
            rt.prepare_upgrade()?;
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_millis(150));
                std::process::exit(0)
            });
            Value::Null
        }
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
            let (mut value, wait, held, sent, total) =
                rt.snapshot_since(revision, p["hostId"].as_str());
            value["build"] = json!(std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned()));
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
        "detect_agents" => json!(crate::runtime::detect_agents()),
        "detect_existing_sign_ins" => json!(crate::runtime::detect_existing_sign_ins()),
        "connect_existing" => json!(rt.connect_existing(&text(&p, "provider")?)?),
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
        "save_project" => json!(
            rt.project(serde_json::from_value(p["project"].clone()).map_err(|e| e.to_string())?)?
        ),
        "save_preferences" => {
            rt.preferences(
                serde_json::from_value(p["preferences"].clone()).map_err(|e| e.to_string())?,
            )?;
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
        "queue_message" => {
            rt.queue_message(&text(&p, "session")?, text(&p, "prompt")?, serde_json::from_value(p["options"].clone()).map_err(|e| e.to_string())?)?;
            Value::Null
        }
        "steer_message" => {
            rt.steer_message(&text(&p, "session")?, text(&p, "prompt")?, serde_json::from_value(p["options"].clone()).map_err(|e| e.to_string())?)?;
            Value::Null
        }
        "queue_action" if p["action"] == "edit" => {
            rt.edit_queued_message(&text(&p, "session")?, &text(&p, "message")?, text(&p, "prompt")?)?;
            Value::Null
        }
        "queue_action" => {
            rt.queue_action(&text(&p, "session")?, &text(&p, "action")?, p["message"].as_str())?;
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
            rt.thread_action(&text(&p, "session")?, &text(&p, "action")?, p["project"].as_str())?;
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
            libc::signal(sig, on_shutdown_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
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
#[cfg(unix)]
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
    let path = root.join("host.sock");
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    let rt = Runtime::open(root.clone())?;
    let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    install_shutdown_flush(rt.clone());
    let scheduler = rt.clone();
    std::thread::spawn(move || loop {
        scheduler.scheduler_tick();
        scheduler.queue_tick();
        std::thread::sleep(Duration::from_secs(2));
    });
    for socket in listener.incoming() {
        let Ok(mut socket) = socket else { continue };
        let rt = rt.clone();
        std::thread::spawn(move || {
            let _ = socket.set_read_timeout(Some(Duration::from_secs(10)));
            let mut line = String::new();
            let mut method = String::new();
            let result = (|| {
                BufReader::new(socket.try_clone().map_err(|e| e.to_string())?)
                    .take(32 * 1024 * 1024)
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
                Ok(result) => json!({"result":result}),
                Err(error) => json!({"error":error}),
            };
            let t = std::time::Instant::now();
            let text = reply.to_string();
            if method.starts_with("snapshot") {
                crate::timing::log(
                    "host",
                    format_args!(
                        "ev=snapshot_reply method={method} serialize_ms={:.2} payload_bytes={}",
                        crate::timing::ms(t),
                        text.len()
                    ),
                );
            }
            let _ = writeln!(socket, "{text}");
        });
    }
    Ok(())
}
#[cfg(not(unix))]
pub fn call(_: &Path, _: &str, _: Value) -> Result<Value, String> {
    Err("Background host currently requires macOS or Linux".into())
}
#[cfg(not(unix))]
pub fn serve(_: PathBuf) -> Result<(), String> {
    Err("Background host currently requires macOS or Linux".into())
}
