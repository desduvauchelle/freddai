//! Connected Google accounts: desktop OAuth (loopback + PKCE), multi-account token storage with
//! automatic refresh, an authorized HTTP helper, and the host operations the UI calls.
//!
//! Layout:
//! - [`oauth`]  sign-in flow, [`Endpoints`] (injectable for tests)
//! - [`store`]  account metadata (`<root>/google/accounts.json`), config, [`SecretStore`]s, [`resolve_account`]
//! - [`client`] [`GoogleClient`]: authorized requests with refresh + one 401 retry
//! - `gmail`, `calendar`, `drive`, `triggers`: reserved for later slices
//!
//! Everything here is blocking and safe to call from any thread, including tokio worker threads
//! (the HTTP work always runs on a dedicated scoped std thread, see [`off_runtime`]).
//! Failures are loud: every failed request, refresh and status change emits a structured
//! `{"event":"google.*"}` line on stderr (never containing tokens, codes or secrets).

pub mod calendar;
pub mod client;
pub mod drive;
pub mod gmail;
pub mod oauth;
pub mod store;
pub mod triggers;
#[cfg(test)]
pub mod test_support;
#[cfg(test)]
mod tests;

pub use client::{Body, GoogleClient, GoogleError, HttpMethod};
pub use oauth::{Endpoints, FlowState};
pub use store::{
    list_accounts, resolve_account, Account, AccountStatus, FileSecretStore, MemorySecretStore,
    SecretStore,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

/// A Google product the app can be granted access to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Gmail,
    Calendar,
    Drive,
}

impl Service {
    pub const ALL: [Service; 3] = [Service::Gmail, Service::Calendar, Service::Drive];
    pub fn scope(self) -> &'static str {
        match self {
            Service::Gmail => "https://www.googleapis.com/auth/gmail.modify",
            Service::Calendar => "https://www.googleapis.com/auth/calendar",
            Service::Drive => "https://www.googleapis.com/auth/drive",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Service::Gmail => "gmail",
            Service::Calendar => "calendar",
            Service::Drive => "drive",
        }
    }
}

/// Everything the Google code needs from its environment. Production code uses
/// [`Context::production`]; tests build one with [`Context::new`] (mock endpoints + in-memory secrets).
#[derive(Clone)]
pub struct Context {
    /// App data root (the same `root` passed to `host::call`).
    pub root: PathBuf,
    pub endpoints: Endpoints,
    pub secrets: Arc<dyn SecretStore>,
    /// How long a sign-in flow waits for the browser redirect before expiring (default 5 minutes).
    pub flow_timeout: Duration,
    /// Overall timeout of an ordinary JSON call (default 30 s).
    pub request_timeout: Duration,
    /// Overall timeout of a media transfer: Drive download/upload chunks, Gmail attachments and
    /// message uploads (default 10 minutes). The connect timeout is always 30 s.
    pub media_timeout: Duration,
    /// Total time one local connection to the sign-in listener gets to send its request line and
    /// headers before it is dropped (default 5 s).
    pub callback_read_budget: Duration,
}

impl Context {
    pub fn new(root: &Path, endpoints: Endpoints, secrets: Arc<dyn SecretStore>) -> Self {
        Context {
            root: root.to_path_buf(),
            endpoints,
            secrets,
            flow_timeout: Duration::from_secs(300),
            request_timeout: Duration::from_secs(30),
            media_timeout: Duration::from_secs(600),
            callback_read_budget: Duration::from_secs(5),
        }
    }
    /// Real Google endpoints and the platform secret store (Keychain on macOS, 0600 file elsewhere).
    pub fn production(root: &Path) -> Self {
        Self::new(root, Endpoints::default(), store::default_secret_store(root))
    }
}

/// Emit a structured, named event on stderr (the same style as the host's `host_call.*` events).
/// Callers must never put tokens, codes or secrets in `fields`.
pub(crate) fn log_event(event: &str, fields: Value) {
    let mut line = json!({ "event": event });
    if let (Some(dst), Some(src)) = (line.as_object_mut(), fields.as_object()) {
        for (k, v) in src {
            dst.insert(k.clone(), v.clone());
        }
    }
    eprintln!("{line}");
}

/// Run `f` on a fresh scoped std thread. `reqwest::blocking` panics when used (or dropped) on a
/// tokio runtime thread; the Windows host dispatches operations from tokio `spawn_blocking`
/// workers, so every HTTP-doing entry point goes through here.
pub(crate) fn off_runtime<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|s| {
        s.spawn(f)
            .join()
            .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
    })
}

// ------------------------------------------------------------------ host operations

const HOST_COMMANDS: [&str; 6] = [
    "google_config_get",
    "google_config_set",
    "google_connect_start",
    "google_connect_status",
    "google_accounts",
    "google_disconnect",
];

pub fn is_host_command(method: &str) -> bool {
    HOST_COMMANDS.contains(&method) || triggers::is_host_command(method)
}

/// Entry point used by `host::dispatch` for the `google_*` operations.
pub fn host_call(root: &Path, method: &str, p: &Value) -> Result<Value, String> {
    host_call_with(&Context::production(root), method, p)
}

/// Same as [`host_call`] with an explicit [`Context`] (tests inject endpoints and secrets here).
pub fn host_call_with(ctx: &Context, method: &str, p: &Value) -> Result<Value, String> {
    off_runtime(|| match method {
        "google_config_get" => store::config_get(ctx),
        "google_config_set" => store::config_set(
            ctx,
            p["clientId"].as_str().ok_or("Missing clientId")?,
            p["clientSecret"].as_str(),
        ),
        "google_connect_start" => {
            let services = match p.get("services").filter(|v| !v.is_null()) {
                None => Service::ALL.to_vec(),
                Some(v) => serde_json::from_value::<Vec<Service>>(v.clone()).map_err(|e| {
                    format!("Invalid services (expected gmail, calendar and/or drive): {e}")
                })?,
            };
            let (auth_url, flow_id) = oauth::start_flow(ctx, &services)?;
            Ok(json!({ "authUrl": auth_url, "flowId": flow_id }))
        }
        "google_connect_status" => {
            let id = p["flowId"].as_str().ok_or("Missing flowId")?;
            Ok(match oauth::flow_status(id).ok_or_else(|| format!("Unknown Google sign-in flow {id}"))? {
                FlowState::Pending => json!({ "state": "pending" }),
                FlowState::Expired => json!({ "state": "expired", "error": "Sign-in timed out after 5 minutes. Start again." }),
                FlowState::Superseded => json!({ "state": "expired", "error": oauth::SUPERSEDED_MESSAGE }),
                FlowState::Connected { email } => json!({ "state": "connected", "email": email }),
                FlowState::Failed { error } => json!({ "state": "failed", "error": error }),
            })
        }
        "google_accounts" => Ok(json!({ "accounts": list_accounts(&ctx.root)? })),
        "google_disconnect" => {
            let email = p["email"].as_str().ok_or("Missing email")?;
            oauth::disconnect(ctx, email)
        }
        // Trigger saves validate their delivery against the Runtime; `host::dispatch` routes these to
        // `triggers::host_call(rt, ..)` first. This arm is the runtime-less path (tests, tooling).
        m if triggers::is_host_command(m) => triggers::host_op(ctx, &triggers::StandaloneDelivery, m, p),
        other => Err(format!("Unknown Google operation: {other}")),
    })
}
