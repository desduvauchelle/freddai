use crate::protocol;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::{fs::PermissionsExt, process::CommandExt};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex, MutexGuard, Weak,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, String>;
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_home: Option<PathBuf>,
    #[serde(default)]
    pub claude_default_config: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    pub policy: String,
    pub account: Option<String>,
    pub last: Option<String>,
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NewThreadPolicy {
    LastSelected,
    Project,
    Default,
}
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Preferences {
    #[serde(default)]
    pub new_thread_policy: Option<NewThreadPolicy>,
    #[serde(default)]
    pub last_selected: Option<String>,
    pub prefer_last: bool,
    pub fallback: Option<String>,
    pub last: Option<String>,
    #[serde(default)]
    pub use_worktree: bool,
}
#[derive(Clone, Copy, Serialize, Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    #[default]
    Ask,
    Bypass,
}
impl PermissionMode {
    pub fn claude_mode(self) -> &'static str {
        match self {
            Self::Ask => "default",
            Self::Bypass => "bypassPermissions",
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct LaunchOptions {
    #[serde(default)]
    pub permission_mode: Option<PermissionMode>,
    #[serde(default)]
    pub worktree: bool,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub scheduled: bool,
    #[serde(default)]
    pub update_agent_controls: bool,
}
impl LaunchOptions {
    fn update_controls(&mut self, next: &Self) {
        if let Some(mode) = next.permission_mode {
            self.permission_mode = Some(mode);
        }
        if next.update_agent_controls {
            self.model = next.model.clone();
            self.effort = next.effort.clone();
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<crate::attachments::Attachment>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub deleted_at: Option<u64>,
    #[serde(default)]
    pub execution_project: Option<String>,
    #[serde(default)]
    pub usage: Option<crate::conversation_usage::ConversationUsage>,
    /// Highest `updated` value the user has seen on any paired device. Shared by desktop and phone; never moves backwards.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_at: Option<u64>,
    pub id: String,
    pub project: String,
    pub account: String,
    pub title: String,
    #[serde(default)]
    pub title_manual: Option<bool>,
    pub status: String,
    pub updated: u64,
    #[serde(default)]
    pub last_user_message_at: Option<u64>,
    pub provider_id: Option<String>,
    pub messages: Vec<Message>,
    pub pending: Option<Value>,
    pub error: Option<String>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub options: LaunchOptions,
    #[serde(default)]
    pub requests: Vec<String>,
    /// Background sub-agents launched by this thread's turns (Claude Code).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tasks: Vec<crate::background_tasks::BackgroundTask>,
}
static QUEUE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
pub struct QueuedMessage {
    pub id: String,
    pub prompt: String,
    pub options: LaunchOptions,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ThreadQueue {
    pub session: String,
    pub paused: bool,
    pub error: Option<String>,
    pub messages: Vec<QueuedMessage>,
}
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Database {
    #[serde(default)]
    pub queues: Vec<ThreadQueue>,
    pub accounts: Vec<Account>,
    pub projects: Vec<Project>,
    pub sessions: Vec<Session>,
    pub preferences: Preferences,
    #[serde(default)]
    pub schedules: Vec<crate::schedules::Schedule>,
}
struct Inner {
    root: PathBuf,
    db: Database,
    running: HashMap<String, mpsc::Sender<Control>>,
    shutting_down: bool,
    /// Non-persisted change counter. Starts at 1 so a client revision of 0 always means "unknown".
    revision: u64,
    /// Every session counts as changed at this revision (set by wide, non-session-specific mutations).
    floor: u64,
    /// Revision at which each session last changed through a fine-grained `update`.
    session_rev: HashMap<String, u64>,
    /// In-memory state is newer than workspace.json (debounced persister will flush it).
    dirty: AtomicBool,
    /// Ticket for each write attempt; a stale ticket never overwrites a newer file.
    seq: AtomicU64,
    /// Highest ticket written so far; also serializes writers to workspace.tmp.
    file: Arc<Mutex<u64>>,
}
/// Everything behind the runtime's single lock plus identity of this host process.
struct Store {
    inner: Mutex<Inner>,
    boot_id: String,
}
/// Lock guard that notices mutable access: any `DerefMut` use marks every session as changed
/// and the database dirty when the guard drops. `update_timed` bypasses this with exact tracking.
struct Guard<'a> {
    g: MutexGuard<'a, Inner>,
    wide: bool,
}
impl std::ops::Deref for Guard<'_> {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.g
    }
}
impl std::ops::DerefMut for Guard<'_> {
    fn deref_mut(&mut self) -> &mut Inner {
        self.wide = true;
        &mut self.g
    }
}
impl Drop for Guard<'_> {
    fn drop(&mut self) {
        if self.wide {
            self.g.revision += 1;
            self.g.floor = self.g.revision;
            self.g.dirty.store(true, Ordering::SeqCst);
        }
    }
}
impl Store {
    fn lock(&self) -> std::sync::LockResult<Guard<'_>> {
        match self.inner.lock() {
            Ok(g) => Ok(Guard { g, wide: false }),
            Err(e) => Err(std::sync::PoisonError::new(Guard {
                g: e.into_inner(),
                wide: false,
            })),
        }
    }
}
/// How often the background persister writes streamed (non-critical) changes.
const PERSIST_INTERVAL: Duration = Duration::from_millis(750);
#[derive(Clone)]
pub struct Runtime(Arc<Store>, crate::login::LoginManager);
enum Control {
    Cancel,
    Reply(Value),
    Steer(QueuedMessage, mpsc::Sender<Result<()>>),
}
/// Non-Codex steering waits for cancellation before sending a new prompt on the same pipe.
struct SteeringHandoff {
    message: QueuedMessage,
    ack: mpsc::Sender<Result<()>>,
    input: Value,
    started: std::time::Instant,
    interrupt_ack: bool,
    turn_ended: bool,
}
fn cancelled_permission(provider: &str, frame: &Value) -> Result<Value> {
    if is_acp(provider) {
        Ok(json!({"jsonrpc":"2.0","id":frame["id"],"result":{"outcome":{"outcome":"cancelled"}}}))
    } else {
        protocol::approval_response(provider, frame, false, &json!({}))
    }
}
fn write_file(root: &Path, db: &Database, seq: u64, file: &Mutex<u64>) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(db).map_err(|e| e.to_string())?;
    let mut last = file.lock().unwrap();
    if seq < *last {
        return Ok(()); // a newer state already reached disk
    }
    let path = root.join("workspace.json");
    let tmp = root.join("workspace.tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())?;
    *last = seq;
    Ok(())
}
/// Immediate, synchronous persistence for user mutations and state transitions.
/// One line per event to stderr and to `<root>/logs/preferences.log` (Finder launches lose stderr).
fn preferences_log(root: &Path, line: &str) {
    let line = format!(
        "{} pid={} {line}",
        crate::timing::wall_ms(),
        std::process::id()
    );
    eprintln!("{line}");
    let dir = root.join("logs");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("preferences.log");
    if fs::metadata(&path)
        .map(|m| m.len() > 512 * 1024)
        .unwrap_or(false)
    {
        let _ = fs::rename(&path, dir.join("preferences.log.1"));
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = writeln!(f, "{line}");
    }
}
fn prefs_diag(p: &Preferences) -> String {
    format!(
        "policy={:?} last_selected={:?} fallback={:?} prefer_last={}",
        p.new_thread_policy.map(|v| match v {
            NewThreadPolicy::LastSelected => "last_selected",
            NewThreadPolicy::Project => "project",
            NewThreadPolicy::Default => "default",
        }),
        p.last_selected,
        p.fallback,
        p.prefer_last
    )
}
fn write_db(inner: &Inner) -> Result<()> {
    let seq = inner.seq.fetch_add(1, Ordering::SeqCst) + 1;
    write_file(&inner.root, &inner.db, seq, &inner.file)?;
    inner.dirty.store(false, Ordering::SeqCst);
    Ok(())
}
/// Clone the database under the lock (about 1 ms for a 13 MB workspace; serializing it takes ~9 ms),
/// then serialize and write with the lock released. Returns whether a write happened.
fn persist_if_dirty(store: &Store) -> bool {
    let (root, db, seq, file) = {
        let i = store.inner.lock().unwrap();
        if !i.dirty.swap(false, Ordering::SeqCst) {
            return false;
        }
        let seq = i.seq.fetch_add(1, Ordering::SeqCst) + 1;
        (i.root.clone(), i.db.clone(), seq, i.file.clone())
    };
    if let Err(e) = write_file(&root, &db, seq, &file) {
        eprintln!("Workspace persistence failed: {e}");
        store
            .inner
            .lock()
            .unwrap()
            .dirty
            .store(true, Ordering::SeqCst);
    }
    true
}
fn spawn_persister(store: Weak<Store>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(PERSIST_INTERVAL);
        let Some(store) = store.upgrade() else { return };
        persist_if_dirty(&store);
    });
}
pub(crate) fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    Ok(())
}
fn is_acp(provider: &str) -> bool {
    matches!(
        provider,
        "gemini" | "antigravity" | "grok" | "opencode" | "cursor"
    )
}
fn executable(provider: &str) -> Result<PathBuf> {
    let name = match provider {
        "codex" => "codex",
        "claude" => "claude",
        "gemini" => "gemini",
        "antigravity" => "agy",
        "grok" => "grok",
        "opencode" => "opencode",
        "cursor" => "agent",
        _ => return Err("Unsupported agent".into()),
    };
    crate::platform::executable_in(name, crate::platform::cli_dirs())
        .ok_or_else(|| format!("Install {name} CLI before using this account."))
}
#[derive(Serialize)]
pub struct AgentInstallation {
    pub provider: String,
    pub path: Option<String>,
}
pub fn detect_agents() -> Vec<AgentInstallation> {
    [
        "codex",
        "claude",
        "antigravity",
        "grok",
        "opencode",
        "cursor",
        "gemini",
    ]
    .iter()
    .map(|provider| AgentInstallation {
        provider: provider.to_string(),
        path: executable(provider)
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
    })
    .collect()
}
const AUTH_ENV: &[&str] = &[
    "AGY_ADC_AUTH",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "XAI_API_KEY",
    "GROK_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
];
fn antigravity_supports_acp(help: &std::process::Output) -> bool {
    help.status.success()
        && [&help.stdout, &help.stderr]
            .iter()
            .any(|text| String::from_utf8_lossy(text).to_lowercase().contains("acp"))
}
pub(crate) fn command(account: &Account, root: &Path) -> Result<Command> {
    command_with_resolver(account, root, executable)
}

fn command_with_resolver(
    account: &Account,
    root: &Path,
    resolve: impl Fn(&str) -> Result<PathBuf>,
) -> Result<Command> {
    let home = account
        .config_home
        .clone()
        .unwrap_or_else(|| root.join("accounts").join(&account.id));
    if account.config_home.is_none() {
        private_dir(&home)?;
    }
    let mut cmd = crate::platform::quiet_command(resolve(&account.provider)?);
    for key in AUTH_ENV {
        cmd.env_remove(key);
    }
    if matches!(account.provider.as_str(), "opencode" | "cursor") {
        if account.config_home.is_none() {
            return Err("This harness uses its shared CLI configuration. Connect the current CLI in Accounts.".into());
        }
    } else if account.provider == "antigravity" {
        if account.config_home.is_none() {
            return Err("Antigravity uses the shared CLI sign-in. Connect it in Accounts.".into());
        }
        let help = crate::platform::quiet_command(resolve("antigravity")?)
            .args(["acp", "--help"])
            .output()
            .map_err(|e| e.to_string())?;
        if !antigravity_supports_acp(&help) {
            return Err(
                "Update Antigravity CLI to a version supporting agy acp, then scan again.".into(),
            );
        }
    } else if account.provider == "claude"
        && account.config_home.is_some()
        && account.claude_default_config
    {
        // Setting even the default directory changes Claude's Keychain namespace.
        // A shared default login must keep the variable absent, including after
        // restoring the connection in a process with a different environment.
        cmd.env_remove("CLAUDE_CONFIG_DIR");
    } else {
        cmd.env(
            match account.provider.as_str() {
                "codex" => "CODEX_HOME",
                "claude" => "CLAUDE_CONFIG_DIR",
                "gemini" => "GEMINI_CLI_HOME",
                "grok" => "GROK_HOME",
                _ => return Err("Unsupported provider".into()),
            },
            &home,
        );
    }
    if account.provider == "codex" && account.config_home.is_none() {
        cmd.args(["-c", "cli_auth_credentials_store=\"file\""]);
    }
    // GUI applications do not inherit the user's interactive shell PATH.
    cmd.env("PATH", crate::platform::cli_path()?);
    #[cfg(unix)]
    cmd.process_group(0);
    Ok(cmd)
}

fn check_auth(c: Command, provider: &str) -> Result<bool> {
    check_auth_with_timeout(c, provider, Duration::from_secs(10))
}

fn check_auth_with_timeout(mut c: Command, provider: &str, timeout: Duration) -> Result<bool> {
    if matches!(provider, "antigravity" | "opencode" | "cursor") {
        return crate::acp::verify_cached(c, provider);
    }
    if provider == "grok" {
        return crate::acp::verify_grok(c);
    }
    if provider == "gemini" {
        let home = c
            .get_envs()
            .find(|(k, _)| *k == "GEMINI_CLI_HOME")
            .and_then(|(_, v)| v)
            .ok_or("Missing Gemini profile")?;
        return Ok(Path::new(home).join(".gemini/oauth_creds.json").is_file());
    }
    if provider == "codex" {
        c.args(["login", "status"]);
    } else {
        c.args(["auth", "status"]);
    }
    let mut child = c
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(status.success());
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    terminate(&mut child);
    let name = if provider == "codex" {
        "Codex"
    } else {
        "Claude Code"
    };
    Err(format!("{name} sign-in check timed out after {} seconds. The CLI did not respond, so your sign-in status is unknown. Open Accounts and check the connection. If it keeps timing out, update the {name} CLI and check its sign-in in Terminal, then try your message again.", timeout.as_secs()))
}

fn local_account(provider: &str) -> Result<Account> {
    local_account_from_env(provider, |key| std::env::var_os(key))
}
fn local_account_from_env(
    provider: &str,
    get_env: impl Fn(&str) -> Option<std::ffi::OsString>,
) -> Result<Account> {
    let (env, folder) = match provider {
        "codex" => ("CODEX_HOME", ".codex"),
        "claude" => ("CLAUDE_CONFIG_DIR", ".claude"),
        "gemini" => ("GEMINI_CLI_HOME", ""),
        "antigravity" | "opencode" | "cursor" => ("HOME", ""),
        "grok" => ("GROK_HOME", ".grok"),
        _ => return Err("Unsupported agent".into()),
    };
    let override_home = get_env(env).map(PathBuf::from);
    let claude_default_config = provider == "claude" && override_home.is_none();
    let home = override_home
        .clone()
        .or_else(|| crate::platform::home_from_env(&get_env).map(|h| h.join(folder)))
        .ok_or("Cannot locate CLI configuration")?;
    let resolved = fs::canonicalize(&home).map_err(|_| "No existing CLI configuration found")?;
    if !resolved.is_dir() {
        return Err("CLI configuration is not a directory".into());
    }
    Ok(Account {
        id: id(),
        name: "Existing CLI sign-in".into(),
        provider: provider.into(),
        color: "#8ec6a2".into(),
        // Claude also keys authentication by the exact explicit directory value.
        config_home: Some(if provider == "claude" && override_home.is_some() {
            home
        } else {
            resolved
        }),
        claude_default_config,
    })
}
#[derive(Serialize)]
pub struct ExistingSignIn {
    pub provider: String,
    pub signed_in: bool,
    pub error: Option<String>,
}
pub fn detect_existing_sign_ins() -> Vec<ExistingSignIn> {
    [
        "codex",
        "claude",
        "antigravity",
        "grok",
        "opencode",
        "cursor",
    ]
    .iter()
    .map(|provider| {
        if matches!(*provider, "antigravity" | "opencode" | "cursor") {
            return ExistingSignIn {
                provider: provider.to_string(),
                signed_in: false,
                error: None,
            };
        }
        let result =
            local_account(provider).and_then(|a| check_auth(command(&a, Path::new(""))?, provider));
        ExistingSignIn {
            provider: provider.to_string(),
            signed_in: matches!(result, Ok(true)),
            error: result.err(),
        }
    })
    .collect()
}
pub fn resolve(db: &Database, project: &Project, explicit: Option<String>) -> Result<String> {
    let chosen = explicit
        .or_else(|| {
            match db.preferences.new_thread_policy {
                Some(NewThreadPolicy::LastSelected) => {
                    if let Some(account) = &db.preferences.last_selected {
                        return Some(account.clone());
                    }
                }
                Some(NewThreadPolicy::Default) => return db.preferences.fallback.clone(),
                _ => {}
            }
            match project.policy.as_str() {
                "fixed" => project.account.clone(),
                "last" => project.last.clone().or_else(|| global(db)),
                _ => global(db),
            }
        })
        .ok_or("Choose an agent account in New thread or Settings.")?;
    if !db.accounts.iter().any(|a| a.id == chosen) {
        return Err("The selected account no longer exists. Choose another explicitly.".into());
    }
    Ok(chosen)
}
fn global(db: &Database) -> Option<String> {
    if db.preferences.new_thread_policy.is_none() && db.preferences.prefer_last {
        db.preferences
            .last
            .clone()
            .or_else(|| db.preferences.fallback.clone())
    } else {
        db.preferences.fallback.clone()
    }
}
impl Runtime {
    pub fn open(root: PathBuf) -> Result<Self> {
        private_dir(&root)?;
        let path = root.join("workspace.json");
        let mut db: Database = if path.exists() {
            serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Cannot load workspace; preserved existing file: {e}"))?
        } else {
            Database::default()
        };
        for s in &mut db.sessions {
            // Legacy messages have no timestamps. Freeze their existing recency once.
            s.last_user_message_at.get_or_insert(s.updated);
            if ["running", "waiting", "starting"].contains(&s.status.as_str()) {
                s.status = "interrupted".into();
                s.pending = None;
                crate::background_tasks::mark_interrupted(
                    &mut s.tasks,
                    "Freddai closed while this sub-agent was running.",
                );
                s.error = Some(
                    "Freddai closed during this turn. Inspect changes before resuming.".into(),
                );
            }
        }
        for queue in &mut db.queues {
            queue.paused = true;
        }
        preferences_log(
            &root,
            &format!(
                "preferences.load path={} {}",
                root.join("workspace.json").display(),
                prefs_diag(&db.preferences)
            ),
        );
        let inner = Inner {
            root,
            db,
            running: HashMap::new(),
            shutting_down: false,
            revision: 1,
            floor: 1,
            session_rev: HashMap::new(),
            dirty: AtomicBool::new(false),
            seq: AtomicU64::new(0),
            file: Arc::new(Mutex::new(0)),
        };
        write_db(&inner)?;
        let store = Arc::new(Store {
            inner: Mutex::new(inner),
            boot_id: format!("{:x}-{:x}", crate::timing::wall_ms(), std::process::id()),
        });
        spawn_persister(Arc::downgrade(&store));
        Ok(Self(store, Default::default()))
    }
    /// Synchronously write any unsaved state (shutdown, upgrade, tests).
    pub fn flush(&self) -> Result<()> {
        let i = self.0.lock().unwrap();
        write_db(&i)
    }
    pub fn prepare_upgrade(&self) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        if !i.running.is_empty() || i.db.accounts.iter().any(|a| self.1.pending(&a.id)) {
            return Err(
                "Background work is active. Stop or finish it before upgrading the host.".into(),
            );
        }
        i.shutting_down = true;
        write_db(&i)
    }
    /// Forced upgrade: cancel every running turn the way a user Stop does (queues paused, provider
    /// session ids kept so a new message resumes), wait for supervisors to reap their processes,
    /// leave a visible note on each interrupted thread, persist, then refuse new work.
    /// Returns the number of interrupted threads. Fails loudly if work does not stop in time.
    pub fn force_upgrade(&self) -> Result<usize> {
        self.1.stop_all();
        let active: Vec<String> = {
            let _guard = QUEUE_LOCK.lock().unwrap();
            let mut i = self.0.lock().unwrap();
            for q in &mut i.db.queues {
                q.paused = true;
            }
            let ids = i.running.keys().cloned().collect();
            for tx in i.running.values() {
                let _ = tx.send(Control::Cancel);
            }
            ids
        };
        for _ in 0..240 {
            if self.0.lock().unwrap().running.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let mut i = self.0.lock().unwrap();
        if !i.running.is_empty() {
            return Err("Running threads did not stop in time; the host was not restarted.".into());
        }
        let mut count = 0;
        for s in i.db.sessions.iter_mut().filter(|s| {
            active.contains(&s.id)
                || ["running", "waiting", "starting"].contains(&s.status.as_str())
        }) {
            s.status = "interrupted".into();
            s.pending = None;
            crate::background_tasks::mark_interrupted(
                &mut s.tasks,
                "Interrupted by a Freddai update.",
            );
            s.error = Some(
                "Interrupted by a Freddai update. Inspect changes, then send a message to resume."
                    .into(),
            );
            count += 1;
        }
        i.shutting_down = true;
        write_db(&i)?;
        Ok(count)
    }
    pub fn boot_id(&self) -> &str {
        &self.0.boot_id
    }
    pub fn revision(&self) -> u64 {
        self.0.lock().unwrap().revision
    }
    /// Incremental snapshot for the desktop poller. Returns the JSON reply plus
    /// (lock_wait_ms, lock_held_ms, sessions_sent, sessions_total).
    ///
    /// * same boot id and revision: `{revision, hostId, unchanged: true}`
    /// * same boot id, older revision: `full: false`, `sessionIds` for every session in order,
    ///   `sessions` only for those changed since, plus every other Database field in full
    /// * unknown revision (0), other boot id, or a revision from the future: `full: true`, all sessions
    pub fn snapshot_since(
        &self,
        revision: u64,
        host_id: Option<&str>,
    ) -> (Value, f64, f64, usize, usize) {
        let t0 = std::time::Instant::now();
        let guard = self.0.lock().unwrap();
        let wait = crate::timing::ms(t0);
        let t1 = std::time::Instant::now();
        let current = guard.revision;
        let same_host = host_id == Some(self.0.boot_id.as_str());
        if same_host && revision == current {
            let held = crate::timing::ms(t1);
            return (
                json!({"revision":current,"hostId":self.0.boot_id,"unchanged":true}),
                wait,
                held,
                0,
                guard.db.sessions.len(),
            );
        }
        let full = !same_host || revision == 0 || revision > current;
        let total = guard.db.sessions.len();
        let ids: Vec<String> = guard.db.sessions.iter().map(|s| s.id.clone()).collect();
        let sessions: Vec<Session> = guard
            .db
            .sessions
            .iter()
            .filter(|s| {
                full || guard
                    .floor
                    .max(guard.session_rev.get(&s.id).copied().unwrap_or(0))
                    > revision
            })
            .cloned()
            .collect();
        let rest = (
            guard.db.queues.clone(),
            guard.db.accounts.clone(),
            guard.db.projects.clone(),
            guard.db.preferences.clone(),
            guard.db.schedules.clone(),
        );
        let held = crate::timing::ms(t1);
        drop(guard);
        let sent = sessions.len();
        let value = json!({
            "revision": current,
            "hostId": self.0.boot_id,
            "full": full,
            "sessionIds": ids,
            "sessions": sessions,
            "queues": rest.0,
            "accounts": rest.1,
            "projects": rest.2,
            "preferences": rest.3,
            "schedules": rest.4,
        });
        (value, wait, held, sent, total)
    }
    pub(crate) fn root_dir(&self) -> PathBuf {
        self.0.lock().unwrap().root.clone()
    }
    /// Composer context: the account's provider/config folder and the folder a thread (or project) works in.
    pub fn composer_context(
        &self,
        session: Option<&str>,
        project: Option<&str>,
        account: Option<&str>,
    ) -> Result<(Option<Account>, Option<PathBuf>)> {
        let i = self.0.lock().unwrap();
        let s = match session {
            Some(id) => Some(
                i.db.sessions
                    .iter()
                    .find(|s| s.id == id)
                    .ok_or("Thread not found")?,
            ),
            None => None,
        };
        let project_id = s.map(|s| s.project.as_str()).or(project);
        let dir = s
            .and_then(|s| s.working_dir.clone())
            .or_else(|| {
                project_id.and_then(|id| {
                    i.db.projects
                        .iter()
                        .find(|p| p.id == id)
                        .map(|p| p.path.clone())
                })
            })
            .map(PathBuf::from);
        let account_id = s.map(|s| s.account.as_str()).or(account);
        let account = account_id.and_then(|id| i.db.accounts.iter().find(|a| a.id == id).cloned());
        Ok((account, dir))
    }
    pub fn snapshot(&self) -> Database {
        self.0.lock().unwrap().db.clone()
    }
    /// Snapshot with (lock_wait_ms, lock_held_ms) for [stream-timing] diagnostics.
    pub fn snapshot_timed(&self) -> (Database, f64, f64) {
        let t0 = std::time::Instant::now();
        let guard = self.0.lock().unwrap();
        let wait = crate::timing::ms(t0);
        let t1 = std::time::Instant::now();
        let db = guard.db.clone();
        let held = crate::timing::ms(t1);
        drop(guard);
        (db, wait, held)
    }
    pub fn account(&self, name: String, provider: String, color: String) -> Result<Account> {
        if matches!(provider.as_str(), "opencode" | "cursor") {
            return Err("Separate logins are unsupported. Sign in in the official CLI, then connect the current CLI.".into());
        }
        if provider == "antigravity" {
            return Err("Antigravity separate logins are not supported. Sign in with agy, then Add current connection.".into());
        }
        if name.trim().is_empty() {
            return Err("Account name is required".into());
        }
        executable(&provider)?;
        let a = Account {
            id: id(),
            name: name.trim().into(),
            provider,
            color,
            config_home: None,
            claude_default_config: false,
        };
        let mut i = self.0.lock().unwrap();
        private_dir(&i.root.join("accounts").join(&a.id))?;
        i.db.accounts.push(a.clone());
        if i.db.preferences.fallback.is_none() {
            i.db.preferences.fallback = Some(a.id.clone())
        }
        write_db(&i)?;
        Ok(a)
    }
    pub fn connect_existing(&self, provider: &str) -> Result<Account> {
        let account = local_account(provider)?;
        if !check_auth(command(&account, Path::new(""))?, provider)? {
            return Err(
                "No signed-in CLI account found. Your existing sign-in was not changed.".into(),
            );
        }
        let mut i = self.0.lock().unwrap();
        if let Some(existing) = i.db.accounts.iter().find(|a| {
            a.provider == provider
                && a.config_home == account.config_home
                && a.claude_default_config == account.claude_default_config
        }) {
            return Ok(existing.clone());
        }
        i.db.accounts.push(account.clone());
        if i.db.preferences.fallback.is_none() {
            i.db.preferences.fallback = Some(account.id.clone());
        }
        write_db(&i)?;
        Ok(account)
    }
    pub fn rename_account(&self, account_id: &str, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Connection name cannot be empty".into());
        }
        let mut i = self.0.lock().unwrap();
        let account =
            i.db.accounts
                .iter_mut()
                .find(|a| a.id == account_id)
                .ok_or("Account not found")?;
        let previous = std::mem::replace(&mut account.name, name.to_owned());
        if let Err(error) = write_db(&i) {
            i.db.accounts
                .iter_mut()
                .find(|a| a.id == account_id)
                .unwrap()
                .name = previous;
            return Err(error);
        }
        Ok(())
    }
    pub fn remove_account(&self, account_id: &str) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        if !i.db.accounts.iter().any(|a| a.id == account_id) {
            return Err("Account not found".into());
        }
        if self.1.pending(account_id)
            || i.db
                .sessions
                .iter()
                .any(|s| s.account == account_id && i.running.contains_key(&s.id))
        {
            return Err(
                "Finish or stop this connection's active turns and sign-in before removing it."
                    .into(),
            );
        }
        // Retain credentials, transcripts and pinned bindings. Missing bindings fail closed.
        let previous = i.db.clone();
        i.db.accounts.retain(|a| a.id != account_id);
        if i.db.preferences.fallback.as_deref() == Some(account_id) {
            i.db.preferences.fallback = None;
        }
        if i.db.preferences.last_selected.as_deref() == Some(account_id) {
            i.db.preferences.last_selected = None;
        }
        if i.db.preferences.last.as_deref() == Some(account_id) {
            i.db.preferences.last = None;
        }
        for project in &mut i.db.projects {
            if project.last.as_deref() == Some(account_id) {
                project.last = None;
            }
        }
        if let Err(error) = write_db(&i) {
            i.db = previous;
            return Err(error);
        }
        Ok(())
    }
    pub fn import_project(&self, path: &str, color: String) -> Result<Project> {
        let path =
            fs::canonicalize(path).map_err(|e| format!("Cannot open project folder: {e}"))?;
        if !path.is_dir() {
            return Err("Drop a project folder, rather than a file.".into());
        }
        let canonical = path.to_string_lossy().into_owned();
        if let Some(existing) = self
            .0
            .lock()
            .unwrap()
            .db
            .projects
            .iter()
            .find(|p| p.path == canonical)
            .cloned()
        {
            return Ok(existing);
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| canonical.clone());
        self.project(Project {
            id: String::new(),
            name,
            path: canonical,
            color,
            policy: "inherit".into(),
            account: None,
            last: None,
        })
    }
    pub fn project(&self, mut p: Project) -> Result<Project> {
        let path = fs::canonicalize(&p.path).map_err(|e| e.to_string())?;
        if !path.is_dir() {
            return Err("Select a project folder".into());
        }
        p.path = path.to_string_lossy().into();
        if p.name.trim().is_empty() {
            return Err("Project name is required".into());
        }
        let mut i = self.0.lock().unwrap();
        if p.id.is_empty() {
            p.id = id();
            if i.db.projects.iter().any(|x| x.path == p.path) {
                return Err("This folder already has a project.".into());
            }
            i.db.projects.push(p.clone());
        } else {
            let current =
                i.db.projects
                    .iter_mut()
                    .find(|x| x.id == p.id)
                    .ok_or("Project not found")?;
            if current.path != p.path {
                return Err("Changing a project's folder is not supported.".into());
            }
            p.last = current.last.clone();
            *current = p.clone();
        }
        write_db(&i)?;
        Ok(p)
    }
    pub fn preferences(&self, p: Preferences) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        Self::apply_preferences(&mut i, p, "replace")
    }
    /// Merge only the supplied fields into the current preferences under the lock, so a
    /// stale client snapshot can never overwrite fields it did not change. `null` clears a field.
    pub fn preferences_patch(&self, patch: Value) -> Result<()> {
        let Value::Object(fields) = patch else {
            return Err("Preferences patch must be an object.".into());
        };
        let mut i = self.0.lock().unwrap();
        let mut merged = serde_json::to_value(&i.db.preferences).map_err(|e| e.to_string())?;
        for (key, value) in fields {
            merged[key] = value;
        }
        let p: Preferences = serde_json::from_value(merged).map_err(|e| e.to_string())?;
        Self::apply_preferences(&mut i, p, "patch")
    }
    fn apply_preferences(i: &mut Inner, mut p: Preferences, mode: &str) -> Result<()> {
        p.last = i.db.preferences.last.clone();
        if let Some(account) = &p.last_selected {
            if !i.db.accounts.iter().any(|a| &a.id == account) {
                return Err("The selected account no longer exists.".into());
            }
        }
        preferences_log(
            &i.root,
            &format!(
                "preferences.save mode={mode} before={{{}}} after={{{}}}",
                prefs_diag(&i.db.preferences),
                prefs_diag(&p)
            ),
        );
        i.db.preferences = p;
        let result = write_db(i);
        preferences_log(
            &i.root,
            &format!("preferences.save.written ok={}", result.is_ok()),
        );
        result
    }
    pub fn login(&self, account_id: &str) -> Result<()> {
        let i = self.0.lock().unwrap();
        let a =
            i.db.accounts
                .iter()
                .find(|a| a.id == account_id)
                .ok_or("Account not found")?;
        if a.config_home.is_some() {
            return Err("This account uses your existing CLI sign-in. Manage sign-in in the CLI, or add a separate account in Freddai.".into());
        }
        if i.db
            .sessions
            .iter()
            .any(|s| s.account == a.id && i.running.contains_key(&s.id))
        {
            return Err("Stop this account's active turns before signing in again.".into());
        }
        if a.provider == "codex" || a.provider == "grok" {
            let mut cmd = command(a, &i.root)?;
            cmd.arg("login");
            if a.provider == "grok" {
                cmd.arg("--oauth");
            }
            let account = a.id.clone();
            let runtime = self.clone();
            drop(i);
            return self
                .1
                .start(account.clone(), cmd, move || runtime.auth_status(&account));
        }
        let exe = executable(&a.provider)?;
        let home = i.root.join("accounts").join(&a.id);
        private_dir(&home)?;
        #[cfg(windows)]
        return crate::platform::interactive_login(&exe, &home,
            if a.provider == "gemini" { "GEMINI_CLI_HOME" } else { "CLAUDE_CONFIG_DIR" }, AUTH_ENV,
            if a.provider == "gemini" { &[] } else { &["auth", "login", "--claudeai"] });
        #[cfg(not(windows))]
        {
        fn q(s: &str) -> String {
            format!("'{}'", s.replace('\'', "'\\''"))
        }
        let env = if a.provider == "gemini" {
            "GEMINI_CLI_HOME"
        } else {
            "CLAUDE_CONFIG_DIR"
        };
        let args = if a.provider == "gemini" {
            ""
        } else {
            "auth login --claudeai"
        };
        let script=format!("#!/bin/sh\numask 077\nunset {}\nexport {}={}\n{} {}\nprintf '\\nSign-in finished. Return to Freddai and choose Check sign-in.\\n'\n",AUTH_ENV.join(" "),env,q(&home.to_string_lossy()),q(&exe.to_string_lossy()),args);
        let file = i.root.join(format!("signin-{}.command", a.id));
        fs::write(&file, script).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        fs::set_permissions(&file, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        Command::new("/usr/bin/open")
            .args(["-a", "Terminal"])
            .arg(file)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
        }
    }
    pub fn login_state(&self, account: &str) -> Option<crate::login::LoginState> {
        self.1.state(account)
    }
    pub fn cancel_login(&self, account: &str) {
        self.1.cancel(account)
    }
    pub fn account_models(&self, account_id: &str) -> Result<Value> {
        let i = self.0.lock().unwrap();
        let account =
            i.db.accounts
                .iter()
                .find(|a| a.id == account_id)
                .ok_or("Account not found")?
                .clone();
        let root = i.root.clone();
        drop(i);
        if account.provider != "codex" {
            return Err("This provider does not expose a model catalog in Freddai yet.".into());
        }
        crate::models::read(command(&account, &root)?)
    }
    pub fn consume_reset(&self, account_id: &str, credit_id: &str, key: &str) -> Result<String> {
        let i = self.0.lock().unwrap();
        let account =
            i.db.accounts
                .iter()
                .find(|a| a.id == account_id)
                .ok_or("Account not found")?;
        if account.provider != "codex" {
            return Err("Banked resets are supported for Codex only.".into());
        }
        let cmd = command(account, &i.root)?;
        drop(i);
        crate::usage::consume_reset(cmd, credit_id, key)
    }
    pub fn account_usage(&self, account_id: &str) -> Result<crate::usage::AccountUsage> {
        let i = self.0.lock().unwrap();
        let account =
            i.db.accounts
                .iter()
                .find(|a| a.id == account_id)
                .ok_or("Account not found")?
                .clone();
        let root = i.root.clone();
        drop(i);
        if account.provider == "claude" {
            return crate::usage::read_claude(command(&account, &root)?);
        }
        if account.provider != "codex" {
            return Err(
                format!("{} does not expose a supported quota reader in Freddai yet. Usage and reset time are unknown.",account.provider),
            );
        }
        crate::usage::read(command(&account, &root)?)
    }
    pub fn auth_status(&self, account_id: &str) -> Result<bool> {
        let i = self.0.lock().unwrap();
        let a =
            i.db.accounts
                .iter()
                .find(|a| a.id == account_id)
                .ok_or("Account not found")?
                .clone();
        let root = i.root.clone();
        drop(i);
        check_auth(command(&a, &root)?, &a.provider)
    }

    pub fn save_schedule(&self, mut schedule: crate::schedules::Schedule) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        if schedule.prompt.trim().is_empty() || schedule.name.trim().is_empty() {
            return Err("Enter a schedule name and prompt".into());
        }
        if !i.db.projects.iter().any(|p| p.id == schedule.project)
            || !i.db.accounts.iter().any(|a| a.id == schedule.account)
        {
            return Err("Choose an existing project and stable fallback account".into());
        }
        schedule.next_due = crate::schedules::next(&schedule.cron, &schedule.timezone, now())?;
        if !["fixed", "project"].contains(&schedule.routing.as_str()) {
            return Err("Invalid schedule routing".into());
        }
        schedule.options.scheduled = true;
        schedule.run_now = None;
        if schedule.id.is_empty() {
            schedule.id = id();
            schedule.runs.clear();
            i.db.schedules.push(schedule)
        } else {
            let old =
                i.db.schedules
                    .iter_mut()
                    .find(|s| s.id == schedule.id)
                    .ok_or("Schedule not found")?;
            schedule.runs = old.runs.clone();
            *old = schedule;
        }
        write_db(&i)
    }
    pub fn schedule_action(&self, sid: &str, action: &str) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        let s =
            i.db.schedules
                .iter_mut()
                .find(|s| s.id == sid)
                .ok_or("Schedule not found")?;
        match action {
            "pause" => s.enabled = false,
            "resume" => {
                s.enabled = true;
                s.next_due = crate::schedules::next(&s.cron, &s.timezone, now())?
            }
            "run" => {
                s.run_now = Some(now());
            }
            _ => return Err("Unsupported schedule action".into()),
        }
        write_db(&i)
    }
    pub fn scheduler_tick(&self) {
        let mut dispatch = Vec::new();
        {
            let mut i = self.0.lock().unwrap();
            if i.shutting_down {
                return;
            }
            let db = i.db.clone();
            let time = now();
            for s in &mut i.db.schedules {
                for run in &mut s.runs {
                    if let Some(session) = run
                        .session
                        .as_ref()
                        .and_then(|id| db.sessions.iter().find(|x| &x.id == id))
                        .or_else(|| db.sessions.iter().find(|x| x.requests.contains(&run.id)))
                    {
                        run.session = Some(session.id.clone());
                        run.state = session.status.clone();
                        run.reason = session.error.clone();
                    } else if run.state == "dispatching" {
                        run.state = "uncertain".into();
                        run.reason = Some(
                            "Host restarted during dispatch. Inspect history before running again."
                                .into(),
                        );
                    }
                }
                if s.run_now.is_none() && (!s.enabled || s.next_due > time) {
                    continue;
                }
                let manual = s.run_now.take();
                let due = manual.unwrap_or(s.next_due);
                let occurrence = format!("{}:{}", s.id, due);
                if manual.is_none() {
                    s.next_due = match crate::schedules::next(&s.cron, &s.timezone, time) {
                        Ok(n) => n,
                        Err(e) => {
                            s.enabled = false;
                            s.runs.push(crate::schedules::Run {
                                id: occurrence,
                                due,
                                state: "blocked".into(),
                                session: None,
                                reason: Some(e),
                            });
                            continue;
                        }
                    };
                }
                if s.runs.iter().any(|r| {
                    r.id == occurrence
                        || (manual.is_none()
                            && crate::schedules::wall_slot(r.due, &s.timezone)
                                == crate::schedules::wall_slot(due, &s.timezone))
                }) {
                    continue;
                }
                let overlapping = s
                    .runs
                    .iter()
                    .any(|r| ["starting", "running", "waiting"].contains(&r.state.as_str()));
                let missed = time.saturating_sub(due) > 60_000;
                let state = if overlapping {
                    "skipped"
                } else if missed {
                    "missed"
                } else {
                    "dispatching"
                };
                s.runs.push(crate::schedules::Run {
                    id: occurrence.clone(),
                    due,
                    state: state.into(),
                    session: None,
                    reason: if overlapping {
                        Some("Previous run is still active".into())
                    } else if missed {
                        Some("Host was offline or asleep. Run now explicitly to catch up.".into())
                    } else {
                        None
                    },
                });
                if state == "dispatching" {
                    dispatch.push((s.clone(), occurrence));
                }
            }
            if write_db(&i).is_err() {
                return;
            }
        }
        for (s, occurrence) in dispatch {
            let db = self.snapshot();
            let p = db.projects.iter().find(|p| p.id == s.project);
            let account = if s.routing == "project" {
                p.and_then(|p| {
                    if p.policy == "fixed" {
                        p.account.clone()
                    } else if p.policy == "last" {
                        p.last.clone().or(Some(s.account.clone()))
                    } else {
                        Some(s.account.clone())
                    }
                })
            } else {
                Some(s.account.clone())
            };
            let mut options = s.options.clone();
            options.scheduled = true;
            options.request_id = Some(occurrence.clone());
            let result = match account {
                Some(account) => {
                    self.launch_with(s.project, Some(account), s.prompt, None, options)
                }
                None => Err("Project account is unavailable".into()),
            };
            let mut i = self.0.lock().unwrap();
            if let Some(run) =
                i.db.schedules
                    .iter_mut()
                    .find(|x| x.id == s.id)
                    .and_then(|x| x.runs.iter_mut().find(|r| r.id == occurrence))
            {
                match result {
                    Ok(id) => {
                        run.session = Some(id);
                        run.state = "starting".into()
                    }
                    Err(e) => {
                        run.state = "blocked".into();
                        run.reason = Some(e)
                    }
                }
            }
            let _ = write_db(&i);
        }
    }
    pub fn stage_attachments(
        &self,
        paths: Vec<String>,
    ) -> Result<Vec<crate::attachments::Attachment>> {
        let root = self.0.lock().unwrap().root.clone();
        crate::attachments::import(&root, &paths)
    }
    pub fn thread_action(&self, sid: &str, action: &str, project: Option<&str>) -> Result<()> {
        let _guard = QUEUE_LOCK.lock().unwrap();
        let mut i = self.0.lock().unwrap();
        if i.shutting_down {
            return Err("Host is upgrading. Try again shortly.".into());
        }
        let current =
            i.db.sessions
                .iter()
                .find(|s| s.id == sid)
                .ok_or("Thread not found")?;
        if !["archive", "delete", "purge"].contains(&action)
            && (i.running.contains_key(sid)
                || ["starting", "running", "waiting"].contains(&current.status.as_str()))
        {
            return Err("Stop this thread before changing it.".into());
        }
        if action == "move" {
            let target = project.ok_or("Choose a project")?;
            if !i.db.projects.iter().any(|p| p.id == target) {
                return Err("Project not found".into());
            }
            if current.deleted_at.is_some() {
                return Err("Restore this thread first".into());
            }
        }
        let previous = i.db.clone();
        if action == "purge" {
            i.db.sessions.retain(|s| s.id != sid);
            i.db.queues.retain(|q| q.session != sid);
            for schedule in &mut i.db.schedules {
                for run in &mut schedule.runs {
                    if run.session.as_deref() == Some(sid) {
                        run.session = None;
                        run.state = "interrupted".into();
                        run.reason = Some("Thread permanently deleted".into());
                    }
                }
            }
            if let Err(error) = write_db(&i) {
                i.db = previous;
                return Err(error);
            }
            if let Some(tx) = i.running.get(sid) {
                let _ = tx.send(Control::Cancel);
            }
            return Ok(());
        }
        let session = i.db.sessions.iter_mut().find(|s| s.id == sid).unwrap();
        match action {
            "archive" => {
                session.archived = true;
                if ["starting", "running", "waiting"].contains(&session.status.as_str()) {
                    session.status = "interrupted".into();
                }
                session.pending = None;
            }
            "unarchive" => session.archived = false,
            "delete" => {
                session.deleted_at = Some(now());
                session.status = "interrupted".into();
                session.pending = None;
            }
            "restore" => session.deleted_at = None,
            "move" => {
                if session.execution_project.is_none() {
                    session.execution_project = Some(session.project.clone());
                }
                session.project = project.unwrap().into();
            }
            _ => return Err("Unknown thread action".into()),
        }
        if let Some(queue) = i.db.queues.iter_mut().find(|q| q.session == sid) {
            queue.paused = true;
        }
        if let Err(error) = write_db(&i) {
            i.db = previous;
            return Err(error);
        }
        // Persist removal first. A stale/disconnected worker must never block deletion.
        // The turn supervisor reaps the process group asynchronously on cancellation.
        if ["archive", "delete"].contains(&action) {
            if let Some(tx) = i.running.get(sid) {
                let _ = tx.send(Control::Cancel);
            }
        }
        Ok(())
    }
    /// Raise read cursors to `max(existing, at)`. Unknown threads are skipped (reported in the return value);
    /// a cursor never moves backwards. Only sessions whose cursor changed are marked changed for delta snapshots.
    pub fn merge_read(&self, cursors: &[(String, u64)]) -> Result<Vec<String>> {
        let mut guard = self.0.inner.lock().unwrap();
        let i: &mut Inner = &mut guard;
        let mut unknown = vec![];
        let mut changed = vec![];
        for (sid, at) in cursors {
            match i.db.sessions.iter_mut().find(|s| &s.id == sid) {
                None => unknown.push(sid.clone()),
                Some(s) if s.read_at.map_or(true, |old| *at > old) => {
                    s.read_at = Some(*at);
                    changed.push(sid.clone());
                }
                Some(_) => {}
            }
        }
        if !changed.is_empty() {
            i.revision += 1;
            let rev = i.revision;
            for sid in changed {
                i.session_rev.insert(sid, rev);
            }
            i.dirty.store(true, Ordering::SeqCst);
        }
        Ok(unknown)
    }
    pub fn mark_read(&self, sid: &str, at: u64) -> Result<()> {
        if self.merge_read(&[(sid.to_string(), at)])?.is_empty() {
            Ok(())
        } else {
            Err("Thread not found".into())
        }
    }
    pub fn rename_session(&self, sid: &str, title: &str) -> Result<()> {
        let title = title.trim();
        if title.is_empty() {
            return Err("Thread name cannot be empty".into());
        }
        let mut i = self.0.lock().unwrap();
        let session =
            i.db.sessions
                .iter_mut()
                .find(|s| s.id == sid)
                .ok_or("Thread not found")?;
        let previous = (session.title.clone(), session.title_manual);
        session.title = title.to_owned();
        session.title_manual = Some(true);
        if let Err(error) = write_db(&i) {
            let session = i.db.sessions.iter_mut().find(|s| s.id == sid).unwrap();
            session.title = previous.0;
            session.title_manual = previous.1;
            return Err(error);
        }
        Ok(())
    }
    /// Applies a provider-supplied title unless the user owns the name. Every outcome is
    /// logged (`thread_title.applied` / `.skipped` / `.failed`) so a missing title is visible in native.log.
    fn auto_title(&self, sid: &str, provider: &str, title: &str) {
        let log = |ev: &str, detail: &str| {
            crate::timing::log(
                "host",
                format_args!("ev=thread_title.{ev} session={sid} provider={provider} {detail}"),
            )
        };
        let Some(title) = crate::thread_title::clean(title) else {
            return log("failed", "reason=empty_title");
        };
        let mut i = self.0.lock().unwrap();
        let Some(session) = i.db.sessions.iter_mut().find(|s| s.id == sid) else {
            return log("failed", "reason=thread_not_found");
        };
        // Older workspaces have no ownership flag. Only replace their original prompt title.
        let original = session
            .messages
            .iter()
            .find(|m| m.role == "user")
            .map(|m| m.text.chars().take(100).collect::<String>());
        if session.title_manual == Some(true) {
            return log("skipped", "reason=manual_title");
        }
        if session.title_manual.is_none() && original.as_deref() != Some(&session.title) {
            return log("skipped", "reason=legacy_custom_title");
        }
        let previous = (session.title.clone(), session.title_manual);
        session.title = title.clone();
        session.title_manual = Some(false);
        if let Err(error) = write_db(&i) {
            let session = i.db.sessions.iter_mut().find(|s| s.id == sid).unwrap();
            session.title = previous.0;
            session.title_manual = previous.1;
            eprintln!("Thread title persistence failed: {error}");
            return log("failed", &format!("reason=persist_failed error={error:?}"));
        }
        log("applied", &format!("title={title:?}"));
    }
    /// After a Codex thread's first completed turn, names it through a throwaway ephemeral
    /// side thread on its own app-server process. Runs detached so the user's turn is never delayed.
    fn spawn_codex_title(&self, s: &Session, a: &Account, p: &Project, root: &Path) {
        let (title, manual, users, assistant) = {
            let i = self.0.lock().unwrap();
            let Some(cur) = i.db.sessions.iter().find(|x| x.id == s.id) else {
                return;
            };
            let users: Vec<String> = cur
                .messages
                .iter()
                .filter(|m| m.role == "user")
                .map(|m| m.text.clone())
                .collect();
            let assistant = cur
                .messages
                .iter()
                .find(|m| m.role == "assistant")
                .map(|m| m.text.clone())
                .unwrap_or_default();
            (cur.title.clone(), cur.title_manual, users, assistant)
        };
        let refs: Vec<&str> = users.iter().map(String::as_str).collect();
        if !crate::thread_title::needs_generated_title(&title, manual, &refs) {
            crate::timing::log("host", format_args!("ev=thread_title.skipped session={} provider=codex reason=not_first_turn_or_titled", s.id));
            return;
        }
        let sid = s.id.clone();
        let fail = |reason: &str| {
            crate::timing::log(
                "host",
                format_args!(
                    "ev=thread_title.failed session={sid} provider=codex reason={reason:?}"
                ),
            )
        };
        let cmd = match command(a, root) {
            Ok(c) => c,
            Err(e) => return fail(&format!("command: {e}")),
        };
        crate::timing::log("host", format_args!("ev=thread_title.requested session={sid} provider=codex route=ephemeral_side_thread"));
        let (rt, sid, cwd, model, thread) = (
            self.clone(),
            s.id.clone(),
            p.path.clone(),
            s.options.model.clone(),
            s.provider_id.clone().unwrap_or_default(),
        );
        let prompt = crate::thread_title::codex_prompt(&users[0], &assistant);
        std::thread::spawn(move || {
            match crate::thread_title::generate_codex(
                cmd,
                &cwd,
                model.as_deref(),
                &thread,
                &prompt,
                Duration::from_secs(90),
            ) {
                Ok(g) => {
                    if let Err(e) = &g.name_set {
                        crate::timing::log("host", format_args!("ev=thread_title.failed session={sid} provider=codex step=thread/name/set reason={e:?}"));
                    }
                    rt.auto_title(&sid, "codex", &g.title);
                }
                Err(e) => crate::timing::log(
                    "host",
                    format_args!(
                        "ev=thread_title.failed session={sid} provider=codex reason={e:?}"
                    ),
                ),
            }
        });
    }
    pub fn remove_worktree(&self, sid: &str) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        if i.running.contains_key(sid) {
            return Err("Stop this thread first".into());
        }
        let s =
            i.db.sessions
                .iter()
                .find(|s| s.id == sid)
                .ok_or("Thread not found")?;
        let project =
            i.db.projects
                .iter()
                .find(|p| p.id == s.execution_project.as_deref().unwrap_or(&s.project))
                .ok_or("Project not found")?;
        let path = s
            .working_dir
            .as_ref()
            .ok_or("Thread does not use a worktree")?;
        if !s.options.worktree {
            return Err("Not a managed worktree".into());
        }
        crate::worktrees::remove(Path::new(&project.path), Path::new(path))?;
        let s = i.db.sessions.iter_mut().find(|s| s.id == sid).unwrap();
        s.status = "archived".into();
        write_db(&i)
    }
    pub fn launch(
        &self,
        project: String,
        account: Option<String>,
        prompt: String,
        existing: Option<String>,
    ) -> Result<String> {
        self.launch_with(project, account, prompt, existing, LaunchOptions::default())
    }
    pub fn launch_with(
        &self,
        project_id: String,
        explicit: Option<String>,
        prompt: String,
        existing: Option<String>,
        options: LaunchOptions,
    ) -> Result<String> {
        if prompt.trim().is_empty() {
            return Err("Enter a message".into());
        }
        let (session, a, p, root, rx, agent_prompt) = {
            let mut i = self.0.lock().unwrap();
            if i.shutting_down {
                return Err("Host is upgrading. Try again shortly.".into());
            }
            let p =
                i.db.projects
                    .iter()
                    .find(|p| p.id == project_id)
                    .cloned()
                    .ok_or("Project not found")?;
            if let Some(key) = options.request_id.as_ref() {
                if let Some(existing) = i.db.sessions.iter().find(|s| s.requests.contains(key)) {
                    return Ok(existing.id.clone());
                }
            }
            let mut s = if let Some(ref sid) = existing {
                let s =
                    i.db.sessions
                        .iter()
                        .find(|s| &s.id == sid)
                        .cloned()
                        .ok_or("Thread not found")?;
                if s.project != p.id {
                    return Err("Thread project cannot change".into());
                }
                if s.provider_id.is_none() {
                    return Err("This thread never established a provider session. Create a new thread to retry.".into());
                }
                s
            } else {
                Session {
                    archived: false,
                    deleted_at: None,
                    execution_project: None,
                    read_at: None,
                    id: id(),
                    project: p.id.clone(),
                    account: resolve(&i.db, &p, explicit)?,
                    title: crate::thread_title::from_prompt(&prompt),
                    title_manual: Some(false),
                    status: "starting".into(),
                    updated: now(),
                    last_user_message_at: None,
                    provider_id: None,
                    messages: vec![],
                    pending: None,
                    error: None,
                    working_dir: None,
                    options: options.clone(),
                    requests: vec![],
                    tasks: vec![],
                    usage: None,
                }
            };
            if s.archived || s.deleted_at.is_some() {
                return Err("Restore or unarchive this thread before resuming it.".into());
            }
            let a =
                i.db.accounts
                    .iter()
                    .find(|a| a.id == s.account)
                    .cloned()
                    .ok_or("Account not found")?;
            if existing.is_some() {
                s.options.update_controls(&options);
            }
            if s.options.permission_mode == Some(PermissionMode::Bypass)
                && !["codex", "claude"].contains(&a.provider.as_str())
            {
                return Err("Bypass permissions is not supported by this provider.".into());
            }
            if self.1.pending(&s.account) {
                return Err("Finish or cancel account sign-in first".into());
            }
            if options.attachments.len() > 20 {
                return Err("Attach at most 20 files per message".into());
            }
            let mut attached = Vec::new();
            let mut total = 0;
            for attachment in &options.attachments {
                let file = crate::attachments::load(&i.root, attachment)?.0;
                total += file.bytes;
                attached.push(file);
            }
            if total > 100 * 1024 * 1024 {
                return Err("Attachments exceed 100 MB per message".into());
            }
            if let Some(effort) = s.options.effort.as_deref() {
                let supported = match a.provider.as_str() {
                    "codex" => [
                        "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
                    ]
                    .contains(&effort),
                    "claude" => ["low", "medium", "high", "xhigh", "max"].contains(&effort),
                    _ => false,
                };
                if !supported {
                    return Err("Unsupported reasoning effort".into());
                }
            }
            if s.options
                .model
                .as_ref()
                .is_some_and(|m| m.trim().is_empty() || m.len() > 200)
            {
                return Err("Invalid model ID".into());
            }
            let mut p = p;
            if let Some(original) = &s.execution_project {
                p.path =
                    i.db.projects
                        .iter()
                        .find(|p| &p.id == original)
                        .ok_or("Original execution project no longer exists")?
                        .path
                        .clone();
            }
            if let Some(dir) = &s.working_dir {
                p.path = dir.clone()
            } else if s.options.worktree {
                let path = crate::worktrees::create(Path::new(&p.path), &i.root, &s.id)?;
                p.path = path.to_string_lossy().into();
                s.working_dir = Some(p.path.clone());
            }
            if s.status == "archived" {
                return Err("This worktree was removed. Create a new thread.".into());
            }
            if i.running.contains_key(&s.id) {
                return Err("A turn is already running in this conversation. Queue a message or stop it first.".into());
            }
            s.options.attachments = options.attachments.clone();
            if let Some(key) = &options.request_id {
                s.requests.push(key.clone());
            }
            if existing.is_none() && !options.scheduled {
                i.db.preferences.use_worktree = options.worktree;
            }
            // Claude Code does not restart sub-agents killed with the previous process: tell the main agent
            // which ones died (the stored/visible message stays the user's own text).
            let agent_prompt = match existing
                .is_some()
                .then(|| a.provider == "claude")
                .unwrap_or(false)
                .then(|| crate::background_tasks::take_resume_preface(&mut s.tasks))
                .flatten()
            {
                Some(preface) => format!("{preface}\n\n{prompt}"),
                None => prompt.clone(),
            };
            // Codex has no slash command protocol: the host expands its custom prompts (/prompts:name args).
            let agent_prompt = if a.provider == "codex" {
                crate::commands::expand_codex_prompt(
                    &agent_prompt,
                    crate::commands::default_home("codex", a.config_home.as_deref()).as_deref(),
                )?
            } else {
                agent_prompt
            };
            s.status = "starting".into();
            s.pending = None;
            s.error = None;
            s.updated = now();
            // Queue acceptance already records the send; dispatch must not bump it.
            let from_queue = options.request_id.as_ref().is_some_and(|key| {
                i.db.queues
                    .iter()
                    .any(|q| q.session == s.id && q.messages.iter().any(|m| &m.id == key))
            });
            if !from_queue {
                s.last_user_message_at = Some(s.updated);
            }
            s.messages.push(Message {
                id: id(),
                role: "user".into(),
                text: prompt.clone(),
                attachments: attached,
            });
            let (tx, rx) = mpsc::channel();
            i.running.insert(s.id.clone(), tx);
            if let Some(old) = i.db.sessions.iter_mut().find(|x| x.id == s.id) {
                *old = s.clone()
            } else {
                i.db.sessions.push(s.clone())
            }
            if let Err(e) = write_db(&i) {
                i.running.remove(&s.id);
                return Err(e);
            }
            (s, a, p, i.root.clone(), rx, agent_prompt)
        };
        let sid = session.id.clone();
        let rt = self.clone();
        std::thread::spawn(move || {
            let result = rt.run_turn(&session, &a, &p, &root, &agent_prompt, rx);
            if let Err(e) = result {
                rt.update(&session.id, |s| {
                    s.status = "failed".into();
                    s.error = Some(e);
                    s.pending = None;
                });
            }
            let mut i = rt.0.lock().unwrap();
            i.running.remove(&session.id);
            if i.db
                .sessions
                .iter()
                .any(|s| s.id == session.id && s.status != "done")
            {
                if let Some(q) = i.db.queues.iter_mut().find(|q| q.session == session.id) {
                    q.paused = true;
                }
            }
            let _ = write_db(&i);
        });
        Ok(sid)
    }
    pub fn queue_message(
        &self,
        sid: &str,
        prompt: String,
        mut options: LaunchOptions,
    ) -> Result<()> {
        let _guard = QUEUE_LOCK.lock().unwrap();
        if prompt.trim().is_empty() {
            return Err("Enter a message".into());
        }
        let mut i = self.0.lock().unwrap();
        let session =
            i.db.sessions
                .iter()
                .find(|s| s.id == sid)
                .ok_or("Thread not found")?;
        if session.status == "archived" || session.archived || session.deleted_at.is_some() {
            return Err("Restore or unarchive this thread before queueing messages.".into());
        }
        if !i.db.accounts.iter().any(|a| a.id == session.account) {
            return Err("Account was removed".into());
        }
        for attachment in &options.attachments {
            crate::attachments::load(&i.root, attachment)?;
        }
        let key = options.request_id.clone().unwrap_or_else(id);
        if session.requests.contains(&key)
            || i.db
                .queues
                .iter()
                .any(|q| q.messages.iter().any(|m| m.id == key))
        {
            return Ok(());
        }
        options.request_id = Some(key.clone());
        if !i.db.queues.iter().any(|q| q.session == sid) {
            i.db.queues.push(ThreadQueue {
                session: sid.into(),
                paused: false,
                error: None,
                messages: vec![],
            });
        }
        let queue = i.db.queues.iter_mut().find(|q| q.session == sid).unwrap();
        queue.messages.push(QueuedMessage {
            id: key,
            prompt,
            options,
        });
        i.db.sessions
            .iter_mut()
            .find(|s| s.id == sid)
            .unwrap()
            .last_user_message_at = Some(now());
        write_db(&i)
    }
    pub fn edit_queued_message(&self, sid: &str, key: &str, prompt: String) -> Result<()> {
        let _guard = QUEUE_LOCK.lock().unwrap();
        if prompt.trim().is_empty() {
            return Err("Enter a message".into());
        }
        let mut i = self.0.lock().unwrap();
        let message =
            i.db.queues
                .iter_mut()
                .find(|q| q.session == sid)
                .and_then(|q| q.messages.iter_mut().find(|m| m.id == key))
                .ok_or("Queued message was already sent or removed")?;
        message.prompt = prompt;
        write_db(&i)
    }
    pub fn steer_message(&self, sid: &str, prompt: String, options: LaunchOptions) -> Result<()> {
        let _guard = QUEUE_LOCK.lock().unwrap();
        self.send_steering(
            sid,
            QueuedMessage {
                id: options.request_id.clone().unwrap_or_else(id),
                prompt,
                options,
            },
        )
    }
    fn send_steering(&self, sid: &str, mut message: QueuedMessage) -> Result<()> {
        if message.prompt.trim().is_empty() {
            return Err("Enter a message".into());
        }
        let (tx, rx) = mpsc::channel();
        {
            let i = self.0.lock().unwrap();
            let session =
                i.db.sessions
                    .iter()
                    .find(|s| s.id == sid)
                    .ok_or("Thread not found")?;
            if session.requests.contains(&message.id) {
                return Ok(());
            }
            let account =
                i.db.accounts
                    .iter()
                    .find(|a| a.id == session.account)
                    .ok_or("Account was removed")?;
            if account.provider == "codex" {
                message.prompt = crate::commands::expand_codex_prompt(
                    &message.prompt,
                    crate::commands::default_home("codex", account.config_home.as_deref())
                        .as_deref(),
                )?;
            }
            if session.archived || session.deleted_at.is_some() {
                return Err("Restore or unarchive this thread first".into());
            }
            i.running
                .get(sid)
                .ok_or("No active turn to steer; send or queue the message instead")?
                .send(Control::Steer(message, tx))
                .map_err(|e| e.to_string())?;
        }
        rx.recv_timeout(Duration::from_secs(30)).map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => "Steering confirmation timed out. Check the conversation before retrying; the agent may still accept this message.".to_string(),
            mpsc::RecvTimeoutError::Disconnected => "The active turn ended before steering was accepted. Your message has been kept.".to_string(),
        })?
    }
    // Record delivery once, for every protocol. Failed handoffs leave queued messages intact.
    fn record_steering(&self, sid: &str, message: QueuedMessage) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        let attached = message
            .options
            .attachments
            .iter()
            .map(|key| crate::attachments::load(&i.root, key).map(|x| x.0))
            .collect::<Result<Vec<_>>>()?;
        let session =
            i.db.sessions
                .iter_mut()
                .find(|s| s.id == sid)
                .ok_or("Thread not found")?;
        if session.requests.contains(&message.id) {
            return Ok(());
        }
        session.requests.push(message.id.clone());
        session.last_user_message_at = Some(now());
        session.updated = now();
        session.messages.push(Message {
            id: message.id.clone(),
            role: "user".into(),
            text: message.prompt,
            attachments: attached,
        });
        if let Some(queue) = i.db.queues.iter_mut().find(|q| q.session == sid) {
            queue.messages.retain(|m| m.id != message.id);
        }
        write_db(&i)
    }
    pub fn queue_action(&self, sid: &str, action: &str, message: Option<&str>) -> Result<()> {
        let _guard = QUEUE_LOCK.lock().unwrap();
        if action == "steer" {
            let queued = self
                .0
                .lock()
                .unwrap()
                .db
                .queues
                .iter()
                .find(|q| q.session == sid)
                .and_then(|q| q.messages.iter().find(|m| Some(m.id.as_str()) == message))
                .cloned()
                .ok_or("Queued message was already sent or removed")?;
            return self.send_steering(sid, queued);
        }
        let mut i = self.0.lock().unwrap();
        let queue =
            i.db.queues
                .iter_mut()
                .find(|q| q.session == sid)
                .ok_or("Queue not found")?;
        match action {
            "pause" => queue.paused = true,
            "resume" => {
                queue.paused = false;
                queue.error = None;
            }
            "delete" => queue.messages.retain(|m| Some(m.id.as_str()) != message),
            "clear" => queue.messages.clear(),
            _ => return Err("Unknown queue action".into()),
        }
        write_db(&i)
    }
    pub fn queue_tick(&self) {
        let _guard = QUEUE_LOCK.lock().unwrap();
        let candidates = {
            let mut i = self.0.lock().unwrap();
            if i.shutting_down {
                return;
            }
            let sessions = i.db.sessions.clone();
            let running: Vec<_> = i.running.keys().cloned().collect();
            for q in &mut i.db.queues {
                if let Some(s) = sessions.iter().find(|s| s.id == q.session) {
                    q.messages.retain(|m| !s.requests.contains(&m.id));
                }
            }
            let _ = write_db(&i);
            i.db.queues
                .iter()
                .filter(|q| {
                    !q.paused
                        && !running.contains(&q.session)
                        && sessions.iter().any(|s| {
                            s.id == q.session
                                && !s.archived
                                && s.deleted_at.is_none()
                                && s.status != "archived"
                        })
                })
                .filter_map(|q| {
                    Some((
                        sessions.iter().find(|s| s.id == q.session)?.clone(),
                        q.messages.first()?.clone(),
                    ))
                })
                .collect::<Vec<_>>()
        };
        for (session, message) in candidates {
            let result = self.launch_with(
                session.project,
                None,
                message.prompt,
                Some(session.id.clone()),
                message.options,
            );
            let mut i = self.0.lock().unwrap();
            if let Some(q) = i.db.queues.iter_mut().find(|q| q.session == session.id) {
                match result {
                    Ok(_) => q.messages.retain(|m| m.id != message.id),
                    Err(error) => {
                        q.paused = true;
                        q.error = Some(error);
                    }
                }
            }
            let _ = write_db(&i);
        }
    }
    pub fn stop(&self, sid: &str) -> Result<()> {
        let _guard = QUEUE_LOCK.lock().unwrap();
        {
            let mut i = self.0.lock().unwrap();
            if let Some(q) = i.db.queues.iter_mut().find(|q| q.session == sid) {
                q.paused = true;
            }
            write_db(&i)?;
        }
        self.0
            .lock()
            .unwrap()
            .running
            .get(sid)
            .ok_or("No active turn")?
            .send(Control::Cancel)
            .map_err(|e| e.to_string())
    }
    pub fn stop_all(&self) {
        self.1.stop_all();
        {
            let _guard = QUEUE_LOCK.lock().unwrap();
            let mut i = self.0.lock().unwrap();
            for q in &mut i.db.queues {
                q.paused = true;
            }
            let _ = write_db(&i);
            for tx in i.running.values() {
                let _ = tx.send(Control::Cancel);
            }
        }
        // Quit waits for supervisors to reap process groups, including a bounded auth probe.
        for _ in 0..240 {
            if self.0.lock().unwrap().running.is_empty() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    pub fn respond(&self, sid: &str, request_id: &str, allow: bool, answers: Value) -> Result<()> {
        let mut i = self.0.lock().unwrap();
        let s =
            i.db.sessions
                .iter()
                .find(|s| s.id == sid)
                .ok_or("Thread not found")?;
        let f = s.pending.as_ref().ok_or("Request is no longer pending")?;
        let key = if f["request_id"].is_null() {
            f["id"].to_string()
        } else {
            f["request_id"].to_string()
        };
        if key != request_id {
            return Err("This request has changed; review it again.".into());
        }
        let a =
            i.db.accounts
                .iter()
                .find(|a| a.id == s.account)
                .ok_or("Account not found")?;
        let reply = protocol::approval_response(&a.provider, f, allow, &answers)?;
        i.running
            .get(sid)
            .ok_or("Agent is no longer running")?
            .send(Control::Reply(reply))
            .map_err(|e| e.to_string())?;
        let s = i.db.sessions.iter_mut().find(|s| s.id == sid).unwrap();
        s.pending = None;
        s.status = "running".into();
        write_db(&i)
    }
    fn update(&self, sid: &str, f: impl FnOnce(&mut Session)) {
        self.update_timed(sid, f);
    }
    /// Returns (lock_wait_ms, lock_held_ms, write_db_ms).
    /// Streamed edits only mark the database dirty for the debounced persister. A status or
    /// provider-id change (turn start/finish, waiting, resume handle) is written immediately.
    fn update_timed(&self, sid: &str, f: impl FnOnce(&mut Session)) -> (f64, f64, f64) {
        let t0 = std::time::Instant::now();
        let mut guard = self.0.lock().unwrap();
        let wait = crate::timing::ms(t0);
        let held_from = std::time::Instant::now();
        // Bypass Guard::deref_mut: this path tracks exactly which session changed.
        let i: &mut Inner = &mut guard.g;
        let mut critical = false;
        let mut found = false;
        if let Some(s) = i.db.sessions.iter_mut().find(|s| s.id == sid) {
            let (status, provider) = (s.status.clone(), s.provider_id.clone());
            f(s);
            s.updated = now();
            critical = s.status != status || s.provider_id != provider;
            found = true;
        }
        if found {
            i.revision += 1;
            let rev = i.revision;
            i.session_rev.insert(sid.to_string(), rev);
            i.dirty.store(true, Ordering::SeqCst);
        }
        let w0 = std::time::Instant::now();
        if critical {
            if let Err(e) = write_db(i) {
                eprintln!("Workspace persistence failed: {e}");
            }
        }
        let write = crate::timing::ms(w0);
        (wait, crate::timing::ms(held_from), write)
    }
    fn message(&self, sid: &str, key: String, role: &str, text: String, append: bool) {
        let delta_chars = text.chars().count();
        let msg_id = key.clone();
        let mut new_len = 0usize;
        let (wait, held, write) = self.update_timed(sid, |s| {
            if let Some(m) = s.messages.iter_mut().find(|m| m.id == key) {
                if append {
                    m.text.push_str(&text)
                } else {
                    m.text = text
                }
                new_len = m.text.chars().count();
            } else {
                new_len = text.chars().count();
                s.messages.push(Message {
                    id: key,
                    role: role.into(),
                    text,
                    attachments: vec![],
                })
            }
        });
        crate::timing::log(
            "host",
            format_args!(
                "ev=delta_applied session={sid} message={msg_id} role={role} append={append} delta_chars={delta_chars} new_text_chars={new_len} lock_wait_ms={wait:.2} lock_held_ms={held:.2} write_db_ms={write:.2}"
            ),
        );
    }
    /// Agent thinking as a `reasoning` message, size-capped (see `reasoning::merge`). Empty replacements never erase text.
    fn reasoning(&self, sid: &str, key: String, text: &str, append: bool) {
        if text.is_empty() && !append {
            return;
        }
        self.update(sid, |s| {
            if let Some(m) = s.messages.iter_mut().find(|m| m.id == key) {
                crate::reasoning::merge(&mut m.text, text, append);
            } else {
                let mut body = String::new();
                crate::reasoning::merge(&mut body, text, true);
                s.messages.push(Message {
                    id: key,
                    role: "reasoning".into(),
                    text: body,
                    attachments: vec![],
                });
            }
        });
    }
    fn mark_started(&self, sid: &str) {
        let mut i = self.0.lock().unwrap();
        if let Some(s) = i.db.sessions.iter_mut().find(|s| s.id == sid) {
            s.status = "running".into();
            let aid = s.account.clone();
            let pid = s.project.clone();
            if s.options.scheduled {
                return;
            }
            i.db.preferences.last = Some(aid.clone());
            if let Some(p) = i.db.projects.iter_mut().find(|p| p.id == pid) {
                p.last = Some(aid)
            }
        }
        let _ = write_db(&i);
    }
    fn run_turn(
        &self,
        s: &Session,
        a: &Account,
        p: &Project,
        root: &Path,
        prompt: &str,
        control: mpsc::Receiver<Control>,
    ) -> Result<()> {
        if !is_acp(&a.provider) && !self.auth_status(&a.id)? {
            return Err(
                "Sign in to this account in Accounts, then create or resume a thread.".into(),
            );
        }
        if matches!(control.try_recv(), Ok(Control::Cancel)) {
            self.update(&s.id, |s| s.status = "interrupted".into());
            return Ok(());
        }
        if a.provider == "gemini" && !self.auth_status(&a.id)? {
            return Err("Sign in to Gemini in Accounts before starting this thread.".into());
        }
        let mut cmd = command(a, root)?;
        cmd.current_dir(&p.path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if is_acp(&a.provider) {
            if matches!(a.provider.as_str(), "antigravity" | "opencode" | "cursor") {
                cmd.arg("acp");
            } else if a.provider == "gemini" {
                cmd.arg("--acp");
            } else {
                cmd.args(["agent", "--no-leader"]);
            }
            if !matches!(a.provider.as_str(), "antigravity" | "opencode" | "cursor") {
                if let Some(model) = &s.options.model {
                    cmd.args(["--model", model]);
                }
            }
            if a.provider == "grok" {
                cmd.arg("stdio");
            }
        } else if a.provider == "codex" {
            cmd.args(["app-server", "--stdio"]);
        } else {
            cmd.args([
                "-p",
                "--verbose",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--include-partial-messages",
                "--permission-prompt-tool",
                "stdio",
                "--permission-mode",
                s.options.permission_mode.unwrap_or_default().claude_mode(),
            ]);
            if let Some(model) = &s.options.model {
                cmd.args(["--model", model]);
            }
            if let Some(effort) = &s.options.effort {
                cmd.args(["--effort", effort]);
            }
            if let Some(resume) = &s.provider_id {
                cmd.args(["--resume", resume]);
            }
        }
        crate::computer_use::configure(&mut cmd, &a.provider);
        self.run_protocol(s, a, p, prompt, control, cmd)
    }
    fn run_protocol(
        &self,
        s: &Session,
        a: &Account,
        p: &Project,
        prompt: &str,
        control: mpsc::Receiver<Control>,
        mut cmd: Command,
    ) -> Result<()> {
        let root = self.0.lock().unwrap().root.clone();
        let attachments = crate::attachments::blocks(&root, &s.options.attachments, &a.provider)?;
        #[cfg(windows)]
        let (mut child, job) = crate::windows_process::spawn(&mut cmd).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let guard = Some(job);
        #[cfg(not(windows))]
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        #[cfg(not(windows))]
        let guard = match crate::watchdog::Guard::start(child.id()) {
            Ok(g) => g,
            Err(e) => {
                terminate(&mut child);
                return Err(format!("Cannot supervise agent: {e}"));
            }
        };
        let mut stdin = child.stdin.take().ok_or("Agent stdin unavailable")?;
        let (tx, rx) = mpsc::channel();
        let stdout = child.stdout.take().unwrap();
        let out = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(l) => {
                        if out.send((false, l)).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        let stderr = child.stderr.take().unwrap();
        std::thread::spawn(move || {
            for l in BufReader::new(stderr)
                .lines()
                .map_while(std::result::Result::ok)
            {
                if tx.send((true, l)).is_err() {
                    break;
                }
            }
        });
        fn send(w: &mut impl Write, v: Value) -> Result<()> {
            w.write_all(format!("{v}\n").as_bytes())
                .and_then(|_| w.flush())
                .map_err(|e| e.to_string())
        }
        let mut tracker = crate::background_tasks::Tracker::seeded(s.tasks.clone());
        let result = (|| {
            if is_acp(&a.provider) {
                send(&mut stdin, crate::acp::initialize())?;
            } else if a.provider == "codex" {
                send(
                    &mut stdin,
                    json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"freddai","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
                )?;
            } else {
                send(
                    &mut stdin,
                    json!({"type":"control_request","request_id":"init","request":{"subtype":"initialize","hooks":null}}),
                )?;
            }
            let start = std::time::Instant::now();
            let mut ready = false;
            let mut acp_init = Value::Null;
            let mut acp_session = String::new();
            let mut codex_thread = s.provider_id.clone().unwrap_or_default();
            let mut codex_turn = String::new();
            let mut steering = std::collections::HashMap::<
                String,
                (QueuedMessage, mpsc::Sender<Result<()>>),
            >::new();
            let mut turn_key = id();
            let mut handoff: Option<SteeringHandoff> = None;
            let mut claude_turn_active = true;
            let mut acp_prompt_id = 104_u64;
            let mut pending_queue = std::collections::VecDeque::<Value>::new();
            let mut claude_stream = crate::claude_stream::TextStream::default();
            let mut claude_blocks = crate::claude_stream::BlockIndex::default();
            loop {
                // Expire before sending anything, even when the provider emits a continuous stream.
                if handoff
                    .as_ref()
                    .is_some_and(|h| h.started.elapsed() >= Duration::from_secs(25))
                {
                    let h = handoff.take().unwrap();
                    let _ = h.ack.send(Err("The agent did not finish interrupting in time. Your update was not sent; retry when the turn settles.".into()));
                    if h.turn_ended && tracker.pending() == 0 {
                        self.update(&s.id, |s| {
                            s.status = "interrupted".into();
                            s.pending = None;
                        });
                        return Ok(());
                    }
                }
                if handoff
                    .as_ref()
                    .is_some_and(|h| h.interrupt_ack && h.turn_ended)
                {
                    let h = handoff.take().unwrap();
                    // Clear old permission cards and give the new response separate transcript keys.
                    pending_queue.clear();
                    self.update(&s.id, |s| {
                        s.pending = None;
                        s.status = "running".into();
                        s.error = None;
                    });
                    turn_key = id();
                    claude_stream = crate::claude_stream::TextStream::default();
                    claude_blocks = crate::claude_stream::BlockIndex::default();
                    let result = send(&mut stdin, h.input)
                        .and_then(|_| self.record_steering(&s.id, h.message));
                    let _ = h.ack.send(result.clone());
                    result?;
                    claude_turn_active = true;
                }
                match control.try_recv() {
                    Ok(Control::Cancel) => {
                        self.update(&s.id, |s| {
                            s.status = "interrupted".into();
                            s.pending = None;
                        });
                        return Ok(());
                    }
                    Ok(Control::Steer(message, ack)) => {
                        if a.provider != "codex" {
                            if !ready || handoff.is_some() {
                                let _ = ack.send(Err("The agent is starting or already interrupting. Try again when it is running.".into()));
                                continue;
                            }
                            // Validate attachments before interrupting any work.
                            let blocks = crate::attachments::blocks(
                                &root,
                                &message.options.attachments,
                                &a.provider,
                            );
                            let input = blocks.and_then(|blocks| {
                                if is_acp(&a.provider)
                                    && blocks.iter().any(|b| b["type"] == "image")
                                    && acp_init["agentCapabilities"]["promptCapabilities"]["image"]
                                        != true
                                {
                                    return Err(
                                        "This agent version does not accept image attachments."
                                            .into(),
                                    );
                                }
                                let mut content =
                                    vec![json!({"type":"text","text":message.prompt})];
                                content.extend(blocks);
                                if is_acp(&a.provider) {
                                    Ok(crate::acp::request(
                                        acp_prompt_id + 1000,
                                        "session/prompt",
                                        json!({"sessionId":acp_session,"prompt":content}),
                                    ))
                                } else {
                                    let session = self
                                        .snapshot()
                                        .sessions
                                        .into_iter()
                                        .find(|x| x.id == s.id)
                                        .and_then(|x| x.provider_id)
                                        .unwrap_or_default();
                                    let mut input =
                                        protocol::user_message("claude", &message.prompt, &session);
                                    input["message"]["content"] = json!(content);
                                    input["uuid"] = json!(message.id);
                                    Ok(input)
                                }
                            });
                            let input = match input {
                                Ok(input) => input,
                                Err(error) => {
                                    let _ = ack.send(Err(error));
                                    continue;
                                }
                            };
                            let interrupt = if is_acp(&a.provider) {
                                json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":acp_session}})
                            } else {
                                json!({"type":"control_request","request_id":format!("interrupt-{}", message.id),"request":{"subtype":"interrupt"}})
                            };
                            send(&mut stdin, interrupt)?;
                            // ACP requires cancelled responses for every outstanding permission.
                            let current = self
                                .snapshot()
                                .sessions
                                .into_iter()
                                .find(|x| x.id == s.id)
                                .and_then(|x| x.pending);
                            for frame in current.into_iter().chain(pending_queue.drain(..)) {
                                send(&mut stdin, cancelled_permission(&a.provider, &frame)?)?;
                            }
                            self.update(&s.id, |s| {
                                s.pending = None;
                                s.status = "running".into();
                            });
                            handoff = Some(SteeringHandoff {
                                message,
                                ack,
                                input,
                                started: std::time::Instant::now(),
                                interrupt_ack: is_acp(&a.provider),
                                turn_ended: !is_acp(&a.provider) && !claude_turn_active,
                            });
                        } else if codex_turn.is_empty() {
                            let _ = ack.send(Err("The Codex turn is still starting or has ended. Try again when it is running.".into()));
                        } else {
                            let input = crate::attachments::blocks(
                                &root,
                                &message.options.attachments,
                                "codex",
                            );
                            match input {
                                Err(error) => {
                                    let _ = ack.send(Err(error));
                                }
                                Ok(blocks) => {
                                    let key = format!("steer-{}", message.id);
                                    let mut input = protocol::user_message(
                                        "codex",
                                        &message.prompt,
                                        &codex_thread,
                                    )["params"]["input"]
                                        .as_array()
                                        .unwrap()
                                        .clone();
                                    input.extend(blocks);
                                    send(
                                        &mut stdin,
                                        json!({"id":key,"method":"turn/steer","params":{"threadId":codex_thread,"expectedTurnId":codex_turn,"input":input}}),
                                    )?;
                                    steering.insert(key, (message, ack));
                                }
                            }
                        }
                    }
                    Ok(Control::Reply(v)) => {
                        if handoff.is_some() {
                            continue;
                        }
                        send(&mut stdin, v)?;
                        if let Some(next) = pending_queue.pop_front() {
                            self.update(&s.id, |s| {
                                s.pending = Some(next);
                                s.status = "waiting".into();
                            });
                        }
                    }
                    _ => {}
                }
                if !ready && start.elapsed() > Duration::from_secs(45) {
                    return Err(
                        "Agent initialization timed out. Check CLI version and sign-in.".into(),
                    );
                }
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok((true, _)) => {} // Provider stderr can contain secrets; never persist it in the workspace.
                    Ok((false, line)) => {
                        let Ok(v) = serde_json::from_str::<Value>(&line) else {
                            continue;
                        };
                        crate::timing::log(
                            "host",
                            format_args!(
                                "ev=provider_line session={} provider={} bytes={} kind={}",
                                s.id,
                                a.provider,
                                line.len(),
                                v["method"]
                                    .as_str()
                                    .or_else(|| v["params"]["update"]["sessionUpdate"].as_str())
                                    .or_else(|| v["type"].as_str())
                                    .unwrap_or("response")
                            ),
                        );
                        if handoff.is_some()
                            && (v["method"] == "session/request_permission"
                                || (v["type"] == "control_request"
                                    && v["request"]["subtype"] == "can_use_tool"))
                        {
                            send(&mut stdin, cancelled_permission(&a.provider, &v)?)?;
                            continue;
                        }
                        if is_acp(&a.provider) {
                            if !v["error"].is_null() {
                                return Err(v["error"]["message"]
                                    .as_str()
                                    .unwrap_or("Agent protocol error")
                                    .into());
                            }
                            if v["id"] == 101 && !v["result"].is_null() {
                                acp_init = v["result"].clone();
                                if attachments.iter().any(|b| b["type"] == "image")
                                    && acp_init["agentCapabilities"]["promptCapabilities"]["image"]
                                        != true
                                {
                                    return Err(
                                        "This agent version does not accept image attachments."
                                            .into(),
                                    );
                                }
                                // Antigravity reuses cached Keychain credentials. Never trigger
                                // browser sign-in from a background turn.
                                if matches!(
                                    a.provider.as_str(),
                                    "antigravity" | "opencode" | "cursor"
                                ) {
                                    send(
                                        &mut stdin,
                                        crate::acp::session(
                                            &p.path,
                                            s.provider_id.as_deref(),
                                            &acp_init,
                                        )?,
                                    )?;
                                } else {
                                    send(
                                        &mut stdin,
                                        crate::acp::authenticate(&acp_init, &a.provider)?,
                                    )?;
                                }
                            }
                            if v["id"] == 102 && !v["result"].is_null() {
                                send(
                                    &mut stdin,
                                    crate::acp::session(
                                        &p.path,
                                        s.provider_id.as_deref(),
                                        &acp_init,
                                    )?,
                                )?;
                            }
                            if v["id"] == 103 && !v["result"].is_null() {
                                acp_session = v["result"]["sessionId"]
                                    .as_str()
                                    .or(s.provider_id.as_deref())
                                    .ok_or("Missing ACP session ID")?
                                    .into();
                                self.update(&s.id, |s| s.provider_id = Some(acp_session.clone()));
                                if matches!(
                                    a.provider.as_str(),
                                    "antigravity" | "opencode" | "cursor"
                                ) {
                                    if let Some(model) = &s.options.model {
                                        send(
                                            &mut stdin,
                                            crate::acp::select_model(
                                                &v["result"],
                                                &acp_session,
                                                model,
                                            )?,
                                        )?;
                                    }
                                }
                            }
                            let session_ready = v["id"] == 103
                                && !(matches!(
                                    a.provider.as_str(),
                                    "antigravity" | "opencode" | "cursor"
                                ) && s.options.model.is_some());
                            let model_ready = matches!(
                                a.provider.as_str(),
                                "antigravity" | "opencode" | "cursor"
                            ) && s.options.model.is_some()
                                && v["id"] == 105;
                            if (session_ready || model_ready) && !v["result"].is_null() {
                                let mut input = vec![json!({"type":"text","text":prompt})];
                                input.extend(attachments.clone());
                                send(
                                    &mut stdin,
                                    crate::acp::request(
                                        104,
                                        "session/prompt",
                                        json!({"sessionId":acp_session,"prompt":input}),
                                    ),
                                )?;
                                ready = true;
                                self.mark_started(&s.id);
                            }
                            if v["method"] == "session/request_permission" {
                                if v["params"]["sessionId"] != acp_session {
                                    return Err(
                                        "Permission request belongs to another session".into()
                                    );
                                }
                                if self
                                    .snapshot()
                                    .sessions
                                    .iter()
                                    .any(|x| x.id == s.id && x.pending.is_some())
                                {
                                    pending_queue.push_back(v.clone())
                                } else {
                                    self.update(&s.id, |s| {
                                        s.pending = Some(v.clone());
                                        s.status = "waiting".into();
                                    });
                                }
                            } else if v["method"].is_string() && !v["id"].is_null() {
                                send(
                                    &mut stdin,
                                    json!({"jsonrpc":"2.0","id":v["id"],"error":{"code":-32601,"message":"Client capability not supported"}}),
                                )?;
                            }
                            if v["method"] == "session/update"
                                && v["params"]["sessionId"] == acp_session
                                && v["params"]["update"]["sessionUpdate"]
                                    == "available_commands_update"
                            {
                                crate::commands::record_acp(
                                    &s.id,
                                    &a.provider,
                                    &v["params"]["update"]["availableCommands"],
                                );
                            }
                            if ready
                                && v["method"] == "session/update"
                                && v["params"]["sessionId"] == acp_session
                            {
                                let u = &v["params"]["update"];
                                match u["sessionUpdate"].as_str().unwrap_or("") {
                                    "session_info_update" => {
                                        if let Some(title) = u["title"].as_str() {
                                            self.auto_title(&s.id, "acp", title);
                                        }
                                    }
                                    "agent_message_chunk" => {
                                        if let Some(text) = u["content"]["text"].as_str() {
                                            self.message(
                                                &s.id,
                                                format!("{turn_key}-assistant"),
                                                "assistant",
                                                text.into(),
                                                true,
                                            );
                                        }
                                    }
                                    "agent_thought_chunk" => {
                                        if let Some(text) = u["content"]["text"].as_str() {
                                            self.reasoning(
                                                &s.id,
                                                format!("{turn_key}-thought"),
                                                text,
                                                true,
                                            );
                                        }
                                    }
                                    "tool_call" | "tool_call_update" => self.message(
                                        &s.id,
                                        format!(
                                            "{turn_key}-{}",
                                            u["toolCallId"].as_str().unwrap_or("tool")
                                        ),
                                        "tool",
                                        serde_json::to_string_pretty(u).unwrap_or_default(),
                                        false,
                                    ),
                                    "plan" => self.message(
                                        &s.id,
                                        format!("{turn_key}-plan"),
                                        "tool",
                                        crate::reasoning::acp_plan(u).unwrap_or_else(|| {
                                            serde_json::to_string_pretty(u).unwrap_or_default()
                                        }),
                                        false,
                                    ),
                                    _ => {}
                                }
                            }
                            if v["id"] == acp_prompt_id && !v["result"].is_null() {
                                if let Some(h) = handoff.as_mut() {
                                    h.turn_ended = true;
                                    acp_prompt_id += 1000;
                                    continue;
                                }
                                let reason =
                                    v["result"]["stopReason"].as_str().unwrap_or("unknown");
                                self.update(&s.id, |s| {
                                    s.pending = None;
                                    s.status = if reason == "end_turn" {
                                        "done"
                                    } else if reason == "cancelled" {
                                        "interrupted"
                                    } else {
                                        "failed"
                                    }
                                    .into();
                                    if !["end_turn", "cancelled"].contains(&reason) {
                                        s.error = Some(format!("Agent stopped: {reason}"));
                                    }
                                });
                                return Ok(());
                            }
                        } else if a.provider == "codex" {
                            if let Some((message, ack)) =
                                v["id"].as_str().and_then(|key| steering.remove(key))
                            {
                                if !v["error"].is_null() {
                                    let _ = ack.send(Err(v["error"]["message"]
                                        .as_str()
                                        .unwrap_or("Steering was rejected")
                                        .into()));
                                } else {
                                    let result = self.record_steering(&s.id, message);
                                    let _ = ack.send(result);
                                }
                                continue;
                            }
                            if !v["error"].is_null() {
                                return Err(v["error"]["message"]
                                    .as_str()
                                    .unwrap_or("Codex protocol error")
                                    .into());
                            }
                            if v["id"] == 1 && !v["result"].is_null() {
                                send(&mut stdin, json!({"method":"initialized","params":{}}))?;
                                send(&mut stdin, {
                                    let mut v = protocol::codex_start(
                                        &p.path,
                                        s.provider_id.as_deref(),
                                        s.options.permission_mode.unwrap_or_default(),
                                    );
                                    if let Some(model) = &s.options.model {
                                        v["params"]["model"] = json!(model);
                                    }
                                    v
                                })?;
                            }
                            if v["id"] == 2 && !v["result"].is_null() {
                                let tid = v["result"]["thread"]["id"]
                                    .as_str()
                                    .ok_or("Missing Codex session ID")?;
                                codex_thread = tid.into();
                                self.update(&s.id, |s| s.provider_id = Some(tid.into()));
                                send(&mut stdin, {
                                    let mut v = protocol::user_message("codex", prompt, tid);
                                    v["params"]["input"]
                                        .as_array_mut()
                                        .unwrap()
                                        .extend(attachments.clone());
                                    if let Some(e) = &s.options.effort {
                                        v["params"]["effort"] = json!(e);
                                    }
                                    v
                                })?;
                            }
                            if v["id"] == 3 && !v["result"].is_null() {
                                codex_turn =
                                    v["result"]["turn"]["id"].as_str().unwrap_or("").into();
                                ready = true;
                                self.mark_started(&s.id);
                            }
                            let method = v["method"].as_str().unwrap_or("");
                            let params = &v["params"];
                            if !v["id"].is_null() && !method.is_empty() {
                                if protocol::approval_response("codex", &v, false, &json!({}))
                                    .is_err()
                                {
                                    send(
                                        &mut stdin,
                                        json!({"id":v["id"],"error":{"code":-32601,"message":"This interaction is not supported by Freddai yet"}}),
                                    )?;
                                    self.message(
                                        &s.id,
                                        id(),
                                        "notice",
                                        format!("Unsupported interaction: {method}"),
                                        false,
                                    );
                                } else {
                                    if self
                                        .snapshot()
                                        .sessions
                                        .iter()
                                        .any(|x| x.id == s.id && x.pending.is_some())
                                    {
                                        pending_queue.push_back(v.clone());
                                    } else {
                                        self.update(&s.id, |s| {
                                            s.pending = Some(v.clone());
                                            s.status = "waiting".into();
                                        });
                                    }
                                }
                            }
                            if method == "turn/started" && params["threadId"] == codex_thread {
                                codex_turn = params["turn"]["id"].as_str().unwrap_or("").into();
                            }
                            if method == "thread/name/updated" && params["threadId"] == codex_thread
                            {
                                if let Some(title) = params["threadName"].as_str() {
                                    self.auto_title(&s.id, "codex", title);
                                }
                            }
                            if method == "thread/tokenUsage/updated" {
                                if let Some(usage) =
                                    crate::conversation_usage::codex(params, &codex_thread)
                                {
                                    self.update(&s.id, |s| s.usage = Some(usage));
                                }
                            }
                            if method == "item/agentMessage/delta" {
                                let key = params["itemId"].as_str().unwrap_or("assistant");
                                self.message(
                                    &s.id,
                                    format!("{turn_key}-{key}"),
                                    "assistant",
                                    params["delta"].as_str().unwrap_or("").into(),
                                    true,
                                );
                            }
                            if method == "turn/plan/updated" {
                                if let Some(plan) = crate::reasoning::codex_plan(params) {
                                    self.message(
                                        &s.id,
                                        format!("{turn_key}-plan"),
                                        "tool",
                                        plan,
                                        false,
                                    );
                                }
                            }
                            if method == "item/reasoning/summaryTextDelta"
                                || method == "item/reasoning/textDelta"
                            {
                                if let Some(delta) = params["delta"].as_str() {
                                    let key = params["itemId"].as_str().unwrap_or("reasoning");
                                    self.reasoning(&s.id, format!("{turn_key}-{key}"), delta, true);
                                }
                            }
                            if method == "item/reasoning/summaryPartAdded"
                                && params["summaryIndex"].as_u64().unwrap_or(0) > 0
                            {
                                let key = params["itemId"].as_str().unwrap_or("reasoning");
                                self.reasoning(&s.id, format!("{turn_key}-{key}"), "\n\n", true);
                            }
                            if method == "item/completed" {
                                let item = &params["item"];
                                let key = item["id"].as_str().unwrap_or("item");
                                let kind = item["type"].as_str().unwrap_or("");
                                if kind == "agentMessage" {
                                    self.message(
                                        &s.id,
                                        format!("{turn_key}-{key}"),
                                        "assistant",
                                        item["text"].as_str().unwrap_or("").into(),
                                        false,
                                    )
                                } else if kind == "reasoning" {
                                    self.reasoning(
                                        &s.id,
                                        format!("{turn_key}-{key}"),
                                        &crate::reasoning::codex_reasoning(item),
                                        false,
                                    )
                                } else if ["commandExecution", "fileChange", "mcpToolCall"]
                                    .contains(&kind)
                                {
                                    self.message(
                                        &s.id,
                                        format!("{turn_key}-{key}"),
                                        "tool",
                                        serde_json::to_string_pretty(item).unwrap_or_default(),
                                        false,
                                    )
                                }
                            }
                            if method == "turn/completed" {
                                let status = params["turn"]["status"].as_str().unwrap_or("failed");
                                self.update(&s.id, |s| {
                                    s.status = if status == "completed" {
                                        "done"
                                    } else if status == "interrupted" {
                                        "interrupted"
                                    } else {
                                        "failed"
                                    }
                                    .into();
                                    s.error = params["turn"]["error"]["message"]
                                        .as_str()
                                        .map(String::from);
                                    s.pending = None;
                                });
                                if status == "completed" {
                                    self.spawn_codex_title(s, a, p, &root);
                                }
                                return Ok(());
                            }
                        } else {
                            if v["type"] == "control_response"
                                && handoff.as_ref().is_some_and(|h| {
                                    v["response"]["request_id"]
                                        == format!("interrupt-{}", h.message.id)
                                })
                            {
                                if v["response"]["subtype"] == "error" {
                                    let h = handoff.take().unwrap();
                                    let _ = h.ack.send(Err(v["response"]["error"].as_str().unwrap_or("The agent rejected interruption; your update was not sent.").into()));
                                    if h.turn_ended {
                                        self.update(&s.id, |s| {
                                            s.status = "interrupted".into();
                                            s.pending = None;
                                        });
                                        return Ok(());
                                    }
                                } else {
                                    handoff.as_mut().unwrap().interrupt_ack = true;
                                }
                                continue;
                            }
                            if matches!(v["type"].as_str(), Some("assistant" | "stream_event"))
                                && v["parent_tool_use_id"].is_null()
                            {
                                claude_turn_active = true;
                            }
                            if tracker.observe(&v, std::time::Instant::now()) {
                                crate::timing::log("host", format_args!("ev=background_tasks.changed session={} pending={} tasks={}", s.id, tracker.pending(), tracker.tasks().len()));
                                self.update(&s.id, |s| s.tasks = tracker.tasks().to_vec());
                            }
                            if let Some((key, text, append)) = claude_stream.accept(&v) {
                                self.message(&s.id, key, "assistant", text, append);
                            }
                            if let Some((key, text, append)) = claude_stream.accept_thinking(&v) {
                                self.reasoning(&s.id, key, &text, append);
                            }
                            if v["type"] == "control_response"
                                && v["response"]["request_id"] == "init"
                            {
                                if v["response"]["subtype"] == "error" {
                                    return Err("Claude initialization rejected".into());
                                }
                                let needs_title = {
                                    let i = self.0.lock().unwrap();
                                    i.db.sessions
                                        .iter()
                                        .find(|session| session.id == s.id)
                                        .is_some_and(|session| {
                                            session.title_manual == Some(false)
                                                && session
                                                    .messages
                                                    .iter()
                                                    .filter(|m| m.role == "user")
                                                    .count()
                                                    <= 1
                                        })
                                };
                                if needs_title {
                                    // Claude's tool-free helper generates metadata independently of the working turn.
                                    // Older CLI versions reject this request; the local fallback remains usable.
                                    crate::timing::log("host", format_args!("ev=thread_title.requested session={} provider=claude route=generate_session_title", s.id));
                                    send(
                                        &mut stdin,
                                        json!({"type":"control_request","request_id":"freddai-title","request":{"subtype":"generate_session_title","description":prompt,"persist":false}}),
                                    )?;
                                }
                                send(&mut stdin, {
                                    let mut v = protocol::user_message(
                                        "claude",
                                        prompt,
                                        s.provider_id.as_deref().unwrap_or(""),
                                    );
                                    let mut content = vec![json!({"type":"text","text":prompt})];
                                    content.extend(attachments.clone());
                                    v["message"]["content"] = json!(content);
                                    v
                                })?;
                                ready = true;
                            }
                            if v["type"] == "control_response"
                                && v["response"]["request_id"] == "freddai-title"
                            {
                                if let Some(title) = v["response"]["response"]["title"].as_str() {
                                    self.auto_title(&s.id, "claude", title);
                                } else {
                                    crate::timing::log("host", format_args!("ev=thread_title.failed session={} provider=claude reason={:?}", s.id, v["response"]["error"].as_str().unwrap_or("response carried no title")));
                                }
                            }
                            if v["type"] == "system" && v["subtype"] == "session_title_changed" {
                                if let Some(title) = v["title"].as_str() {
                                    self.auto_title(&s.id, "claude", title);
                                }
                            }
                            if v["type"] == "system" && v["subtype"] == "init" {
                                crate::commands::record_claude_init(&s.id, &v["slash_commands"]);
                                if let Some(tid) = v["session_id"].as_str() {
                                    self.update(&s.id, |s| s.provider_id = Some(tid.into()));
                                }
                                self.mark_started(&s.id);
                            }
                            if v["type"] == "assistant" {
                                if let Some(usage) =
                                    crate::conversation_usage::claude(&v["message"])
                                {
                                    self.update(&s.id, |s| s.usage = Some(usage));
                                }
                                if let Some(blocks) = v["message"]["content"].as_array() {
                                    let message_id =
                                        v["message"]["id"].as_str().unwrap_or(&turn_key);
                                    let indexes = claude_blocks.indexes(message_id, blocks.len());
                                    for (n, b) in indexes.zip(blocks.iter()) {
                                        let key = format!("{message_id}-{n}");
                                        if b["type"] == "text" {
                                            self.message(
                                                &s.id,
                                                key,
                                                "assistant",
                                                b["text"].as_str().unwrap_or("").into(),
                                                false,
                                            )
                                        } else if b["type"] == "thinking" {
                                            self.reasoning(
                                                &s.id,
                                                key,
                                                b["thinking"].as_str().unwrap_or(""),
                                                false,
                                            )
                                        } else if b["type"] == "tool_use" {
                                            self.message(
                                                &s.id,
                                                key,
                                                "tool",
                                                serde_json::to_string_pretty(b).unwrap_or_default(),
                                                false,
                                            )
                                        }
                                    }
                                }
                            }
                            if v["type"] == "user" {
                                if let Some(blocks) = v["message"]["content"].as_array() {
                                    for block in blocks {
                                        if block["type"] == "tool_result" {
                                            let key = format!(
                                                "result-{}",
                                                block["tool_use_id"].as_str().unwrap_or(&turn_key)
                                            );
                                            self.message(
                                                &s.id,
                                                key,
                                                "tool",
                                                serde_json::to_string_pretty(block)
                                                    .unwrap_or_default(),
                                                false,
                                            );
                                        }
                                    }
                                }
                            }
                            if v["type"] == "control_request" {
                                if protocol::approval_response("claude", &v, false, &json!({}))
                                    .is_err()
                                {
                                    send(
                                        &mut stdin,
                                        json!({"type":"control_response","response":{"subtype":"error","request_id":v["request_id"],"error":"Unsupported request"}}),
                                    )?
                                } else {
                                    if self
                                        .snapshot()
                                        .sessions
                                        .iter()
                                        .any(|x| x.id == s.id && x.pending.is_some())
                                    {
                                        pending_queue.push_back(v.clone());
                                    } else {
                                        self.update(&s.id, |s| {
                                            s.pending = Some(v.clone());
                                            s.status = "waiting".into();
                                        });
                                    }
                                }
                            }
                            if v["type"] == "result" {
                                claude_turn_active = false;
                                if let Some(h) = handoff.as_mut() {
                                    h.turn_ended = true;
                                    continue;
                                }
                                let failed = v["is_error"].as_bool().unwrap_or(true);
                                if !failed
                                    && tracker.on_result() == crate::background_tasks::Settle::Hold
                                {
                                    // Claude Code answered while background sub-agents still run. Keep the process and
                                    // stream open: it wakes the main agent with their notifications, then sends another result.
                                    crate::timing::log("host", format_args!("ev=background_tasks.hold session={} pending={} names={:?}", s.id, tracker.pending(), tracker.pending_names()));
                                    self.update(&s.id, |s| {
                                        if s.pending.is_none() {
                                            s.status = "running".into()
                                        }
                                    });
                                    continue;
                                }
                                self.update(&s.id,|s|{s.status=if failed{"failed"}else{"done"}.into();s.pending=None;if failed{s.error=Some(v["result"].as_str().unwrap_or("Claude turn failed. Check account and CLI configuration.").into())}});
                                return Ok(());
                            }
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        return Err("Agent disconnected before confirming completion".into())
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if handoff.is_none()
                            && tracker
                                .wake_overdue(Duration::from_secs(90), std::time::Instant::now())
                        {
                            crate::timing::log(
                                "host",
                                format_args!(
                                    "ev=background_tasks.wake_missing session={} tasks={}",
                                    s.id,
                                    tracker.tasks().len()
                                ),
                            );
                            self.update(&s.id, |s| {
                                s.status = "done".into();
                                s.pending = None;
                            });
                            return Ok(());
                        }
                        if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                            return Err(format!("Agent exited before confirming completion ({exit}). Check sign-in and CLI version."));
                        }
                    }
                }
            }
        })();
        let mut result = result;
        if tracker.pending() > 0 {
            // The agent process is going away with sub-agents unfinished: never leave them "running" or flip the thread to Completed.
            let stopped = self
                .0
                .lock()
                .unwrap()
                .db
                .sessions
                .iter()
                .any(|x| x.id == s.id && x.status == "interrupted");
            let (status, why) = if stopped {
                ("stopped", "Stopped with the thread.")
            } else {
                (
                    "failed",
                    "The agent process ended before this sub-agent reported back.",
                )
            };
            let names = tracker.pending_names();
            tracker.fail_pending(status, why);
            crate::timing::log("host", format_args!("ev=background_tasks.lost session={} status={status} count={} names={names:?} turn_error={:?}", s.id, names.len(), result.as_ref().err()));
            self.update(&s.id, |s| s.tasks = tracker.tasks().to_vec());
            if let Err(e) = &result {
                result = Err(format!(
                    "{e} {} background sub-agent(s) did not finish: {}.",
                    names.len(),
                    names.join(", ")
                ));
            }
        }
        if guard.is_some() {
            drop(guard);
            let _ = child.wait();
        } else {
            terminate(&mut child);
        }
        result
    }
}
pub(crate) fn terminate(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(100));
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
/// One session the user chose to import. The file is located by id inside the chosen account's CLI home;
/// the client never supplies a path.
#[derive(Clone, Deserialize)]
pub struct ImportRequest {
    pub provider: String,
    pub session_id: String,
    pub account: String,
    #[serde(default)]
    pub create_project: bool,
}
#[derive(Clone, Serialize, Debug)]
pub struct ImportOutcome {
    pub session_id: String,
    pub thread: Option<String>,
    /// Already owned by Freddai; nothing was changed.
    pub skipped: bool,
    pub truncated: bool,
    pub error: Option<String>,
}
fn account_home(a: &Account, root: &Path) -> PathBuf {
    a.config_home
        .clone()
        .unwrap_or_else(|| root.join("accounts").join(&a.id))
}
/// The CLI homes a user's own terminal sessions write to (not owned by any Freddai account unless matched).
pub fn default_import_roots() -> Vec<crate::import::ImportRoot> {
    let home = crate::platform::home_dir();
    [
        ("claude", "CLAUDE_CONFIG_DIR", ".claude"),
        ("codex", "CODEX_HOME", ".codex"),
    ]
    .iter()
    .filter_map(|(provider, env, folder)| {
        let dir = std::env::var_os(env)
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|h| h.join(folder)))?;
        Some(crate::import::ImportRoot {
            provider: provider.to_string(),
            home: dir,
            account: None,
        })
    })
    .collect()
}
const IMPORT_COLORS: [&str; 6] = [
    "#8ec6a2", "#7aa2f7", "#e0af68", "#bb9af7", "#f7768e", "#73daca",
];
impl Runtime {
    pub fn import_candidates(&self) -> Result<Vec<crate::import::ImportCandidate>> {
        self.import_candidates_with(default_import_roots())
    }
    /// Sessions found in every Freddai account home plus `defaults`, minus those Freddai already owns.
    pub fn import_candidates_with(
        &self,
        defaults: Vec<crate::import::ImportRoot>,
    ) -> Result<Vec<crate::import::ImportCandidate>> {
        let (roots, owned, projects) = {
            let i = self.0.lock().unwrap();
            let mut roots: Vec<crate::import::ImportRoot> =
                i.db.accounts
                    .iter()
                    .filter(|a| matches!(a.provider.as_str(), "claude" | "codex"))
                    .map(|a| crate::import::ImportRoot {
                        provider: a.provider.clone(),
                        home: account_home(a, &i.root),
                        account: Some(a.id.clone()),
                    })
                    .collect();
            roots.extend(defaults);
            let owned: std::collections::HashSet<String> =
                i.db.sessions
                    .iter()
                    .filter_map(|s| s.provider_id.clone())
                    .collect();
            let projects: Vec<(String, String)> =
                i.db.projects
                    .iter()
                    .map(|p| (p.id.clone(), p.path.clone()))
                    .collect();
            (roots, owned, projects)
        };
        // Same directory reached twice (account + default) is scanned once, attributed to the account.
        let mut seen = std::collections::HashSet::new();
        let roots: Vec<_> = roots
            .into_iter()
            .filter(|r| {
                fs::canonicalize(&r.home)
                    .map(|h| seen.insert((r.provider.clone(), h)))
                    .unwrap_or(false)
            })
            .collect();
        let mut found = crate::import::discover(&roots);
        found.retain(|c| !owned.contains(&c.session_id));
        for c in &mut found {
            if let Some(cwd) = &c.cwd {
                let canonical = fs::canonicalize(cwd)
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned());
                c.cwd_exists = canonical.is_some();
                c.project = projects
                    .iter()
                    .find(|(_, path)| path == cwd || Some(path) == canonical.as_ref())
                    .map(|(id, _)| id.clone());
            }
        }
        Ok(found)
    }
    pub fn import_sessions(&self, requests: Vec<ImportRequest>) -> Result<Vec<ImportOutcome>> {
        if requests.is_empty() {
            return Err("Select at least one session to import".into());
        }
        if requests.len() > 200 {
            return Err("Import at most 200 sessions at a time".into());
        }
        Ok(requests
            .into_iter()
            .map(|r| {
                let session_id = r.session_id.clone();
                match self.import_one(&r) {
                    Ok(o) => o,
                    Err(error) => ImportOutcome {
                        session_id,
                        thread: None,
                        skipped: false,
                        truncated: false,
                        error: Some(error),
                    },
                }
            })
            .collect())
    }
    fn import_one(&self, r: &ImportRequest) -> Result<ImportOutcome> {
        let (account, root) = {
            let i = self.0.lock().unwrap();
            if i.shutting_down {
                return Err("Host is upgrading. Try again shortly.".into());
            }
            if let Some(existing) =
                i.db.sessions
                    .iter()
                    .find(|s| s.provider_id.as_deref() == Some(r.session_id.as_str()))
            {
                return Ok(ImportOutcome {
                    session_id: r.session_id.clone(),
                    thread: Some(existing.id.clone()),
                    skipped: true,
                    truncated: false,
                    error: None,
                });
            }
            let a =
                i.db.accounts
                    .iter()
                    .find(|a| a.id == r.account)
                    .cloned()
                    .ok_or("Account not found. Connect this CLI sign-in in Accounts first.")?;
            (a, i.root.clone())
        };
        if account.provider != r.provider {
            return Err(format!(
                "This session belongs to {}, not the selected account's agent.",
                r.provider
            ));
        }
        let home = account_home(&account, &root);
        let path = crate::import::locate(&r.provider, &home, &r.session_id)
            .ok_or("Session file not found in this account's CLI folder. It may have been deleted or moved.")?;
        let head = crate::import::header(&r.provider, &path)
            .ok_or("This file is not an importable session (no user prompt found).")?;
        let cwd = head
            .cwd
            .clone()
            .ok_or("This session does not record its working folder.")?;
        let canonical = fs::canonicalize(&cwd)
            .map_err(|_| format!("The session's folder no longer exists: {cwd}"))?;
        if !canonical.is_dir() {
            return Err(format!("The session's folder is not a directory: {cwd}"));
        }
        let canonical = canonical.to_string_lossy().into_owned();
        let transcript = crate::import::transcript(&r.provider, &path)?;
        let mut i = self.0.lock().unwrap();
        if let Some(existing) =
            i.db.sessions
                .iter()
                .find(|s| s.provider_id.as_deref() == Some(r.session_id.as_str()))
        {
            return Ok(ImportOutcome {
                session_id: r.session_id.clone(),
                thread: Some(existing.id.clone()),
                skipped: true,
                truncated: false,
                error: None,
            });
        }
        let previous = i.db.clone();
        let project = match i
            .db
            .projects
            .iter()
            .find(|p| p.path == canonical)
            .map(|p| p.id.clone())
        {
            Some(id) => id,
            None if r.create_project => {
                let name = Path::new(&canonical)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| canonical.clone());
                let project = Project {
                    id: id(),
                    name,
                    path: canonical.clone(),
                    color: IMPORT_COLORS[i.db.projects.len() % IMPORT_COLORS.len()].into(),
                    policy: "inherit".into(),
                    account: None,
                    last: None,
                };
                let pid = project.id.clone();
                i.db.projects.push(project);
                pid
            }
            None => {
                return Err(format!(
                "No Freddai project for {canonical}. Confirm creating it to import this session."
            ))
            }
        };
        let updated = head.updated;
        let session: Session = serde_json::from_value(json!({
            "id": id(), "project": project, "account": account.id, "title": head.title, "title_manual": false,
            "status": "done", "updated": updated, "last_user_message_at": updated,
            // Imported history is not "new": it must not light up unread indicators.
            "read_at": updated,
            "provider_id": r.session_id, "messages": transcript.messages, "pending": null, "error": null,
        })).map_err(|e| e.to_string())?;
        let thread = session.id.clone();
        i.db.sessions.push(session);
        if let Err(e) = write_db(&i) {
            i.db = previous;
            return Err(e);
        }
        Ok(ImportOutcome {
            session_id: r.session_id.clone(),
            thread: Some(thread),
            skipped: false,
            truncated: transcript.truncated,
            error: None,
        })
    }
}
#[cfg(test)]
mod tests {
    use crate::platform::is_executable;
    use super::*;
    #[test]
    fn thread_actions_preserve_identity_history_and_execution_folder() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.projects = vec![
                project(),
                Project {
                    id: "other".into(),
                    path: "/other".into(),
                    ..project()
                },
            ];
            i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"p","account":"a","title":"Keep","status":"done","updated":42,"provider_id":"saved","messages":[{"id":"m","role":"user","text":"History"}],"pending":null,"error":null})).unwrap());
            i.db.queues.push(ThreadQueue {
                session: "thread".into(),
                paused: false,
                error: None,
                messages: vec![],
            });
        }
        rt.thread_action("thread", "move", Some("other")).unwrap();
        let moved = rt.snapshot().sessions[0].clone();
        assert_eq!(moved.project, "other");
        assert_eq!(moved.execution_project.as_deref(), Some("p"));
        assert_eq!(moved.account, "a");
        assert_eq!(moved.provider_id.as_deref(), Some("saved"));
        assert_eq!(moved.messages[0].text, "History");
        rt.thread_action("thread", "archive", None).unwrap();
        assert!(rt.snapshot().sessions[0].archived);
        assert!(rt.snapshot().queues[0].paused);
        assert!(rt
            .launch(
                "other".into(),
                None,
                "No launch".into(),
                Some("thread".into())
            )
            .is_err());
        rt.thread_action("thread", "unarchive", None).unwrap();
        rt.thread_action("thread", "delete", None).unwrap();
        assert!(rt.snapshot().sessions[0].deleted_at.is_some());
        assert_eq!(rt.snapshot().sessions[0].messages.len(), 1);
        assert!(rt
            .queue_message("thread", "No queue".into(), LaunchOptions::default())
            .is_err());
        rt.thread_action("thread", "restore", None).unwrap();
        assert!(rt.snapshot().sessions[0].deleted_at.is_none());
        let reopened = Runtime::open(root.clone()).unwrap().snapshot();
        assert_eq!(reopened.sessions[0].execution_project.as_deref(), Some("p"));
        assert_eq!(reopened.sessions[0].provider_id.as_deref(), Some("saved"));
        assert!(rt.thread_action("thread", "move", Some("missing")).is_err());
        assert!(rt.thread_action("missing", "delete", None).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shared_folder_allows_new_and_moved_conversations_but_not_duplicate_turns() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db = db();
            // An unsupported provider ensures this test cannot invoke a real CLI or account.
            for account in &mut i.db.accounts {
                account.provider = "offline-concurrency-fixture".into();
            }
            i.db.projects = vec![
                project(),
                Project {
                    id: "other".into(),
                    path: "/other".into(),
                    ..project()
                },
            ];
            for (sid, status) in [("moving", "done"), ("active", "running")] {
                i.db.sessions.push(serde_json::from_value(json!({"id":sid,"project":"p","account":"a","title":"Keep","status":status,"updated":42,"provider_id":"saved","messages":[],"pending":null,"error":null})).unwrap());
            }
            i.running.insert("active".into(), mpsc::channel().0);
        }
        let new = rt
            .launch("p".into(), None, "New conversation".into(), None)
            .unwrap();
        rt.thread_action("moving", "move", Some("other")).unwrap();
        assert_eq!(
            rt.launch(
                "other".into(),
                None,
                "Continue".into(),
                Some("moving".into())
            )
            .unwrap(),
            "moving"
        );
        let error = rt
            .launch("p".into(), None, "Duplicate".into(), Some("active".into()))
            .unwrap_err();
        assert!(
            error.contains("already running in this conversation"),
            "{error}"
        );
        assert!(rt
            .snapshot()
            .sessions
            .iter()
            .find(|s| s.id == "active")
            .unwrap()
            .messages
            .is_empty());
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let i = rt.0.lock().unwrap();
            if !i.running.contains_key(&new) && !i.running.contains_key("moving") {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Offline launches did not finish"
            );
            drop(i);
            std::thread::sleep(Duration::from_millis(10));
        }
        let snapshot = rt.snapshot();
        let moved = snapshot.sessions.iter().find(|s| s.id == "moving").unwrap();
        assert_eq!(moved.execution_project.as_deref(), Some("p"));
        assert_eq!(moved.messages[0].text, "Continue");
        assert!(snapshot.sessions.iter().find(|s| s.id == new).is_some());
        rt.0.lock().unwrap().running.clear();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn delete_active_or_stale_thread_without_waiting_for_worker() {
        for status in ["starting", "running", "waiting", "failed"] {
            for connected in [true, false] {
                let root = std::env::temp_dir().join(id());
                let rt = Runtime::open(root.clone()).unwrap();
                let (tx, rx) = mpsc::channel();
                {
                    let mut i = rt.0.lock().unwrap();
                    i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"p","account":"a","title":"Keep","status":status,"updated":42,"provider_id":"saved","messages":[],"pending":{"id":7},"error":null})).unwrap());
                    if connected {
                        i.running.insert("thread".into(), tx);
                    }
                }
                rt.thread_action("thread", "delete", None).unwrap();
                let session = &rt.snapshot().sessions[0];
                assert!(session.deleted_at.is_some());
                assert_eq!(session.status, "interrupted");
                assert!(session.pending.is_none());
                assert_eq!(session.provider_id.as_deref(), Some("saved"));
                if connected {
                    assert!(matches!(rx.try_recv(), Ok(Control::Cancel)));
                }
                assert!(Runtime::open(root.clone()).unwrap().snapshot().sessions[0]
                    .deleted_at
                    .is_some());
                fs::remove_dir_all(root).unwrap();
            }
        }
    }
    #[test]
    fn archive_and_purge_cancel_workers_and_persist_removal() {
        for action in ["archive", "purge"] {
            for status in ["failed", "starting", "running", "waiting"] {
                let root = std::env::temp_dir().join(id());
                let rt = Runtime::open(root.clone()).unwrap();
                let (tx, rx) = mpsc::channel();
                {
                    let mut i = rt.0.lock().unwrap();
                    i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"p","account":"missing","title":"Remove","status":status,"updated":42,"provider_id":null,"messages":[],"pending":{"id":7},"error":null})).unwrap());
                    i.db.queues.push(ThreadQueue {
                        session: "thread".into(),
                        paused: false,
                        error: None,
                        messages: vec![],
                    });
                    i.running.insert("thread".into(), tx);
                }
                rt.thread_action("thread", action, None).unwrap();
                assert!(matches!(rx.try_recv(), Ok(Control::Cancel)));
                // Late output from a cancelled worker cannot recreate a purged session.
                rt.update("thread", |s| s.error = Some("Late output".into()));
                let snapshot = Runtime::open(root.clone()).unwrap().snapshot();
                if action == "purge" {
                    assert!(snapshot.sessions.is_empty());
                    assert!(snapshot.queues.is_empty());
                } else {
                    assert!(snapshot.sessions[0].archived);
                    assert!(snapshot.sessions[0].pending.is_none());
                    assert!(snapshot.queues[0].paused);
                }
                rt.0.lock().unwrap().running.clear();
                fs::remove_dir_all(root).unwrap();
            }
        }
    }
    #[test]
    fn thread_actions_refuse_active_work() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"p","account":"a","title":"Keep","status":"waiting","updated":42,"provider_id":"saved","messages":[],"pending":{"id":7},"error":null})).unwrap());
            i.running.insert("thread".into(), mpsc::channel().0);
        }
        for action in ["move"] {
            assert!(rt
                .thread_action("thread", action, Some("p"))
                .unwrap_err()
                .contains("Stop"));
        }
        assert!(rt.snapshot().sessions[0].pending.is_some());
        rt.0.lock().unwrap().running.clear();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rename_persists_only_the_title_and_rejects_invalid_requests() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"missing","account":"missing","title":"Original","status":"waiting","updated":42,"provider_id":"saved","messages":[{"id":"message","role":"user","text":"Keep me","time":1}],"pending":null,"error":null})).unwrap());
            write_db(&i).unwrap();
        }
        let before = serde_json::to_value(&rt.snapshot().sessions[0]).unwrap();
        crate::host::dispatch(
            &rt,
            "rename_session",
            json!({"session":"thread","title":"  New title  "}),
        )
        .unwrap();
        let mut expected = before.clone();
        expected["title"] = json!("New title");
        expected["title_manual"] = json!(true);
        assert_eq!(
            serde_json::to_value(&rt.snapshot().sessions[0]).unwrap(),
            expected
        );
        assert!(rt.rename_session("thread", "  ").is_err());
        assert!(rt.rename_session("missing", "Title").is_err());
        let persisted: Value =
            serde_json::from_slice(&fs::read(root.join("workspace.json")).unwrap()).unwrap();
        assert_eq!(persisted["sessions"][0], expected);
        let reopened = Runtime::open(root.clone()).unwrap();
        assert_eq!(reopened.snapshot().sessions[0].title, "New title");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn automatic_titles_preserve_manual_names_and_legacy_custom_names() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            for (sid, title, flag) in [
                ("auto", "Prompt", json!(false)),
                ("legacy", "Custom", Value::Null),
                ("original", "Prompt", Value::Null),
            ] {
                i.db.sessions.push(serde_json::from_value(json!({"id":sid,"project":"p","account":"a","title":title,"title_manual":flag,"status":"running","updated":42,"provider_id":"provider","messages":[{"id":"m","role":"user","text":"Prompt","time":1}],"pending":null,"error":null})).unwrap());
            }
        }
        rt.auto_title("auto", "test", "  Better title  ");
        rt.auto_title("legacy", "test", "Replacement");
        rt.auto_title("original", "test", "Provider title");
        assert_eq!(rt.snapshot().sessions[0].title, "Better title");
        assert_eq!(rt.snapshot().sessions[1].title, "Custom");
        assert_eq!(rt.snapshot().sessions[2].title, "Provider title");
        rt.rename_session("auto", "My name").unwrap();
        rt.auto_title("auto", "test", "Late provider title");
        let reopened = Runtime::open(root.clone()).unwrap();
        assert_eq!(reopened.snapshot().sessions[0].title, "My name");
        assert_eq!(reopened.snapshot().sessions[0].title_manual, Some(true));
        rt.auto_title("auto", "test", "   ");
        assert_eq!(rt.snapshot().sessions[0].title, "My name");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn connection_rename_only_changes_label_and_persists() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db = db();
            i.db.accounts[0].config_home = Some(root.join("external-cli"));
            i.db.accounts[0].claude_default_config = true;
            write_db(&i).unwrap();
        }
        let before = serde_json::to_value(rt.snapshot()).unwrap();
        crate::host::dispatch(
            &rt,
            "rename_account",
            json!({"account":"a","name":"  Work connection  "}),
        )
        .unwrap();
        let mut expected = before;
        expected["accounts"][0]["name"] = json!("Work connection");
        assert_eq!(serde_json::to_value(rt.snapshot()).unwrap(), expected);
        assert!(
            crate::host::dispatch(&rt, "rename_account", json!({"account":"a","name":"  "}))
                .is_err()
        );
        assert!(crate::host::dispatch(
            &rt,
            "rename_account",
            json!({"account":"missing","name":"Name"})
        )
        .is_err());
        assert_eq!(
            serde_json::to_value(Runtime::open(root.clone()).unwrap().snapshot()).unwrap(),
            expected
        );
        assert!(!root.join("external-cli").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn permission_changes_persist_without_resetting_other_controls() {
        let mut saved = LaunchOptions {
            model: Some("keep".into()),
            permission_mode: Some(PermissionMode::Bypass),
            ..Default::default()
        };
        saved.update_controls(&LaunchOptions::default());
        assert_eq!(saved.permission_mode, Some(PermissionMode::Bypass));
        saved.update_controls(&LaunchOptions {
            permission_mode: Some(PermissionMode::Ask),
            ..Default::default()
        });
        assert_eq!(saved.permission_mode, Some(PermissionMode::Ask));
        assert_eq!(saved.model.as_deref(), Some("keep"));
        let restored: LaunchOptions =
            serde_json::from_value(serde_json::to_value(saved).unwrap()).unwrap();
        assert_eq!(restored.permission_mode, Some(PermissionMode::Ask));
    }
    #[test]
    fn resumed_controls_preserve_legacy_settings_and_allow_explicit_reset() {
        let mut saved = LaunchOptions {
            model: Some("fixture".into()),
            effort: Some("high".into()),
            worktree: true,
            scheduled: true,
            ..Default::default()
        };
        saved.update_controls(&LaunchOptions::default());
        assert_eq!(saved.model.as_deref(), Some("fixture"));
        saved.update_controls(&LaunchOptions {
            update_agent_controls: true,
            model: Some("other".into()),
            effort: Some("xhigh".into()),
            ..Default::default()
        });
        assert_eq!(saved.model.as_deref(), Some("other"));
        assert_eq!(saved.effort.as_deref(), Some("xhigh"));
        saved.update_controls(&LaunchOptions {
            update_agent_controls: true,
            ..Default::default()
        });
        assert!(saved.model.is_none() && saved.effort.is_none());
        assert!(saved.worktree && saved.scheduled);
    }
    #[test]
    fn dropped_project_folders_are_persisted_with_defaults_and_deduplicated() {
        let root = std::env::temp_dir().join(id());
        let folder = root.join("My project");
        fs::create_dir_all(&folder).unwrap();
        let rt = Runtime::open(root.join("state")).unwrap();
        let imported = rt
            .import_project(folder.to_str().unwrap(), "blue".into())
            .unwrap();
        assert_eq!(imported.name, "My project");
        assert_eq!(
            imported.path,
            fs::canonicalize(&folder).unwrap().to_string_lossy()
        );
        assert_eq!(imported.policy, "inherit");
        assert!(imported.account.is_none() && imported.last.is_none());
        let mut configured = imported.clone();
        configured.name = "Custom name".into();
        configured.policy = "last".into();
        rt.project(configured).unwrap();
        let again = rt
            .import_project(folder.join(".").to_str().unwrap(), "red".into())
            .unwrap();
        assert_eq!(again.id, imported.id);
        assert_eq!(again.name, "Custom name");
        assert_eq!(again.color, "blue");
        assert_eq!(again.policy, "last");
        #[cfg(unix)]
        {
            let alias = root.join("alias");
            std::os::unix::fs::symlink(&folder, &alias).unwrap();
            assert_eq!(
                rt.import_project(alias.to_str().unwrap(), "red".into())
                    .unwrap()
                    .id,
                imported.id
            );
        }
        let file = root.join("file.txt");
        fs::write(&file, "fixture").unwrap();
        assert!(rt
            .import_project(file.to_str().unwrap(), "red".into())
            .err()
            .unwrap()
            .contains("folder"));
        assert!(rt
            .import_project(root.join("missing").to_str().unwrap(), "red".into())
            .is_err());
        assert_eq!(rt.snapshot().projects.len(), 1);
        assert!(rt.snapshot().sessions.is_empty());
        assert!(rt.snapshot().accounts.is_empty());
        drop(rt);
        assert_eq!(
            Runtime::open(root.join("state"))
                .unwrap()
                .snapshot()
                .projects[0]
                .id,
            imported.id
        );
        fs::remove_dir_all(root).unwrap();
    }
    fn project() -> Project {
        Project {
            id: "p".into(),
            name: "P".into(),
            path: "/tmp".into(),
            color: "blue".into(),
            policy: "fixed".into(),
            account: Some("a".into()),
            last: Some("b".into()),
        }
    }
    #[test]
    fn new_thread_policies_preserve_explicit_choices_and_project_fallbacks() {
        let mut d = db();
        let mut p = project();
        d.preferences.new_thread_policy = Some(NewThreadPolicy::LastSelected);
        d.preferences.last_selected = Some("b".into());
        assert_eq!(resolve(&d, &p, None).unwrap(), "b");
        assert_eq!(resolve(&d, &p, Some("a".into())).unwrap(), "a");
        d.preferences.last_selected = None;
        assert_eq!(resolve(&d, &p, None).unwrap(), "a");
        p.policy = "last".into();
        assert_eq!(resolve(&d, &p, None).unwrap(), "b");
        p.last = None;
        assert_eq!(resolve(&d, &p, None).unwrap(), "a");
        d.preferences.last_selected = Some("b".into());
        d.preferences.new_thread_policy = Some(NewThreadPolicy::Project);
        p.policy = "fixed".into();
        assert_eq!(resolve(&d, &p, None).unwrap(), "a");
        p.account = Some("missing".into());
        assert!(resolve(&d, &p, None).is_err());
        d.preferences.new_thread_policy = Some(NewThreadPolicy::Default);
        assert_eq!(resolve(&d, &p, None).unwrap(), "a");
        d.preferences.fallback = None;
        assert!(resolve(&d, &p, None).is_err());
        d.preferences.new_thread_policy = Some(NewThreadPolicy::LastSelected);
        d.preferences.last_selected = Some("missing".into());
        assert!(resolve(&d, &p, None).is_err());
    }
    #[test]
    fn preference_patches_merge_and_survive_restart() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        rt.0.lock().unwrap().db = db();
        rt.preferences_patch(json!({"new_thread_policy":"last_selected"}))
            .unwrap();
        rt.preferences_patch(json!({"last_selected":"a"})).unwrap();
        rt.preferences_patch(json!({"use_worktree":true})).unwrap();
        assert!(rt
            .preferences_patch(json!({"last_selected":"missing"}))
            .is_err());
        drop(rt);
        let d = Runtime::open(root.clone()).unwrap().snapshot();
        assert!(d.preferences.new_thread_policy == Some(NewThreadPolicy::LastSelected));
        assert_eq!(d.preferences.last_selected.as_deref(), Some("a"));
        assert!(d.preferences.use_worktree);
        let log = fs::read_to_string(root.join("logs/preferences.log")).unwrap();
        assert!(log.contains("preferences.save mode=patch") && log.contains("preferences.load"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn selected_connection_and_policy_survive_restart_without_launching() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        rt.0.lock().unwrap().db = db();
        let mut preferences = rt.snapshot().preferences;
        preferences.new_thread_policy = Some(NewThreadPolicy::LastSelected);
        preferences.last_selected = Some("a".into());
        rt.preferences(preferences).unwrap();
        drop(rt);
        let reopened = Runtime::open(root.clone()).unwrap();
        let d = reopened.snapshot();
        assert_eq!(d.preferences.last_selected.as_deref(), Some("a"));
        assert_eq!(resolve(&d, &project(), None).unwrap(), "a");
        assert!(d.sessions.is_empty());
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn queue_controls_persist_and_restart_requires_resume() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.queues.push(ThreadQueue {
                session: "thread".into(),
                paused: false,
                error: None,
                messages: ["first", "second"]
                    .iter()
                    .map(|key| QueuedMessage {
                        id: key.to_string(),
                        prompt: key.to_string(),
                        options: LaunchOptions::default(),
                    })
                    .collect(),
            });
            write_db(&i).unwrap();
        }
        rt.queue_action("thread", "pause", None).unwrap();
        assert!(rt.snapshot().queues[0].paused);
        rt.queue_action("thread", "delete", Some("first")).unwrap();
        assert_eq!(rt.snapshot().queues[0].messages[0].id, "second");
        rt.queue_action("thread", "resume", None).unwrap();
        let reopened = Runtime::open(root.clone()).unwrap();
        assert!(reopened.snapshot().queues[0].paused);
        assert_eq!(reopened.snapshot().queues[0].messages.len(), 1);
        reopened.queue_action("thread", "clear", None).unwrap();
        assert!(reopened.snapshot().queues[0].messages.is_empty());
        assert!(reopened
            .queue_message("missing", "Hello".into(), LaunchOptions::default())
            .is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn slash_commands_are_queued_and_edited_instead_of_rejected() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.accounts.push(
                serde_json::from_value(
                    json!({"id":"acct","name":"A","provider":"claude","color":"#fff"}),
                )
                .unwrap(),
            );
            i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"p","account":"acct","title":"T","status":"done","updated":0,"provider_id":null,"messages":[],"pending":null,"error":null})).unwrap());
        }
        rt.queue_message(
            "thread",
            "/compact keep the tests".into(),
            LaunchOptions::default(),
        )
        .unwrap();
        let key = rt.snapshot().queues[0].messages[0].id.clone();
        assert_eq!(
            rt.snapshot().queues[0].messages[0].prompt,
            "/compact keep the tests"
        );
        rt.edit_queued_message("thread", &key, "/review 12".into())
            .unwrap();
        assert_eq!(rt.snapshot().queues[0].messages[0].prompt, "/review 12");
        assert!(rt
            .queue_message("thread", "   ".into(), LaunchOptions::default())
            .is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn host_queue_dispatches_without_waiting_for_scheduler_and_preserves_pauses() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            // Offline fixture: absent project guarantees no provider can execute.
            i.db.accounts.push(
                serde_json::from_value(
                    json!({"id":"fixture","name":"Offline","provider":"claude","color":"#fff"}),
                )
                .unwrap(),
            );
            i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"missing","account":"fixture","title":"Offline","status":"done","updated":0,"provider_id":null,"messages":[],"pending":null,"error":null})).unwrap());
        }
        crate::host::dispatch(
            &rt,
            "queue_message",
            json!({"session":"thread","prompt":"First","options":{"request_id":"first"}}),
        )
        .unwrap();
        let q = rt.snapshot().queues[0].clone();
        assert_eq!(q.error.as_deref(), Some("Project not found"));
        assert!(q.paused);
        crate::host::dispatch(
            &rt,
            "queue_message",
            json!({"session":"thread","prompt":"Second","options":{"request_id":"second"}}),
        )
        .unwrap();
        crate::host::dispatch(
            &rt,
            "queue_message",
            json!({"session":"thread","prompt":"Second","options":{"request_id":"second"}}),
        )
        .unwrap();
        let q = rt.snapshot().queues[0].clone();
        assert!(q.paused);
        assert_eq!(
            q.messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn queue_failure_retains_message_and_pauses_without_provider_execution() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"missing","account":"missing","title":"Offline fixture","status":"done","updated":0,"provider_id":null,"messages":[],"pending":null,"error":null})).unwrap());
            i.db.queues.push(ThreadQueue {
                session: "thread".into(),
                paused: false,
                error: None,
                messages: vec![QueuedMessage {
                    id: "first".into(),
                    prompt: "Hello".into(),
                    options: LaunchOptions::default(),
                }],
            });
        }
        rt.queue_tick();
        let q = rt.snapshot().queues[0].clone();
        assert!(q.paused);
        assert_eq!(q.messages.len(), 1);
        assert_eq!(q.error.as_deref(), Some("Project not found"));
        rt.queue_tick();
        assert_eq!(rt.snapshot().queues[0].messages.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    fn db() -> Database {
        Database {
            accounts: ["a", "b"]
                .iter()
                .map(|n| Account {
                    id: n.to_string(),
                    name: n.to_string(),
                    provider: "codex".into(),
                    color: "blue".into(),
                    config_home: None,
                    claude_default_config: false,
                })
                .collect(),
            preferences: Preferences {
                new_thread_policy: None,
                last_selected: None,
                prefer_last: true,
                use_worktree: false,
                last: Some("b".into()),
                fallback: Some("a".into()),
            },
            ..Default::default()
        }
    }
    #[test]
    fn removing_connection_preserves_history_credentials_and_pinned_routes() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        let credentials = root.join("accounts/a/retained-test-file");
        private_dir(credentials.parent().unwrap()).unwrap();
        fs::write(&credentials, "fixture, no credentials").unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db = db();
            i.db.preferences.last = Some("a".into());
            let mut p = project();
            p.last = Some("a".into());
            i.db.projects.push(p);
            i.db.sessions.push(serde_json::from_value(json!({"id":"history","project":"p","account":"a","title":"Kept","status":"done","updated":0,"provider_id":"saved","messages":[],"pending":null,"error":null})).unwrap());
            i.db.schedules.push(serde_json::from_value(json!({"id":"schedule","name":"Kept","project":"p","account":"a","routing":"fixed","cron":"0 9 * * *","timezone":"UTC","prompt":"Check","enabled":true,"next_due":0,"runs":[]})).unwrap());
        }
        crate::host::dispatch(&rt, "remove_account", json!({"account":"a"})).unwrap();
        let saved = rt.snapshot();
        assert_eq!(saved.accounts.len(), 1);
        assert_eq!(saved.accounts[0].id, "b");
        assert!(saved.preferences.last.is_none());
        assert!(saved.preferences.fallback.is_none());
        assert!(saved.projects[0].last.is_none());
        assert_eq!(saved.sessions[0].provider_id.as_deref(), Some("saved"));
        assert_eq!(saved.schedules[0].account, "a");
        assert!(resolve(&saved, &saved.projects[0], None).is_err());
        assert!(rt
            .launch_with(
                "p".into(),
                None,
                "No switch".into(),
                Some("history".into()),
                LaunchOptions::default()
            )
            .is_err());
        assert!(credentials.exists());
        assert_eq!(
            Runtime::open(root.clone())
                .unwrap()
                .snapshot()
                .accounts
                .len(),
            1
        );
        assert!(rt.remove_account("a").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn removing_connection_refuses_active_work() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db = db();
            i.db.sessions.push(serde_json::from_value(json!({"id":"active","project":"p","account":"a","title":"Active","status":"waiting","updated":0,"provider_id":null,"messages":[],"pending":null,"error":null})).unwrap());
            i.running.insert("active".into(), mpsc::channel().0);
        }
        assert!(rt.remove_account("a").unwrap_err().contains("active turns"));
        assert_eq!(rt.snapshot().accounts.len(), 2);
        rt.0.lock().unwrap().running.clear();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn scheduler_recovers_dispatch_and_records_missed_without_replay() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            let stamp = now() - 120000;
            i.db.sessions.push(serde_json::from_value(json!({"id":"existing","project":"p","account":"a","title":"Recovered","status":"interrupted","updated":stamp,"provider_id":"original","messages":[],"pending":null,"error":null,"requests":["occurrence"]})).unwrap());
            i.db.schedules.push(serde_json::from_value(json!({"id":"schedule","name":"Check","project":"p","account":"a","routing":"fixed","cron":"0 9 * * *","timezone":"UTC","prompt":"Check","enabled":true,"next_due":stamp,"runs":[{"id":"occurrence","due":stamp-60000,"state":"dispatching","session":null,"reason":null}]})).unwrap());
        }
        rt.scheduler_tick();
        let d = rt.snapshot();
        assert_eq!(d.sessions.len(), 1);
        assert_eq!(d.schedules[0].runs[0].session.as_deref(), Some("existing"));
        assert_eq!(d.schedules[0].runs[0].state, "interrupted");
        assert_eq!(d.schedules[0].runs[1].state, "missed");
        rt.scheduler_tick();
        assert_eq!(rt.snapshot().schedules[0].runs.len(), 2);
        rt.schedule_action("schedule", "pause").unwrap();
        rt.schedule_action("schedule", "run").unwrap();
        assert!(!rt.snapshot().schedules[0].enabled);
        assert!(rt.snapshot().schedules[0].run_now.is_some());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn persisted_request_is_idempotent_and_worktrees_default_off() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        assert!(!rt.snapshot().preferences.use_worktree);
        {
            let mut i = rt.0.lock().unwrap();
            i.db.projects.push(project());
            i.db.sessions.push(serde_json::from_value(json!({"id":"existing","project":"p","account":"a","title":"Once","status":"done","updated":0,"provider_id":"original","messages":[],"pending":null,"error":null,"requests":["once"]})).unwrap());
        }
        assert_eq!(
            rt.launch_with(
                "p".into(),
                None,
                "Test".into(),
                None,
                LaunchOptions {
                    request_id: Some("once".into()),
                    ..Default::default()
                }
            )
            .unwrap(),
            "existing"
        );
        assert_eq!(rt.snapshot().sessions.len(), 1);
        assert!(!root.join("worktrees").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn explicit_beats_project_and_global() {
        assert_eq!(resolve(&db(), &project(), Some("b".into())).unwrap(), "b");
        assert_eq!(resolve(&db(), &project(), None).unwrap(), "a")
    }
    #[test]
    fn invalid_fixed_does_not_fall_back() {
        let mut p = project();
        p.account = Some("missing".into());
        assert!(resolve(&db(), &p, None).is_err());
    }
    #[test]
    fn restart_marks_inflight_interrupted() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.sessions.push(Session {
                archived: false,
                deleted_at: None,
                execution_project: None,
                read_at: None,
                id: "s".into(),
                project: "p".into(),
                account: "a".into(),
                title: "t".into(),
                title_manual: Some(false),
                status: "waiting".into(),
                updated: 0,
                last_user_message_at: None,
                provider_id: Some("provider".into()),
                options: Default::default(),
                working_dir: None,
                requests: vec![],
                tasks: vec![],
                usage: None,
                messages: vec![],
                pending: Some(json!({})),
                error: None,
            });
            write_db(&i).unwrap();
        }
        let restored = Runtime::open(root.clone()).unwrap().snapshot();
        assert_eq!(restored.sessions[0].last_user_message_at, Some(0));
        let reopened = Runtime::open(root.clone()).unwrap();
        reopened.update("s", |s| {
            s.status = "done".into();
        });
        assert_eq!(
            reopened.snapshot().sessions[0].last_user_message_at,
            Some(0)
        );
        assert!(reopened.snapshot().sessions[0].updated > 0);
        drop(reopened);
        assert_eq!(
            Runtime::open(root.clone()).unwrap().snapshot().sessions[0].last_user_message_at,
            Some(0)
        );
        assert_eq!(restored.sessions[0].status, "interrupted");
        assert!(restored.sessions[0].pending.is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_profiles_deserialize_as_isolated() {
        let a: Account = serde_json::from_value(
            json!({"id":"a","name":"Work","provider":"codex","color":"blue"}),
        )
        .unwrap();
        assert!(a.config_home.is_none());
    }
    #[cfg(unix)]
    #[test]
    fn antigravity_acp_help_accepts_stderr_and_rejects_failure() {
        for (script, expected) in [
            ("printf 'Usage: agy acp [flags]\\n'", true),
            ("printf 'Usage: agy acp [flags]\\n' >&2", true),
            ("printf 'Usage: agy acp [flags]\\n' >&2; exit 1", false),
            ("printf 'Unknown command' >&2", false),
        ] {
            let output = Command::new("/bin/sh")
                .args(["-c", script])
                .output()
                .unwrap();
            assert_eq!(antigravity_supports_acp(&output), expected);
        }
    }
    #[test]
    fn missing_cli_resolution_still_prevents_command_creation() {
        let mut account = db().accounts[0].clone();
        account.config_home = Some(PathBuf::from("/unused/shared-profile"));
        let error = command_with_resolver(&account, Path::new("/unused"), |provider| {
            Err(format!("Install {provider} CLI before using this account."))
        })
        .unwrap_err();
        assert_eq!(error, "Install codex CLI before using this account.");
    }
    #[test]
    fn shared_default_claude_profile_preserves_default_auth_namespace() {
        // Explicit ~/.claude selects a different Keychain namespace from an
        // unset CLAUDE_CONFIG_DIR. Persist that distinction across restarts.
        let a: Account = serde_json::from_value(json!({
            "id":"shared", "name":"Existing", "provider":"claude", "color":"blue",
            "config_home":"/unused/shared-claude", "claude_default_config":true
        }))
        .unwrap();
        let restored: Account = serde_json::from_value(serde_json::to_value(&a).unwrap()).unwrap();
        let cmd = command_with_resolver(&restored, Path::new("/unused/freddai"), |_| {
            Ok(PathBuf::from("unused-test-cli"))
        })
        .unwrap();
        assert!(
            cmd.get_envs()
                .any(|(key, value)| key == "CLAUDE_CONFIG_DIR" && value.is_none()),
            "Default CLI sign-in must not acquire an explicit configuration override"
        );
        assert!(cmd
            .get_envs()
            .any(|(key, value)| key == "ANTHROPIC_API_KEY" && value.is_none()));
    }
    #[test]
    fn claude_discovery_distinguishes_unset_and_explicit_default_directory() {
        let root = std::env::temp_dir().join(id());
        let profile = root.join(".claude");
        fs::create_dir_all(&profile).unwrap();
        for explicit in [false, true] {
            let a = local_account_from_env("claude", |key| match key {
                "HOME" => Some(root.clone().into_os_string()),
                "CLAUDE_CONFIG_DIR" if explicit => Some(profile.clone().into_os_string()),
                _ => None,
            })
            .unwrap();
            assert_eq!(a.claude_default_config, !explicit);
            let restored: Account =
                serde_json::from_value(serde_json::to_value(a).unwrap()).unwrap();
            let cmd = command_with_resolver(&restored, &root.join("unused"), |_| {
                Ok(PathBuf::from("unused-test-cli"))
            })
            .unwrap();
            let setting = cmd
                .get_envs()
                .find(|(key, _)| *key == "CLAUDE_CONFIG_DIR")
                .unwrap()
                .1;
            assert_eq!(
                setting,
                if explicit {
                    Some(profile.as_os_str())
                } else {
                    None
                }
            );
            assert!(!root.join("unused").exists());
        }
        #[cfg(unix)]
        {
            let alias = root.join("claude-alias");
            std::os::unix::fs::symlink(&profile, &alias).unwrap();
            let a = local_account_from_env("claude", |key| match key {
                "CLAUDE_CONFIG_DIR" => Some(alias.clone().into_os_string()),
                _ => None,
            })
            .unwrap();
            assert_eq!(a.config_home.as_deref(), Some(alias.as_path()),
                "Explicit Claude paths must not change their authentication namespace through canonicalization");
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn isolated_claude_profile_retains_its_explicit_auth_namespace() {
        let root = std::env::temp_dir().join(id());
        let mut a = db().accounts[0].clone();
        a.provider = "claude".into();
        let cmd =
            command_with_resolver(&a, &root, |_| Ok(PathBuf::from("unused-test-cli"))).unwrap();
        assert_eq!(
            cmd.get_envs()
                .find(|(key, _)| *key == "CLAUDE_CONFIG_DIR")
                .unwrap()
                .1
                .unwrap(),
            root.join("accounts").join(&a.id).as_os_str()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shared_profiles_preserve_home_permissions_and_credential_storage() {
        let root = std::env::temp_dir().join(id());
        fs::create_dir_all(&root).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        for provider in ["codex", "claude"] {
            let mut a = db().accounts[0].clone();
            a.provider = provider.into();
            a.config_home = Some(root.clone());
            let cmd = command_with_resolver(&a, &root.join("unused"), |_| {
                Ok(PathBuf::from("unused-test-cli"))
            })
            .unwrap();
            let key = if provider == "codex" {
                "CODEX_HOME"
            } else {
                "CLAUDE_CONFIG_DIR"
            };
            assert_eq!(
                cmd.get_envs().find(|(k, _)| *k == key).unwrap().1.unwrap(),
                root.as_os_str()
            );
            assert_eq!(
                cmd.get_args().count(),
                0,
                "shared Codex must respect CLI credential storage"
            );
            assert!(!root.join("unused").exists());
            let restored: Account =
                serde_json::from_value(serde_json::to_value(&a).unwrap()).unwrap();
            assert_eq!(restored.config_home, a.config_home);
        }
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o755
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shared_profiles_cannot_start_login() {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        let mut a = db().accounts[0].clone();
        a.config_home = Some(root.join("external"));
        rt.0.lock().unwrap().db.accounts.push(a);
        assert!(rt
            .login("a")
            .unwrap_err()
            .contains("Manage sign-in in the CLI"));
        assert!(!root.join("external").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn auth_checks_only_request_status_and_respect_failure() {
        for (provider, expected) in [("codex", "login"), ("claude", "auth")] {
            let mut cmd = Command::new("/bin/sh");
            cmd.args([
                "-c",
                &format!("test \"$1\" = {expected} && test \"$2\" = status"),
                "fixture",
            ]);
            assert!(check_auth(cmd, provider).unwrap());
            let mut cmd = Command::new("/bin/sh");
            cmd.args(["-c", "exit 1"]);
            assert!(!check_auth(cmd, provider).unwrap());
        }
    }
    #[cfg(unix)]
    #[test]
    fn stalled_auth_check_reports_unknown_status_and_recovery() {
        for (provider, name) in [("codex", "Codex"), ("claude", "Claude Code")] {
            let mut cmd = Command::new("/bin/sh");
            cmd.args(["-c", "exec sleep 30"]).process_group(0);
            let start = std::time::Instant::now();
            let error =
                check_auth_with_timeout(cmd, provider, Duration::from_millis(20)).unwrap_err();
            assert!(error.contains(name), "{error}");
            assert!(error.contains("status is unknown"), "{error}");
            assert!(error.contains("Open Accounts"), "{error}");
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }
    #[test]
    fn profile_paths_are_unique_and_api_keys_removed() {
        let root = std::env::temp_dir().join(id());
        let mut a = db().accounts[0].clone();
        let first =
            command_with_resolver(&a, &root, |_| Ok(PathBuf::from("unused-test-cli"))).unwrap();
        a.id = "b".into();
        let second =
            command_with_resolver(&a, &root, |_| Ok(PathBuf::from("unused-test-cli"))).unwrap();
        let env = |c: &Command| {
            c.get_envs()
                .find(|(k, _)| *k == "CODEX_HOME")
                .unwrap()
                .1
                .unwrap()
                .to_owned()
        };
        assert_ne!(env(&first), env(&second));
        assert!(first
            .get_envs()
            .any(|(k, v)| k == "OPENAI_API_KEY" && v.is_none()));
        fs::remove_dir_all(root).unwrap();
    }
    fn protocol_fixture(provider: &str, cancel: bool) {
        protocol_fixture_action(provider, cancel, false)
    }
    fn protocol_fixture_action(provider: &str, cancel: bool, delete: bool) {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        let p = project();
        let mut a = db().accounts[0].clone();
        a.provider = provider.into();
        let sample = root.join("sample.txt");
        fs::write(&sample, "ATTACHMENT_FIXTURE_CONTENT").unwrap();
        let attached = rt
            .stage_attachments(vec![sample.to_string_lossy().into()])
            .unwrap();
        fs::remove_file(sample).unwrap();
        let s = Session {
            archived: false,
            deleted_at: None,
            execution_project: None,
            read_at: None,
            id: "test-session".into(),
            project: p.id.clone(),
            account: a.id.clone(),
            title: "Test".into(),
            title_manual: Some(false),
            status: "starting".into(),
            updated: 0,
            last_user_message_at: None,
            provider_id: if matches!(provider, "codex" | "antigravity" | "opencode" | "cursor") {
                Some("provider-session".into())
            } else {
                None
            },
            options: LaunchOptions {
                model: Some("fixture-model".into()),
                effort: Some("xhigh".into()),
                attachments: vec![attached[0].id.clone()],
                ..Default::default()
            },
            working_dir: None,
            requests: vec![],
            tasks: vec![],
            usage: None,
            messages: vec![],
            pending: None,
            error: None,
        };
        let (tx, rx) = mpsc::channel();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.accounts.push(a.clone());
            i.db.projects.push(p.clone());
            i.db.sessions.push(s.clone());
            i.running.insert(s.id.clone(), tx);
        }
        let mut cmd = Command::new("python3");
        cmd.args([
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/agent.py"),
            provider,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        #[cfg(unix)]
        cmd.process_group(0);
        let runner = rt.clone();
        let sid = s.id.clone();
        let handle = std::thread::spawn(move || runner.run_protocol(&s, &a, &p, "Test", rx, cmd));
        let mut pending = None;
        for _ in 0..100 {
            let snapshot = rt.snapshot();
            pending = snapshot.sessions[0].pending.clone();
            if pending.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let frame = pending.expect("must present a permission card before proceeding");
        assert_eq!(rt.snapshot().sessions[0].status, "waiting");
        assert_eq!(rt.snapshot().sessions[0].title, "Generated title");
        if provider == "claude" {
            assert_eq!(
                rt.snapshot().sessions[0]
                    .messages
                    .first()
                    .map(|m| m.text.as_str()),
                Some("Hello "),
                "partial text must be visible before the provider completes its message"
            );
        }
        if provider == "codex" && !cancel && !delete {
            let options = LaunchOptions {
                request_id: Some("steering-test".into()),
                attachments: vec![attached[0].id.clone()],
                ..Default::default()
            };
            rt.queue_message(&sid, "REJECT_STEERING".into(), options.clone())
                .unwrap();
            assert!(rt
                .queue_action(&sid, "steer", Some("steering-test"))
                .unwrap_err()
                .contains("Synthetic steering rejection"));
            assert_eq!(rt.snapshot().queues[0].messages.len(), 1);
            assert_eq!(rt.snapshot().sessions[0].status, "waiting");
            rt.edit_queued_message(&sid, "steering-test", "Revised direction".into())
                .unwrap();
            assert_eq!(
                rt.snapshot().queues[0].messages[0].options.attachments,
                options.attachments
            );
            rt.queue_action(&sid, "steer", Some("steering-test"))
                .unwrap();
            assert!(rt.snapshot().queues[0].messages.is_empty());
            let snapshot = rt.snapshot();
            let user = snapshot.sessions[0]
                .messages
                .iter()
                .find(|m| m.role == "user")
                .unwrap();
            assert_eq!(user.text, "Revised direction");
            assert_eq!(user.attachments.len(), 1);
            // Retrying an acknowledged request never delivers it twice.
            rt.steer_message(&sid, "Revised direction".into(), options)
                .unwrap();
            assert_eq!(
                rt.snapshot().sessions[0]
                    .messages
                    .iter()
                    .filter(|m| m.role == "user")
                    .count(),
                1
            );
        }
        if delete {
            rt.thread_action(&sid, "delete", None).unwrap();
            assert!(rt.snapshot().sessions[0].deleted_at.is_some());
        } else if cancel {
            rt.stop(&sid).unwrap();
        } else {
            let request = if provider != "claude" {
                frame["id"].to_string()
            } else {
                frame["request_id"].to_string()
            };
            rt.respond(&sid, &request, true, json!({})).unwrap();
        }
        handle.join().unwrap().unwrap();
        let d = rt.snapshot();
        assert_eq!(
            d.sessions[0].status,
            if cancel { "interrupted" } else { "done" }
        );
        assert!(d.sessions[0].pending.is_none());
        if !cancel {
            assert_eq!(
                d.sessions[0]
                    .messages
                    .iter()
                    .filter(|m| m.role == "assistant")
                    .count(),
                1
            );
            assert_eq!(d.sessions[0].messages[0].text, "Hello world");
            assert_eq!(
                d.sessions[0].provider_id.as_deref(),
                Some("provider-session")
            );
            assert_eq!(d.preferences.last.as_deref(), Some("a"));
            if provider == "codex" || provider == "claude" {
                let usage = d.sessions[0]
                    .usage
                    .as_ref()
                    .expect("project usage events into the session");
                assert_eq!(
                    usage.cached_input_tokens,
                    Some(if provider == "codex" { 300 } else { 80 })
                );
                let reopened = Runtime::open(root.clone()).unwrap().snapshot();
                assert_eq!(
                    reopened.sessions[0]
                        .usage
                        .as_ref()
                        .unwrap()
                        .cached_input_tokens,
                    usage.cached_input_tokens
                );
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn non_codex_steering_interrupts_and_continues_same_session() {
        for provider in [
            "claude",
            "gemini",
            "antigravity",
            "grok",
            "opencode",
            "cursor",
        ] {
            steering_fixture(provider, "normal");
        }
        steering_fixture("claude", "ack-first");
        steering_fixture("claude", "reject");
        steering_fixture("claude", "timeout");
        steering_fixture("claude", "background-idle");
        steering_fixture("claude", "background-woke");
    }
    fn steering_fixture(provider: &str, scenario: &str) {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        let p = project();
        let mut a = db().accounts[0].clone();
        a.provider = provider.into();
        let sample = root.join("sample.txt");
        fs::write(&sample, "ATTACHMENT_FIXTURE_CONTENT").unwrap();
        let attached = rt
            .stage_attachments(vec![sample.to_string_lossy().into()])
            .unwrap();
        fs::remove_file(sample).unwrap();
        let s = Session {
            archived: false,
            deleted_at: None,
            execution_project: None,
            read_at: None,
            id: "test-session".into(),
            project: p.id.clone(),
            account: a.id.clone(),
            title: "Test".into(),
            title_manual: Some(false),
            status: "starting".into(),
            updated: 0,
            last_user_message_at: None,
            provider_id: if matches!(provider, "codex" | "antigravity" | "opencode" | "cursor") {
                Some("provider-session".into())
            } else {
                None
            },
            options: LaunchOptions {
                model: Some("fixture-model".into()),
                effort: Some("xhigh".into()),
                attachments: vec![attached[0].id.clone()],
                ..Default::default()
            },
            working_dir: None,
            requests: vec![],
            tasks: vec![],
            usage: None,
            messages: vec![],
            pending: None,
            error: None,
        };
        let (tx, rx) = mpsc::channel();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.accounts.push(a.clone());
            i.db.projects.push(p.clone());
            i.db.sessions.push(s.clone());
            i.running.insert(s.id.clone(), tx);
        }
        let mut cmd = Command::new("python3");
        cmd.args([
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/steering_agent.py"
            ),
            provider,
            scenario,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        #[cfg(unix)]
        cmd.process_group(0);
        let runner = rt.clone();
        let sid = s.id.clone();
        let handle = std::thread::spawn(move || runner.run_protocol(&s, &a, &p, "Test", rx, cmd));

        for _ in 0..100 {
            if rt.snapshot().sessions[0].pending.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(rt.snapshot().sessions[0].pending.is_some());
        if scenario.starts_with("background-") {
            for _ in 0..100 {
                if rt.snapshot().sessions[0]
                    .tasks
                    .iter()
                    .any(|t| t.id == "ready-marker")
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        let invalid = rt.steer_message(
            &sid,
            "Do not interrupt".into(),
            LaunchOptions {
                attachments: vec!["missing-attachment".into()],
                ..Default::default()
            },
        );
        assert!(invalid.is_err());
        assert!(
            rt.snapshot().sessions[0].pending.is_some(),
            "validation must happen before interruption"
        );
        let options = LaunchOptions {
            request_id: Some("redirect".into()),
            attachments: vec![attached[0].id.clone()],
            ..Default::default()
        };
        rt.queue_message(&sid, "Revised direction".into(), options.clone())
            .unwrap();
        let outcome = rt.queue_action(&sid, "steer", Some("redirect"));
        if outcome.is_err() {
            assert_eq!(rt.snapshot().queues[0].messages.len(), 1);
            assert!(!rt.snapshot().sessions[0]
                .requests
                .contains(&"redirect".to_string()));
            rt.stop(&sid).unwrap();
            handle.join().unwrap().unwrap();
        } else {
            // Acknowledged retries must not interrupt or deliver a second time.
            rt.steer_message(&sid, "Revised direction".into(), options)
                .unwrap();
            for _ in 0..100 {
                if rt.snapshot().sessions[0].pending.is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let snapshot = rt.snapshot();
            let session = &snapshot.sessions[0];
            assert_eq!(session.provider_id.as_deref(), Some("provider-session"));
            let frame = session.pending.as_ref().expect("new turn permission");
            let key = if provider == "claude" {
                &frame["request_id"]
            } else {
                &frame["id"]
            };
            rt.respond(&sid, &key.to_string(), true, json!({})).unwrap();
            handle.join().unwrap().unwrap();
            let snapshot = rt.snapshot();
            assert_eq!(snapshot.sessions[0].status, "done");
            assert!(snapshot.queues[0].messages.is_empty());
            let users: Vec<_> = snapshot.sessions[0]
                .messages
                .iter()
                .filter(|m| m.role == "user")
                .collect();
            assert_eq!(users.len(), 1);
            assert_eq!(users[0].text, "Revised direction");
            assert_eq!(users[0].attachments.len(), 1);
            let replies: Vec<_> = snapshot.sessions[0]
                .messages
                .iter()
                .filter(|m| m.role == "assistant")
                .map(|m| m.text.as_str())
                .collect();
            assert_eq!(replies, ["Before interruption", "After interruption"]);
        }
        fs::remove_dir_all(root).unwrap();
        if scenario == "timeout" {
            assert!(outcome.unwrap_err().contains("did not finish interrupting"));
        } else if scenario == "reject" {
            assert!(outcome
                .unwrap_err()
                .contains("Synthetic interruption rejection"));
        } else {
            assert!(outcome.is_ok(), "{provider}: {outcome:?}");
        }
    }

    #[test]
    fn delete_waiting_session_reaps_fixture_process() {
        for provider in ["codex", "claude", "grok"] {
            protocol_fixture_action(provider, true, true);
        }
    }
    #[test]
    fn codex_process_roundtrip_and_approval() {
        protocol_fixture("codex", false)
    }
    #[test]
    fn new_harnesses_resume_approve_and_cancel() {
        for provider in ["opencode", "cursor"] {
            protocol_fixture(provider, false);
            protocol_fixture(provider, true);
        }
    }
    #[test]
    fn antigravity_process_roundtrip_and_approval() {
        protocol_fixture("antigravity", false)
    }
    #[test]
    fn antigravity_stop_while_waiting() {
        protocol_fixture("antigravity", true)
    }
    #[test]
    fn gemini_process_roundtrip_and_approval() {
        protocol_fixture("gemini", false)
    }
    #[test]
    fn grok_process_roundtrip_and_approval() {
        protocol_fixture("grok", false)
    }
    #[test]
    fn acp_stop_while_waiting() {
        protocol_fixture("grok", true)
    }
    fn background_fixture(
        scenario: &str,
    ) -> (Runtime, PathBuf, std::thread::JoinHandle<Result<()>>) {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        let p = project();
        let mut a = db().accounts[0].clone();
        a.provider = "claude".into();
        let s: Session = serde_json::from_value(json!({"id":"bg-session","project":p.id,"account":a.id,"title":"Test","title_manual":true,"status":"starting","updated":0,"provider_id":null,"messages":[],"pending":null,"error":null})).unwrap();
        let (tx, rx) = mpsc::channel();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.accounts.push(a.clone());
            i.db.projects.push(p.clone());
            i.db.sessions.push(s.clone());
            i.running.insert(s.id.clone(), tx);
        }
        let mut cmd = Command::new("python3");
        cmd.args([
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/agent.py"),
            "claude",
            scenario,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        #[cfg(unix)]
        cmd.process_group(0);
        let runner = rt.clone();
        let handle = std::thread::spawn(move || runner.run_protocol(&s, &a, &p, "Test", rx, cmd));
        (rt, root, handle)
    }
    fn session_state(rt: &Runtime) -> (String, Vec<String>, Option<String>) {
        let s = rt.snapshot().sessions[0].clone();
        (
            s.status,
            s.tasks.iter().map(|t| t.status.clone()).collect(),
            s.error,
        )
    }
    #[test]
    fn thread_stays_running_while_background_agent_runs_then_completes_after_main_agent_replies() {
        let (rt, root, handle) = background_fixture("bg-complete");
        // The fixture sends `result` immediately after launching the agent, then waits ~1s before notifying.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while rt.snapshot().sessions[0].tasks.is_empty() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(
            session_state(&rt),
            ("running".into(), vec!["running".into()], None),
            "first result must not complete the thread"
        );
        assert_eq!(
            rt.snapshot().sessions[0].tasks[0].description,
            "Fixture agent"
        );
        handle.join().unwrap().unwrap();
        let (status, tasks, error) = session_state(&rt);
        assert_eq!(
            (status.as_str(), tasks, error),
            ("done", vec!["completed".to_string()], None)
        );
        let texts: Vec<_> = rt.snapshot().sessions[0]
            .messages
            .iter()
            .filter(|m| m.role == "assistant")
            .map(|m| m.text.clone())
            .collect();
        assert_eq!(
            texts,
            ["Started the agent.", "The agent finished."],
            "split assistant frames must not duplicate streamed text"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn agent_exit_with_pending_background_agent_fails_loudly() {
        let (rt, root, handle) = background_fixture("bg-exit");
        let error = handle.join().unwrap().unwrap_err();
        assert!(
            error.contains("1 background sub-agent(s) did not finish: Fixture agent"),
            "{error}"
        );
        let s = rt.snapshot().sessions[0].clone();
        assert_eq!(s.tasks[0].status, "failed");
        assert_ne!(s.status, "done");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn claude_process_roundtrip_and_approval() {
        protocol_fixture("claude", false)
    }
    #[test]
    fn stop_while_waiting_does_not_complete() {
        protocol_fixture("codex", true)
    }
    #[test]
    fn detection_rejects_non_executable_files_and_directories() {
        let root = std::env::temp_dir().join(id());
        fs::create_dir(&root).unwrap();
        let path = root.join("codex");
        fs::write(&path, "test").unwrap();
        assert!(!is_executable(&root));
        #[cfg(unix)]
        {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
            assert!(!is_executable(&path));
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            assert!(is_executable(&path));
        }
        fs::remove_dir_all(root).unwrap();
    }

    fn delta_session(id: &str) -> Session {
        serde_json::from_value(json!({"id":id,"project":"p","account":"a","title":id,"status":"done","updated":1,"provider_id":null,"messages":[{"id":"m","role":"assistant","text":"hi"}],"pending":null,"error":null})).unwrap()
    }
    fn delta_runtime() -> (Runtime, PathBuf) {
        let root = std::env::temp_dir().join(id());
        let rt = Runtime::open(root.clone()).unwrap();
        rt.0.lock().unwrap().db.sessions =
            vec![delta_session("a"), delta_session("b"), delta_session("c")];
        (rt, root)
    }
    fn ids(v: &Value, key: &str) -> Vec<String> {
        v[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().or(x["id"].as_str()).unwrap().to_string())
            .collect()
    }
    #[test]
    fn force_upgrade_interrupts_running_threads_keeps_provider_id_and_refuses_new_work() {
        let (rt, root) = delta_runtime();
        let (tx, rx) = mpsc::channel();
        {
            let mut i = rt.0.lock().unwrap();
            i.db.sessions[1].status = "running".into();
            i.db.sessions[1].provider_id = Some("provider-session".into());
            i.running.insert("b".into(), tx);
        }
        // Stand-in supervisor: on Cancel, mark interrupted and deregister like the real one.
        let sup = rt.clone();
        let handle = std::thread::spawn(move || {
            assert!(matches!(rx.recv().unwrap(), Control::Cancel));
            sup.update("b", |s| s.status = "interrupted".into());
            sup.0.lock().unwrap().running.remove("b");
        });
        assert_eq!(rt.force_upgrade().unwrap(), 1);
        handle.join().unwrap();
        let d = rt.snapshot();
        let b = d.sessions.iter().find(|s| s.id == "b").unwrap();
        assert_eq!(b.status, "interrupted");
        assert_eq!(b.provider_id.as_deref(), Some("provider-session"));
        assert!(b
            .error
            .as_deref()
            .unwrap()
            .contains("Interrupted by a Freddai update"));
        assert_eq!(
            d.sessions
                .iter()
                .filter(|s| s.status == "interrupted")
                .count(),
            1
        );
        assert!(rt.0.lock().unwrap().shutting_down);
        let on_disk = fs::read_to_string(root.join("workspace.json")).unwrap();
        assert!(on_disk.contains("Interrupted by a Freddai update"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn snapshot_since_is_incremental_and_host_scoped() {
        let (rt, root) = delta_runtime();
        let host = rt.boot_id().to_string();
        // Unknown revision: full snapshot with every session.
        let (first, ..) = rt.snapshot_since(0, Some(&host));
        assert_eq!(first["full"], true);
        assert_eq!(ids(&first, "sessions"), ["a", "b", "c"]);
        let rev = first["revision"].as_u64().unwrap();
        // Nothing changed: unchanged marker only, no payload.
        let (same, ..) = rt.snapshot_since(rev, Some(&host));
        assert_eq!(same["unchanged"], true);
        assert!(same.get("sessions").is_none());
        // One session streams: only that session is sent, but the id list is complete.
        rt.message("b", "m".into(), "assistant", " more".into(), true);
        let (delta, _, _, sent, total) = rt.snapshot_since(rev, Some(&host));
        assert_eq!((delta["full"].clone(), sent, total), (json!(false), 1, 3));
        assert_eq!(ids(&delta, "sessionIds"), ["a", "b", "c"]);
        assert_eq!(ids(&delta, "sessions"), ["b"]);
        assert_eq!(delta["sessions"][0]["messages"][0]["text"], "hi more");
        assert!(
            delta["accounts"].is_array()
                && delta["preferences"].is_object()
                && delta["projects"].is_array()
        );
        let rev2 = delta["revision"].as_u64().unwrap();
        assert!(rev2 > rev);
        // A wide mutation (deletion) shows up in sessionIds and marks sessions changed.
        rt.0.lock().unwrap().db.sessions.retain(|s| s.id != "a");
        let (gone, ..) = rt.snapshot_since(rev2, Some(&host));
        assert_eq!(ids(&gone, "sessionIds"), ["b", "c"]);
        assert_eq!(gone["full"], false);
        // A client from another host process (or the future) gets everything.
        let (foreign, ..) =
            rt.snapshot_since(gone["revision"].as_u64().unwrap(), Some("other-host"));
        assert_eq!(foreign["full"], true);
        assert_eq!(ids(&foreign, "sessions"), ["b", "c"]);
        let (future, ..) = rt.snapshot_since(u64::MAX, Some(&host));
        assert_eq!(future["full"], true);
        let (missing, ..) = rt.snapshot_since(rev, None);
        assert_eq!(missing["full"], true);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn read_cursors_take_the_max_and_are_incremental() {
        let (rt, root) = delta_runtime();
        let host = rt.boot_id().to_string();
        let rev = rt.snapshot_since(0, Some(&host)).0["revision"]
            .as_u64()
            .unwrap();
        rt.mark_read("b", 50).unwrap();
        rt.mark_read("b", 20).unwrap(); // never backwards
        let snap = rt.snapshot();
        assert_eq!(snap.sessions[1].read_at, Some(50));
        assert_eq!(snap.sessions[0].read_at, None);
        let (delta, ..) = rt.snapshot_since(rev, Some(&host));
        assert_eq!(ids(&delta, "sessions"), ["b"]);
        assert_eq!(delta["sessions"][0]["read_at"], 50);
        let unknown = rt
            .merge_read(&[("a".into(), 7), ("b".into(), 10), ("ghost".into(), 1)])
            .unwrap();
        assert_eq!(unknown, ["ghost"]);
        let snap = rt.snapshot();
        assert_eq!(
            (snap.sessions[0].read_at, snap.sessions[1].read_at),
            (Some(7), Some(50))
        );
        let rev2 = rt.snapshot_since(0, Some(&host)).0["revision"]
            .as_u64()
            .unwrap();
        rt.merge_read(&[("b".into(), 40)]).unwrap(); // no change: no revision bump
        assert_eq!(rt.snapshot_since(rev2, Some(&host)).0["unchanged"], true);
        assert!(rt.mark_read("ghost", 1).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    fn on_disk(root: &Path) -> Database {
        serde_json::from_slice(&fs::read(root.join("workspace.json")).unwrap()).unwrap()
    }
    #[test]
    fn streamed_text_is_persisted_by_the_debounced_persister_not_per_delta() {
        let (rt, root) = delta_runtime();
        rt.flush().unwrap();
        rt.message("a", "m".into(), "assistant", " streamed".into(), true);
        // The delta did not write synchronously.
        assert_eq!(on_disk(&root).sessions[0].messages[0].text, "hi");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while on_disk(&root).sessions[0].messages[0].text != "hi streamed" {
            assert!(
                std::time::Instant::now() < deadline,
                "persister never flushed"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn terminal_status_and_wide_writes_flush_immediately() {
        let (rt, root) = delta_runtime();
        rt.flush().unwrap();
        rt.update("a", |s| s.status = "failed".into());
        assert_eq!(on_disk(&root).sessions[0].status, "failed");
        rt.update("b", |s| s.provider_id = Some("resume-handle".into()));
        assert_eq!(
            on_disk(&root).sessions[1].provider_id.as_deref(),
            Some("resume-handle")
        );
        let before = rt.revision();
        rt.update("c", |s| s.title = "renamed".into());
        assert!(rt.revision() > before);
        assert_eq!(on_disk(&root).sessions[2].title, "c"); // still debounced
        rt.flush().unwrap();
        assert_eq!(on_disk(&root).sessions[2].title, "renamed");
        fs::remove_dir_all(root).unwrap();
    }
}
