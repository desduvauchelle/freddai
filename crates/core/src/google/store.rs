//! Account metadata, OAuth client config and secret storage.
//!
//! Non-secret data lives in `<root>/google/accounts.json` and `<root>/google/config.json`.
//! Secrets (refresh/access tokens, OAuth client secret) live behind [`SecretStore`].

use super::{log_event, Context, Service};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// Keychain service name used by the macOS store.
pub const KEYCHAIN_SERVICE: &str = "com.freddai.google";
/// Secret-store key of the OAuth client secret (accounts are keyed by email).
pub const CLIENT_SECRET_KEY: &str = "oauth-client";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountStatus {
    Ok,
    NeedsReauth,
    Error,
}

impl AccountStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AccountStatus::Ok => "ok",
            AccountStatus::NeedsReauth => "needs_reauth",
            AccountStatus::Error => "error",
        }
    }
}

/// Non-secret account metadata. Serialized as-is in `google_accounts`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub email: String,
    pub name: String,
    pub services: Vec<Service>,
    pub status: AccountStatus,
    pub last_error: Option<String>,
    /// RFC 3339.
    pub connected_at: String,
}

impl Account {
    pub fn has_service(&self, service: Service) -> bool {
        self.services.contains(&service)
    }
}

// ------------------------------------------------------------------ secret stores

/// Storage for secrets, keyed by a name (an account email, or [`CLIENT_SECRET_KEY`]).
pub trait SecretStore: Send + Sync {
    /// `"keychain"`, `"file"` or `"memory"`.
    fn kind(&self) -> &'static str;
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    /// Idempotent: deleting a missing secret is `Ok`.
    fn delete(&self, name: &str) -> Result<(), String>;
}

/// The platform store: Keychain on macOS, an owner-only file elsewhere.
pub fn default_secret_store(root: &Path) -> Arc<dyn SecretStore> {
    #[cfg(target_os = "macos")]
    {
        let _ = root;
        Arc::new(KeychainSecretStore)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Arc::new(FileSecretStore::new(root.join("google").join("secrets.json")))
    }
}

/// In-memory store for tests. Never touches disk or the Keychain.
#[derive(Default)]
pub struct MemorySecretStore {
    map: Mutex<BTreeMap<String, String>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MemorySecretStore {
    fn kind(&self) -> &'static str {
        "memory"
    }
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        Ok(self.map.lock().unwrap_or_else(|e| e.into_inner()).get(name).cloned())
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).insert(name.into(), value.into());
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).remove(name);
        Ok(())
    }
}

/// JSON file with owner-only permissions (0600 on unix). Used on non-macOS platforms.
pub struct FileSecretStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl FileSecretStore {
    pub fn new(path: PathBuf) -> Self {
        FileSecretStore { path, lock: Mutex::new(()) }
    }
    fn load(&self) -> Result<BTreeMap<String, String>, String> {
        match fs::read_to_string(&self.path) {
            Ok(text) if text.trim().is_empty() => Ok(BTreeMap::new()),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("Google secrets file {} is corrupt: {e}", self.path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(format!("Cannot read Google secrets file {}: {e}", self.path.display())),
        }
    }
    fn save(&self, map: &BTreeMap<String, String>) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
        write_atomic(&self.path, &bytes, true)
    }
}

impl SecretStore for FileSecretStore {
    fn kind(&self) -> &'static str {
        "file"
    }
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        Ok(self.load()?.get(name).cloned())
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = self.load()?;
        map.insert(name.into(), value.into());
        self.save(&map)
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = self.load()?;
        if map.remove(name).is_some() {
            self.save(&map)?;
        }
        Ok(())
    }
}

/// macOS Keychain generic passwords: service `com.freddai.google`, account = the secret name.
#[cfg(target_os = "macos")]
pub struct KeychainSecretStore;

#[cfg(target_os = "macos")]
impl SecretStore for KeychainSecretStore {
    fn kind(&self) -> &'static str {
        "keychain"
    }
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(KEYCHAIN_SERVICE, name) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|e| format!("Keychain item for {name} is not valid UTF-8: {e}")),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(e) => Err(format!("Keychain read failed for {name}: {e}")),
        }
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, name, value.as_bytes())
            .map_err(|e| format!("Keychain write failed for {name}: {e}"))
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, name) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(format!("Keychain delete failed for {name}: {e}")),
        }
    }
}

#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

// ------------------------------------------------------------------ token blob

/// What is kept in the secret store for each account (one JSON blob under the account email).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub refresh_token: String,
    pub access_token: Option<String>,
    /// Unix seconds at which `access_token` expires.
    pub expires_at: Option<i64>,
}

pub fn load_tokens(secrets: &dyn SecretStore, email: &str) -> Result<Option<Tokens>, String> {
    match secrets.get(email)? {
        None => Ok(None),
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("Stored Google credentials for {email} are unreadable: {e}")),
    }
}

pub fn save_tokens(secrets: &dyn SecretStore, email: &str, tokens: &Tokens) -> Result<(), String> {
    secrets.set(email, &serde_json::to_string(tokens).map_err(|e| e.to_string())?)
}

// ------------------------------------------------------------------ files

/// Write `bytes` to `path` via a temp file + rename. `private` => 0600 on unix.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    use std::io::Write;
    let dir = path.parent().ok_or("Invalid path")?;
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        uuid::Uuid::new_v4().simple()
    ));
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    #[cfg(not(unix))]
    let _ = private;
    let result = (|| {
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    result.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot write {}: {e}", path.display())
    })
}

fn google_dir(root: &Path) -> PathBuf {
    root.join("google")
}

/// Serializes read-modify-write of accounts.json and config.json within the process.
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Default, Serialize, Deserialize)]
struct AccountsFile {
    #[serde(default)]
    accounts: Vec<Account>,
}

fn load_accounts(root: &Path) -> Result<AccountsFile, String> {
    let path = google_dir(root).join("accounts.json");
    match fs::read_to_string(&path) {
        Ok(text) if text.trim().is_empty() => Ok(AccountsFile::default()),
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Google accounts file {} is corrupt: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AccountsFile::default()),
        Err(e) => Err(format!("Cannot read {}: {e}", path.display())),
    }
}

fn save_accounts(root: &Path, file: &AccountsFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    write_atomic(&google_dir(root).join("accounts.json"), &bytes, false)
}

/// All connected accounts, in connection order.
pub fn list_accounts(root: &Path) -> Result<Vec<Account>, String> {
    let _g = lock();
    Ok(load_accounts(root)?.accounts)
}

pub fn get_account(root: &Path, email: &str) -> Result<Option<Account>, String> {
    Ok(list_accounts(root)?
        .into_iter()
        .find(|a| a.email.eq_ignore_ascii_case(email)))
}

/// Insert, or replace the account with the same email (case-insensitive).
pub fn upsert_account(root: &Path, account: Account) -> Result<(), String> {
    let _g = lock();
    let mut file = load_accounts(root)?;
    match file.accounts.iter_mut().find(|a| a.email.eq_ignore_ascii_case(&account.email)) {
        Some(existing) => *existing = account,
        None => file.accounts.push(account),
    }
    save_accounts(root, &file)
}

/// Change status + lastError; logs `google.account_status_changed` when the status differs.
pub fn set_status(
    root: &Path,
    email: &str,
    status: AccountStatus,
    last_error: Option<&str>,
) -> Result<(), String> {
    let _g = lock();
    let mut file = load_accounts(root)?;
    let account = file
        .accounts
        .iter_mut()
        .find(|a| a.email.eq_ignore_ascii_case(email))
        .ok_or_else(|| format!("Google account {email} is not connected"))?;
    if account.status != status {
        log_event(
            "google.account_status_changed",
            json!({"account":email,"from":account.status.as_str(),"to":status.as_str(),"error":last_error}),
        );
    }
    account.status = status;
    account.last_error = last_error.map(str::to_owned);
    save_accounts(root, &file)
}

/// Returns whether an account was removed.
pub fn remove_account(root: &Path, email: &str) -> Result<bool, String> {
    let _g = lock();
    let mut file = load_accounts(root)?;
    let before = file.accounts.len();
    file.accounts.retain(|a| !a.email.eq_ignore_ascii_case(email));
    let removed = file.accounts.len() != before;
    if removed {
        save_accounts(root, &file)?;
    }
    Ok(removed)
}

/// Pick the account a tool call should use.
/// - `Some(email)`: must be connected (returns the stored spelling of the email).
/// - `None`: exactly one connected account is used; zero or several are errors that say what to do.
pub fn resolve_account(root: &Path, requested: Option<&str>) -> Result<String, String> {
    let accounts = list_accounts(root)?;
    match requested.map(str::trim).filter(|s| !s.is_empty()) {
        Some(email) => accounts
            .iter()
            .find(|a| a.email.eq_ignore_ascii_case(email))
            .map(|a| a.email.clone())
            .ok_or_else(|| {
                let list: Vec<&str> = accounts.iter().map(|a| a.email.as_str()).collect();
                if list.is_empty() {
                    format!("Google account {email} is not connected. Connect it in Settings → Connected accounts.")
                } else {
                    format!("Google account {email} is not connected. Connected accounts: {}.", list.join(", "))
                }
            }),
        None => match accounts.as_slice() {
            [] => Err("No Google account is connected. Connect one in Settings → Connected accounts.".into()),
            [one] => Ok(one.email.clone()),
            many => Err(format!(
                "Several Google accounts are connected ({}). Pass the `account` argument to choose one.",
                many.iter().map(|a| a.email.as_str()).collect::<Vec<_>>().join(", ")
            )),
        },
    }
}

// ------------------------------------------------------------------ config

pub fn client_id(root: &Path) -> Result<Option<String>, String> {
    let _g = lock();
    let path = google_dir(root).join("config.json");
    match fs::read_to_string(&path) {
        Ok(text) => {
            let v: Value = serde_json::from_str(&text)
                .map_err(|e| format!("Google config {} is corrupt: {e}", path.display()))?;
            Ok(v["clientId"].as_str().map(str::to_owned).filter(|s| !s.is_empty()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read {}: {e}", path.display())),
    }
}

pub fn client_secret(ctx: &Context) -> Result<Option<String>, String> {
    ctx.secrets.get(CLIENT_SECRET_KEY)
}

/// Client ID and whether a client secret is stored. An unreadable secret store (Keychain access
/// denied, corrupt file) must not hide the rest of the settings: it reports `hasClientSecret: false`,
/// logs `google.config_secret_unreadable` and adds `"secretError"` with the message.
pub fn config_get(ctx: &Context) -> Result<Value, String> {
    let client_id = client_id(&ctx.root)?;
    let (has_secret, secret_error) = match client_secret(ctx) {
        Ok(secret) => (secret.is_some(), None),
        Err(e) => {
            log_event("google.config_secret_unreadable", json!({"storage": ctx.secrets.kind(), "error": e}));
            (false, Some(e))
        }
    };
    let mut out = json!({
        "clientId": client_id,
        "hasClientSecret": has_secret,
        "secretStorage": if ctx.secrets.kind() == "keychain" { "keychain" } else { "file" },
    });
    if let Some(e) = secret_error {
        out["secretError"] = json!(e);
    }
    Ok(out)
}

pub fn config_set(ctx: &Context, client_id: &str, client_secret: Option<&str>) -> Result<Value, String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Err("Google OAuth client ID is required".into());
    }
    {
        let _g = lock();
        let bytes = serde_json::to_vec_pretty(&json!({ "clientId": client_id })).map_err(|e| e.to_string())?;
        write_atomic(&google_dir(&ctx.root).join("config.json"), &bytes, false)?;
    }
    if let Some(secret) = client_secret.map(str::trim).filter(|s| !s.is_empty()) {
        ctx.secrets.set(CLIENT_SECRET_KEY, secret)?;
    }
    config_get(ctx)
}
