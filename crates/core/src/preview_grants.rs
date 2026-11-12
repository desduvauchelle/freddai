//! Preview shares recorded by the `freddai_share_preview` MCP tool.
//!
//! The MCP tool runs in the background host (`--host`), but the preview grant check runs in the
//! separate `--companion-server` process, so grants cross the process boundary as a small
//! owner-only file in the workspace: `companion/preview-grants.json`. The companion server
//! imports unexpired entries into its in-memory grants (`preview_host::grant_port`), which applies
//! the port rules again. Entries expire after 12 h.
use serde_json::{json, Value};
use std::{fs, io::Write, path::{Path, PathBuf}, time::{Duration, Instant}};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

pub const TTL_SECS: u64 = 12 * 3600;
/// Companion HTTPS listener; never shareable.
pub const COMPANION_PORT: u16 = 49744;

fn file(root: &Path) -> PathBuf { root.join("companion").join("preview-grants.json") }
fn now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

/// Cheap checks the host can make; the companion server re-checks (including Freddai listeners).
pub fn check_port(port: u64) -> Result<u16, String> {
    let port = u16::try_from(port).map_err(|_| format!("port {port} is out of range"))?;
    if port < 1024 { return Err(format!("port {port} is below 1024")); }
    if port == COMPANION_PORT { return Err(format!("port {port} is a Freddai port")); }
    Ok(port)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Share { pub port: u16, pub expires: u64, pub command: Option<String>, pub cwd: Option<PathBuf> }

fn read(root: &Path, now: u64) -> Vec<Share> {
    let Ok(text) = fs::read_to_string(file(root)) else { return vec![] };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) else { return vec![] };
    items.iter().filter_map(|v| Some(Share {
        port: u16::try_from(v["port"].as_u64()?).ok()?,
        expires: v["expires"].as_u64()?,
        command: v["command"].as_str().map(str::to_string),
        cwd: v["cwd"].as_str().map(PathBuf::from),
    })).filter(|s| s.expires > now).collect()
}

/// Takes the exclusive lock `name` in the companion dir, runs `f`, releases on drop.
fn with_lock<T>(root: &Path, name: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let dir = root.join("companion");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot update preview state: {e}"))?;
    let mut lock_options = fs::OpenOptions::new();
    lock_options.create(true).truncate(false).write(true);
    #[cfg(unix)]
    lock_options.mode(0o600);
    let lock = lock_options.open(dir.join(name)).map_err(|e| format!("Cannot update preview state: {e}"))?;
    fs2::FileExt::lock_exclusive(&lock).map_err(|e| format!("Cannot update preview state: {e}"))?;
    f()
}

fn write_atomic(path: &Path, body: &str) -> Result<(), String> {
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut f = options.open(&tmp)?;
        f.write_all(body.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    result.map_err(|e| { let _ = fs::remove_file(&tmp); format!("Cannot write {}: {e}", path.display()) })
}

/// Records a share (replacing any earlier one for the port).
pub fn record(root: &Path, port: u16) -> Result<(), String> { record_share(root, port, None, None) }

/// Records a share with an optional command (and cwd) that starts its server.
pub fn record_share(root: &Path, port: u16, command: Option<&str>, cwd: Option<&Path>) -> Result<(), String> {
    with_lock(root, "preview-grants.lock", || {
        let now = now();
        let mut entries: Vec<_> = read(root, now).into_iter().filter(|s| s.port != port).collect();
        entries.push(Share { port, expires: now + TTL_SECS, command: command.map(str::to_string), cwd: cwd.map(Path::to_path_buf) });
        let body = json!(entries.iter().map(|s| {
            let mut v = json!({"port": s.port, "expires": s.expires, "source": "mcp"});
            if let Some(c) = &s.command { v["command"] = json!(c); }
            if let Some(c) = &s.cwd { v["cwd"] = json!(c.to_string_lossy()); }
            v
        }).collect::<Vec<_>>()).to_string();
        write_atomic(&file(root), &body).map_err(|e| format!("Cannot record preview share: {e}"))
    })
}

/// Unexpired shares with their start commands.
pub fn shares(root: &Path) -> Vec<Share> { read(root, now()) }
pub fn share(root: &Path, port: u16) -> Option<Share> { shares(root).into_iter().find(|s| s.port == port) }

/// Ports with an unexpired share, for the companion server to import.
pub fn active(root: &Path) -> Vec<u16> { read(root, now()).into_iter().map(|s| s.port).collect() }

// ---- detached dev-server manager ----

#[derive(Debug, Clone, PartialEq)]
pub enum ServerState {
    Listening,
    Starting { pid: u32, log: PathBuf },
    NoCommand,
    Failed { detail: String, log: Option<PathBuf> },
}

pub fn is_listening(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

fn servers_file(root: &Path) -> PathBuf { root.join("companion").join("preview-servers.json") }
fn log_path(root: &Path, port: u16) -> PathBuf { root.join("companion").join(format!("preview-{port}.log")) }

fn read_servers(root: &Path) -> Vec<Value> {
    let Ok(text) = fs::read_to_string(servers_file(root)) else { return vec![] };
    match serde_json::from_str::<Value>(&text) { Ok(Value::Array(a)) => a, _ => vec![] }
}
fn write_servers(root: &Path, entries: &[Value]) -> Result<(), String> {
    write_atomic(&servers_file(root), &Value::Array(entries.to_vec()).to_string())
}
fn entry_port(v: &Value) -> Option<u16> { u16::try_from(v["port"].as_u64()?).ok() }
fn entry_pid(v: &Value) -> Option<u32> { u32::try_from(v["pid"].as_u64()?).ok() }

#[cfg(unix)]
fn alive(pid: u32) -> bool { pid > 0 && unsafe { libc::kill(pid as libc::pid_t, 0) } == 0 }
#[cfg(not(unix))]
fn alive(_pid: u32) -> bool { false }

fn remove_entry(root: &Path, port: u16) {
    let _ = with_lock(root, "preview-servers.lock", || {
        let kept: Vec<Value> = read_servers(root).into_iter().filter(|v| entry_port(v) != Some(port)).collect();
        write_servers(root, &kept)
    });
}

fn failed(port: u16, detail: String, log: Option<PathBuf>) -> ServerState {
    eprintln!("preview_server_failed port={port} detail={detail}");
    ServerState::Failed { detail, log }
}

#[cfg(unix)]
fn spawn(root: &Path, port: u16, command: &str, cwd: &Path) -> Result<(u32, PathBuf), String> {
    use std::os::unix::process::CommandExt;
    let log = log_path(root, port);
    let mut options = fs::OpenOptions::new();
    options.create(true).write(true).truncate(true);
    options.mode(0o600);
    let out = options.open(&log).map_err(|e| format!("cannot open log {}: {e}", log.display()))?;
    let err = out.try_clone().map_err(|e| format!("cannot open log {}: {e}", log.display()))?;
    // Run through the user's login shell: a GUI app inherits a bare PATH, so `npm`/`node` from nvm, volta
    // or fnm only resolve after the shell's startup files ran. `-l` covers .zprofile/.bash_profile; nvm is
    // usually initialised in ~/.zshrc, which a non-interactive login zsh skips, so source it explicitly.
    // No `-i`: an interactive shell with null stdin and no tty would stop on job-control/tty setup.
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut script = command.to_string();
    if shell.ends_with("/zsh") {
        if let Some(zshrc) = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".zshrc")).filter(|p| p.is_file()) {
            script = format!("source {} >/dev/null 2>&1; {command}", zshrc.display());
        }
    }
    let mut cmd = std::process::Command::new(&shell);
    cmd.arg("-lc").arg(script).current_dir(cwd)
        .stdin(std::process::Stdio::null()).stdout(out).stderr(err);
    // setsid alone makes a new session and group (we are not a group leader after fork); calling
    // process_group(0) first made setsid fail with EPERM.
    unsafe { cmd.pre_exec(|| { libc::setsid(); Ok(()) }); }
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id();
    // Reap the child if it exits while we are alive, so it never lingers as a zombie.
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok((pid, log))
}
#[cfg(not(unix))]
fn spawn(_: &Path, _: u16, _: &str, _: &Path) -> Result<(u32, PathBuf), String> { Err("preview servers are only supported on unix".into()) }

enum Plan { Listening, Wait(u32, PathBuf), Done(ServerState) }

fn entry_age(e: &Value) -> u64 { now().saturating_sub(e["started"].as_u64().unwrap_or(0)) }

/// Stops our own previous server (a session/group leader we created) and waits up to 3 s for its port.
#[cfg(unix)]
fn replace_server(port: u16, pid: u32) -> Result<(), String> {
    eprintln!("preview_server_replacing port={port} pid={pid}");
    unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGTERM); }
    let deadline = Instant::now() + Duration::from_secs(3);
    while is_listening(port) {
        if Instant::now() >= deadline { return Err(format!("old server (pid {pid}) still listening on {port} 3 s after SIGTERM")); }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}
#[cfg(not(unix))]
fn replace_server(_: u16, _: u32) -> Result<(), String> { Err("preview servers are only supported on unix".into()) }

/// Makes sure the shared server for `port` is running, starting it detached when needed.
/// Callers must only call this after an explicit user confirmation.
pub fn ensure_running(root: &Path, port: u16, wait: Duration) -> ServerState {
    let started_at = Instant::now();
    let plan = with_lock(root, "preview-servers.lock", || {
        let mut entries = read_servers(root);
        let existing = entries.iter().find(|v| entry_port(v) == Some(port)).cloned();
        let log = log_path(root, port);
        let share = share(root, port);
        let live_pid = existing.as_ref().and_then(entry_pid).filter(|p| alive(*p));
        if is_listening(port) {
            let Some(e) = &existing else { return Ok(Plan::Listening) };
            let Some(pid) = live_pid else {
                entries.retain(|v| entry_port(v) != Some(port));
                write_servers(root, &entries)?;
                return Ok(Plan::Listening);
            };
            let changed = share.as_ref().is_some_and(|s| s.command.is_some() && (
                e["command"].as_str() != s.command.as_deref() || e["cwd"].as_str().map(PathBuf::from) != s.cwd));
            if !changed { return Ok(Plan::Listening); }
            if let Err(detail) = replace_server(port, pid) { return Ok(Plan::Done(failed(port, detail, Some(log)))); }
            entries.retain(|v| entry_port(v) != Some(port));
            write_servers(root, &entries)?;
        } else if let Some(e) = &existing {
            match live_pid {
                Some(pid) if entry_age(e) <= 120 => return Ok(Plan::Wait(pid, log)),
                Some(pid) => eprintln!("preview_server_stale port={port} pid={pid} age_s={}", entry_age(e)),
                None => {}
            }
            // Dead pid, or alive but never listening for too long (never kill it: the pid may be reused).
            entries.retain(|v| entry_port(v) != Some(port));
            write_servers(root, &entries)?;
        }
        let Some(share) = share else { return Ok(Plan::Done(ServerState::NoCommand)) };
        let Some(command) = share.command else { return Ok(Plan::Done(ServerState::NoCommand)) };
        let Some(cwd) = share.cwd else { return Ok(Plan::Done(failed(port, "share has a command but no cwd".into(), None))) };
        if !cwd.is_dir() { return Ok(Plan::Done(failed(port, format!("cwd {} does not exist", cwd.display()), None))); }
        match spawn(root, port, &command, &cwd) {
            Ok((pid, log)) => {
                eprintln!("preview_server_spawned port={port} pid={pid} cwd={} command={command}", cwd.display());
                entries.push(json!({"port": port, "pid": pid, "command": command, "cwd": cwd.to_string_lossy(), "started": now()}));
                write_servers(root, &entries)?;
                Ok(Plan::Wait(pid, log))
            }
            Err(e) => Ok(Plan::Done(failed(port, e, None))),
        }
    });
    let (pid, log) = match plan {
        Err(e) => return failed(port, e, None),
        Ok(Plan::Listening) => return ServerState::Listening,
        Ok(Plan::Done(s)) => return s,
        Ok(Plan::Wait(pid, log)) => (pid, log),
    };
    let deadline = Instant::now() + wait;
    loop {
        if is_listening(port) {
            eprintln!("preview_server_listening port={port} ms={}", started_at.elapsed().as_millis());
            return ServerState::Listening;
        }
        if !alive(pid) {
            remove_entry(root, port);
            return failed(port, format!("exited before listening; see {}", log.display()), Some(log));
        }
        if Instant::now() >= deadline { return ServerState::Starting { pid, log }; }
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn records_replaces_and_expires() {
        let root = std::env::temp_dir().join(format!("freddai-pg-{}", uuid::Uuid::new_v4()));
        assert!(active(&root).is_empty());
        record(&root, 3000).unwrap();
        record(&root, 5173).unwrap();
        record(&root, 3000).unwrap();
        let mut ports = active(&root);
        ports.sort();
        assert_eq!(ports, vec![3000, 5173]);
        fs::write(file(&root), r#"[{"port":3000,"expires":1}]"#).unwrap();
        assert!(active(&root).is_empty());
        assert!(check_port(80).is_err() && check_port(COMPANION_PORT as u64).is_err() && check_port(70000).is_err());
        assert_eq!(check_port(3000), Ok(3000));
        let _ = fs::remove_dir_all(root);
    }

    fn free_port() -> u16 { std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port() }

    #[test]
    fn record_share_keeps_command_and_old_files_parse() {
        let root = std::env::temp_dir().join(format!("freddai-pg-{}", uuid::Uuid::new_v4()));
        record_share(&root, 3000, Some("npm run dev"), Some(Path::new("/tmp"))).unwrap();
        record(&root, 4000).unwrap();
        let s = share(&root, 3000).unwrap();
        assert_eq!((s.command.as_deref(), s.cwd.as_deref()), (Some("npm run dev"), Some(Path::new("/tmp"))));
        assert_eq!(share(&root, 4000).unwrap().command, None);
        record(&root, 3000).unwrap();
        assert_eq!(share(&root, 3000).unwrap().command, None);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn ensure_running_spawns_once_reports_failures() {
        let root = std::env::temp_dir().join(format!("freddai-ps-{}", uuid::Uuid::new_v4()));
        let cwd = std::env::temp_dir().join(format!("freddai-pscwd-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&cwd).unwrap();
        let port = free_port();
        record(&root, port).unwrap();
        assert_eq!(ensure_running(&root, port, Duration::from_millis(200)), ServerState::NoCommand);
        record_share(&root, port, Some(&format!("exec python3 -m http.server {port} --bind 127.0.0.1")), Some(&cwd)).unwrap();
        assert_eq!(ensure_running(&root, port, Duration::from_secs(20)), ServerState::Listening);
        let servers = read_servers(&root);
        assert_eq!(servers.len(), 1);
        let pid = entry_pid(&servers[0]).unwrap();
        assert_eq!(ensure_running(&root, port, Duration::from_secs(5)), ServerState::Listening);
        assert_eq!(read_servers(&root).len(), 1);
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL); }

        let bad = free_port();
        record_share(&root, bad, Some("exit 3"), Some(&cwd)).unwrap();
        match ensure_running(&root, bad, Duration::from_secs(10)) {
            ServerState::Failed { detail, log } => { assert!(detail.contains("preview-"), "{detail}"); assert!(log.is_some()); }
            other => panic!("{other:?}"),
        }
        record_share(&root, bad, Some("exit 3"), None).unwrap();
        assert!(matches!(ensure_running(&root, bad, Duration::from_secs(1)), ServerState::Failed { .. }));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cwd);
    }

    #[cfg(unix)]
    fn kill_group(pid: u32) { unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL); libc::kill(pid as libc::pid_t, libc::SIGKILL); } }
    #[cfg(unix)]
    fn setup() -> (PathBuf, PathBuf, u16) {
        let root = std::env::temp_dir().join(format!("freddai-ps-{}", uuid::Uuid::new_v4()));
        let cwd = std::env::temp_dir().join(format!("freddai-pscwd-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&cwd).unwrap();
        (root, cwd, free_port())
    }
    #[cfg(unix)]
    fn http_cmd(port: u16, extra: &str) -> String { format!("exec python3 -m http.server {port} --bind 127.0.0.1 {extra}") }
    #[cfg(unix)]
    fn write_entry(root: &Path, port: u16, pid: u32, started: u64) {
        fs::create_dir_all(root.join("companion")).unwrap();
        write_servers(root, &[json!({"port": port, "pid": pid, "command": "x", "cwd": "/tmp", "started": started})]).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn dead_entry_respawns_immediately() {
        let (root, cwd, port) = setup();
        let mut dead = std::process::Command::new("true").spawn().unwrap();
        let dead_pid = dead.id();
        dead.wait().unwrap();
        write_entry(&root, port, dead_pid, now());
        record_share(&root, port, Some(&http_cmd(port, "")), Some(&cwd)).unwrap();
        assert_eq!(ensure_running(&root, port, Duration::from_secs(20)), ServerState::Listening);
        let servers = read_servers(&root);
        let pid = entry_pid(&servers[0]).unwrap();
        assert_ne!(pid, dead_pid);
        kill_group(pid);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cwd);
    }

    #[cfg(unix)]
    #[test]
    fn stale_alive_entry_respawns_without_killing_old_pid() {
        let (root, cwd, port) = setup();
        let mut sleeper = std::process::Command::new("sleep").arg("300").spawn().unwrap();
        write_entry(&root, port, sleeper.id(), now() - 300);
        record_share(&root, port, Some(&http_cmd(port, "")), Some(&cwd)).unwrap();
        assert_eq!(ensure_running(&root, port, Duration::from_secs(20)), ServerState::Listening);
        let pid = entry_pid(&read_servers(&root)[0]).unwrap();
        assert_ne!(pid, sleeper.id());
        assert!(alive(sleeper.id()), "stale pid must not be killed");
        kill_group(pid);
        let _ = sleeper.kill();
        let _ = sleeper.wait();
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cwd);
    }

    #[cfg(unix)]
    #[test]
    fn changed_command_replaces_the_running_server() {
        let (root, cwd, port) = setup();
        record_share(&root, port, Some(&http_cmd(port, "")), Some(&cwd)).unwrap();
        assert_eq!(ensure_running(&root, port, Duration::from_secs(20)), ServerState::Listening);
        let old = entry_pid(&read_servers(&root)[0]).unwrap();
        record_share(&root, port, Some(&http_cmd(port, &format!("--directory {}", cwd.display()))), Some(&cwd)).unwrap();
        assert_eq!(ensure_running(&root, port, Duration::from_secs(20)), ServerState::Listening);
        let new = entry_pid(&read_servers(&root)[0]).unwrap();
        assert_ne!(old, new);
        for _ in 0..30 { if !alive(old) { break; } std::thread::sleep(Duration::from_millis(100)); }
        assert!(!alive(old), "old server must be gone");
        assert!(is_listening(port));
        kill_group(new);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cwd);
    }
}
