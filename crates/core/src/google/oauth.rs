//! Desktop OAuth (loopback redirect + PKCE) for Google accounts, and disconnect/revoke.
//!
//! `start_flow` binds `127.0.0.1:0`, returns the consent URL, and finishes the sign-in on a
//! background thread. The caller (the GUI) opens the browser and polls [`flow_status`].

use super::store::{self, Account, AccountStatus, Tokens};
use super::{log_event, Context, Service};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

/// Google endpoints. Defaults point at production; tests point every field at a local mock.
#[derive(Clone, Debug)]
pub struct Endpoints {
    pub auth: String,
    pub token: String,
    pub revoke: String,
    pub userinfo: String,
    /// API base URLs for later slices (no trailing slash). Tests point these at the mock.
    pub gmail_api: String,
    pub calendar_api: String,
    pub drive_api: String,
    pub drive_upload_api: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            auth: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            revoke: "https://oauth2.googleapis.com/revoke".into(),
            userinfo: "https://openidconnect.googleapis.com/v1/userinfo".into(),
            gmail_api: "https://gmail.googleapis.com/gmail/v1".into(),
            calendar_api: "https://www.googleapis.com/calendar/v3".into(),
            drive_api: "https://www.googleapis.com/drive/v3".into(),
            drive_upload_api: "https://www.googleapis.com/upload/drive/v3".into(),
        }
    }
}

impl Endpoints {
    /// Every endpoint under `http://<host>` with distinct paths (for mock servers).
    pub fn mock(base: &str) -> Self {
        Endpoints {
            auth: format!("{base}/auth"),
            token: format!("{base}/token"),
            revoke: format!("{base}/revoke"),
            userinfo: format!("{base}/userinfo"),
            gmail_api: format!("{base}/gmail/v1"),
            calendar_api: format!("{base}/calendar/v3"),
            drive_api: format!("{base}/drive/v3"),
            drive_upload_api: format!("{base}/upload/drive/v3"),
        }
    }
}

// ------------------------------------------------------------------ pure helpers

/// RFC 7636 S256: BASE64URL(SHA256(verifier)) without padding.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// 64 hex characters from two random v4 UUIDs (valid PKCE verifier and `state`).
fn random_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

pub fn scope_string(services: &[Service]) -> String {
    let mut scopes = vec!["openid", "email", "profile"];
    scopes.extend(services.iter().map(|s| s.scope()));
    scopes.join(" ")
}

pub fn build_auth_url(
    endpoints: &Endpoints,
    client_id: &str,
    redirect_uri: &str,
    services: &[Service],
    state: &str,
    code_challenge: &str,
) -> Result<String, String> {
    let scope = scope_string(services);
    reqwest::Url::parse_with_params(
        &endpoints.auth,
        &[
            ("client_id", client_id),
            ("redirect_uri", redirect_uri),
            ("response_type", "code"),
            ("scope", scope.as_str()),
            ("state", state),
            ("code_challenge", code_challenge),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("include_granted_scopes", "false"),
        ],
    )
    .map(String::from)
    .map_err(|e| format!("Invalid Google auth endpoint: {e}"))
}

/// Which of our services a space-separated OAuth `scope` string grants.
pub fn granted_services(scope: &str) -> Vec<Service> {
    let have: Vec<&str> = scope.split_whitespace().collect();
    Service::ALL
        .into_iter()
        .filter(|s| have.contains(&s.scope()))
        .collect()
}

pub(crate) fn http(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(timeout)
        .user_agent("freddai-google/1")
        .build()
        .map_err(|e| format!("Cannot create HTTP client: {e}"))
}

/// Pull Google's `error` / `error_description` out of an OAuth token-endpoint error body.
pub(crate) fn oauth_error(body: &str) -> (Option<String>, String) {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let code = v["error"].as_str().map(str::to_owned);
    let desc = v["error_description"].as_str().unwrap_or_default();
    let text = match (&code, desc.is_empty()) {
        (Some(c), false) => format!("{c}: {desc}"),
        (Some(c), true) => c.clone(),
        _ => body.chars().take(300).collect(),
    };
    (code, text)
}

// ------------------------------------------------------------------ flow registry

#[derive(Clone, Debug, PartialEq)]
pub enum FlowState {
    Pending,
    Connected { email: String },
    Failed { error: String },
    Expired,
    /// A newer sign-in attempt replaced this one (reported to the UI as `expired`).
    Superseded,
}

/// Error text shown for a [`FlowState::Superseded`] flow.
pub const SUPERSEDED_MESSAGE: &str = "Superseded by a newer sign-in attempt";

/// Finished flows are kept this long so the UI can still read their outcome.
const FINISHED_FLOW_TTL: Duration = Duration::from_secs(30 * 60);

struct FlowEntry {
    state: FlowState,
    at: Instant,
    /// Sign-in state belongs to one app data root (tests run many roots in one process).
    root: PathBuf,
    /// Set to make the flow's listener thread stop waiting and release its port.
    cancel: Arc<AtomicBool>,
}

type FlowMap = HashMap<String, FlowEntry>;

fn flows() -> &'static Mutex<FlowMap> {
    static FLOWS: OnceLock<Mutex<FlowMap>> = OnceLock::new();
    FLOWS.get_or_init(Default::default)
}

fn set_flow(id: &str, state: FlowState) {
    if let Some(e) = flows().lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
        e.state = state;
        e.at = Instant::now();
    }
}

pub fn flow_status(flow_id: &str) -> Option<FlowState> {
    flows().lock().unwrap_or_else(|e| e.into_inner()).get(flow_id).map(|e| e.state.clone())
}

/// Drop flows that finished more than `max_age` ago (pending ones are bounded by their own deadline).
fn prune_flows(map: &mut FlowMap, max_age: Duration) {
    map.retain(|_, e| e.state == FlowState::Pending || e.at.elapsed() < max_age);
}

/// Register a new pending flow for `root`: prune old finished flows and supersede (cancel) any
/// still-pending flow of the same root so at most one sign-in listener stays open.
fn register_flow(map: &mut FlowMap, root: &std::path::Path, flow_id: &str, cancel: Arc<AtomicBool>, max_age: Duration) {
    prune_flows(map, max_age);
    for (id, e) in map.iter_mut().filter(|(_, e)| e.state == FlowState::Pending && e.root == root) {
        e.cancel.store(true, Ordering::SeqCst);
        e.state = FlowState::Superseded;
        e.at = Instant::now();
        log_event("google.connect_superseded", json!({"flow": id, "by": flow_id}));
    }
    map.insert(
        flow_id.to_owned(),
        FlowEntry { state: FlowState::Pending, at: Instant::now(), root: root.to_path_buf(), cancel },
    );
}

/// Bind the loopback listener, register a pending flow and spawn the callback thread.
/// Returns `(auth_url, flow_id)`.
pub fn start_flow(ctx: &Context, services: &[Service]) -> Result<(String, String), String> {
    if services.is_empty() {
        return Err("Choose at least one Google service (gmail, calendar, drive)".into());
    }
    let client_id = store::client_id(&ctx.root)?
        .ok_or("No Google OAuth client ID is configured. Add one in Settings → Connected accounts.")?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Cannot open a local port for Google sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = random_token();
    let verifier = random_token();
    let auth_url = build_auth_url(
        &ctx.endpoints,
        &client_id,
        &redirect_uri,
        services,
        &state,
        &pkce_challenge(&verifier),
    )?;
    let flow_id = uuid::Uuid::new_v4().simple().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    register_flow(
        &mut flows().lock().unwrap_or_else(|e| e.into_inner()),
        &ctx.root,
        &flow_id,
        cancel.clone(),
        FINISHED_FLOW_TTL,
    );
    let job = FlowJob { ctx: ctx.clone(), client_id, redirect_uri, state, verifier, flow_id: flow_id.clone(), cancel };
    std::thread::Builder::new()
        .name("google-oauth".into())
        .spawn(move || {
            let id = job.flow_id.clone();
            let outcome = run_flow(&job, listener);
            let state = match outcome {
                Ok(email) => {
                    log_event("google.connect_succeeded", json!({"account":email}));
                    FlowState::Connected { email }
                }
                Err(FlowEnd::Expired) => {
                    log_event("google.connect_expired", json!({"flow":id}));
                    FlowState::Expired
                }
                Err(FlowEnd::Superseded) => FlowState::Superseded,
                Err(FlowEnd::Failed(error)) => {
                    log_event("google.connect_failed", json!({"flow":id,"error":error}));
                    FlowState::Failed { error }
                }
            };
            set_flow(&id, state);
        })
        .map_err(|e| format!("Cannot start Google sign-in thread: {e}"))?;
    Ok((auth_url, flow_id))
}

struct FlowJob {
    ctx: Context,
    client_id: String,
    redirect_uri: String,
    state: String,
    verifier: String,
    flow_id: String,
    cancel: Arc<AtomicBool>,
}

enum FlowEnd {
    Expired,
    Superseded,
    Failed(String),
}

impl From<String> for FlowEnd {
    fn from(e: String) -> Self {
        FlowEnd::Failed(e)
    }
}

fn run_flow(job: &FlowJob, listener: TcpListener) -> Result<String, FlowEnd> {
    let deadline = Instant::now() + job.ctx.flow_timeout;
    let (code, mut stream) = wait_for_callback(&listener, &job.state, deadline, job.ctx.callback_read_budget, &job.cancel)?;
    drop(listener); // release the port as soon as the redirect arrived
    let result = finish_connect(job, &code);
    match &result {
        Ok(account) => respond_page(
            &mut stream,
            200,
            "Google account connected",
            &format!("{} is now connected to Freddai. You can close this tab.", account.email),
        ),
        Err(error) => respond_page(
            &mut stream,
            400,
            "Google account not connected",
            &format!("{error} You can close this tab and try again in Freddai."),
        ),
    }
    result.map(|a| a.email).map_err(FlowEnd::Failed)
}

fn finish_connect(job: &FlowJob, code: &str) -> Result<Account, String> {
    let ctx = &job.ctx;
    let client = http(ctx.request_timeout)?;
    let secret = store::client_secret(ctx)?;
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", job.client_id.as_str()),
        ("code", code),
        ("code_verifier", job.verifier.as_str()),
        ("redirect_uri", job.redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];
    if let Some(s) = secret.as_deref() {
        form.push(("client_secret", s));
    }
    let resp = client
        .post(&ctx.endpoints.token)
        .form(&form)
        .send()
        .map_err(|e| format!("Could not reach Google to finish sign-in: {}.", e.without_url()))?;
    let status = resp.status();
    let body = resp.text().map_err(|e| format!("Unreadable Google token response: {}.", e.without_url()))?;
    if !status.is_success() {
        let (_, text) = oauth_error(&body);
        return Err(format!("Google rejected the sign-in code (HTTP {}): {text}.", status.as_u16()));
    }
    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: Option<i64>,
        refresh_token: Option<String>,
        scope: Option<String>,
    }
    let tokens: TokenResponse =
        serde_json::from_str(&body).map_err(|e| format!("Unexpected Google token response: {e}."))?;
    let services = granted_services(tokens.scope.as_deref().unwrap_or_default());
    if services.is_empty() {
        return Err("No Gmail, Calendar or Drive access was granted. Connect again and leave at least one permission ticked.".into());
    }
    let refresh_token = tokens.refresh_token.filter(|t| !t.is_empty()).ok_or(
        "Google did not return a refresh token. Remove Freddai at myaccount.google.com/permissions and connect again.",
    )?;

    let resp = client
        .get(&ctx.endpoints.userinfo)
        .bearer_auth(&tokens.access_token)
        .send()
        .map_err(|e| format!("Could not fetch the Google profile: {}.", e.without_url()))?;
    let status = resp.status();
    let body = resp.text().map_err(|e| format!("Unreadable Google profile response: {}.", e.without_url()))?;
    if !status.is_success() {
        return Err(format!(
            "Google profile request failed (HTTP {}): {}.",
            status.as_u16(),
            body.chars().take(300).collect::<String>()
        ));
    }
    let info: Value = serde_json::from_str(&body).map_err(|e| format!("Unexpected Google profile response: {e}."))?;
    let email = info["email"]
        .as_str()
        .filter(|e| !e.is_empty())
        .ok_or("Google did not return an email address for this account.")?
        .to_lowercase();
    let name = info["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(&email).to_owned();

    store::save_tokens(
        ctx.secrets.as_ref(),
        &email,
        &Tokens {
            refresh_token,
            access_token: Some(tokens.access_token),
            expires_at: Some(chrono::Utc::now().timestamp() + tokens.expires_in.unwrap_or(3600)),
        },
    )?;
    let account = Account {
        email,
        name,
        services,
        status: AccountStatus::Ok,
        last_error: None,
        connected_at: chrono::Utc::now().to_rfc3339(),
    };
    store::upsert_account(&ctx.root, account.clone())?;
    Ok(account)
}

// ------------------------------------------------------------------ loopback callback

/// What a request to the loopback listener means.
#[derive(Debug, PartialEq)]
pub(crate) enum Callback {
    /// Not a sign-in redirect (favicon, probes): answer 404, keep waiting.
    Ignore,
    /// State did not match: answer 400, keep waiting (a stray local request must not kill the flow).
    BadState,
    Denied(String),
    Code(String),
}

pub(crate) fn classify_callback(target: &str, expected_state: &str) -> Callback {
    let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Callback::Ignore;
    };
    if url.path() != "/" {
        return Callback::Ignore;
    }
    let q: HashMap<String, String> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if !q.contains_key("code") && !q.contains_key("error") {
        return Callback::Ignore;
    }
    if q.get("state").map(String::as_str) != Some(expected_state) {
        return Callback::BadState;
    }
    if let Some(err) = q.get("error") {
        return Callback::Denied(if err == "access_denied" {
            "Google sign-in was denied (access_denied). No account was connected.".into()
        } else {
            format!("Google sign-in failed: {err}.")
        });
    }
    Callback::Code(q["code"].clone())
}

fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
    deadline: Instant,
    read_budget: Duration,
    cancel: &AtomicBool,
) -> Result<(String, TcpStream), FlowEnd> {
    listener.set_nonblocking(true).map_err(|e| FlowEnd::Failed(e.to_string()))?;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(FlowEnd::Superseded);
        }
        if Instant::now() >= deadline {
            return Err(FlowEnd::Expired);
        }
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25));
                continue;
            }
            Err(e) => return Err(FlowEnd::Failed(format!("Local sign-in port failed: {e}"))),
        };
        if let Err(e) = stream.set_nonblocking(false) {
            log_event("google.connect_connection_dropped", json!({"reason": "set_blocking_failed", "error": e.to_string()}));
            continue;
        }
        // One absolute budget per connection (never past the flow deadline): a client that stalls
        // or drips bytes is dropped so the next connection (the real redirect) gets accepted.
        let conn_deadline = (Instant::now() + read_budget).min(deadline);
        let Some(target) = read_request_target(&mut stream, conn_deadline) else {
            log_event("google.connect_connection_dropped", json!({"reason": "no_complete_request_in_time"}));
            continue;
        };
        match classify_callback(&target, expected_state) {
            Callback::Ignore => respond_page(&mut stream, 404, "Not found", "Nothing to see here."),
            Callback::BadState => {
                log_event("google.connect_bad_state", json!({}));
                respond_page(
                    &mut stream,
                    400,
                    "Sign-in rejected",
                    "This request did not come from the sign-in Freddai started, so it was ignored.",
                );
            }
            Callback::Denied(msg) => {
                respond_page(&mut stream, 400, "Google account not connected", &format!("{msg} You can close this tab."));
                return Err(FlowEnd::Failed(msg));
            }
            Callback::Code(code) => return Ok((code, stream)),
        }
    }
}

/// Most bytes of request line + headers a local connection may send.
const MAX_HEAD_BYTES: usize = 16 * 1024;

/// Read the request line of an HTTP/1.x GET and return its target (path + query). The whole head
/// must arrive before `deadline` and fit in [`MAX_HEAD_BYTES`]; otherwise the connection is dropped
/// (`None`).
fn read_request_target(stream: &mut TcpStream, deadline: Instant) -> Option<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        if buf.len() >= MAX_HEAD_BYTES {
            return None;
        }
        let remaining = deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())?;
        stream.set_read_timeout(Some(remaining)).ok()?;
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => return None,
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let mut parts = head.lines().next()?.split_whitespace();
    (parts.next()? == "GET").then(|| parts.next().map(str::to_owned))?
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn respond_page(stream: &mut TcpStream, status: u16, title: &str, message: &str) {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{t}</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<style>body{{font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f6f7;color:#1c1c1e}}\
main{{max-width:28rem;padding:2rem;text-align:center}}h1{{font-size:1.25rem}}@media(prefers-color-scheme:dark){{body{{background:#1c1c1e;color:#f2f2f7}}}}</style>\
</head><body><main><h1>{t}</h1><p>{m}</p></main></body></html>",
        t = html_escape(title),
        m = html_escape(message)
    );
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    let sent = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    )
    .and_then(|()| stream.flush());
    if let Err(e) = sent {
        // The browser went away; the sign-in outcome itself is unaffected.
        log_event("google.connect_response_failed", json!({"status": status, "error": e.to_string()}));
    }
}

// ------------------------------------------------------------------ disconnect

/// Revoke at Google (best effort), then remove local secrets and metadata regardless.
/// Result: `{"ok":true}` plus `"revokeError"` when the revoke failed.
pub fn disconnect(ctx: &Context, email: &str) -> Result<Value, String> {
    // Same per-account lock as token refresh: an in-flight refresh finishes first, so it cannot
    // re-save tokens after they are deleted below.
    let lock = super::client::account_lock(&ctx.root, email);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let account = store::get_account(&ctx.root, email)?
        .ok_or_else(|| format!("Google account {email} is not connected"))?;
    let email = account.email.as_str();
    let mut revoke_error: Option<String> = None;
    match store::load_tokens(ctx.secrets.as_ref(), email) {
        Ok(Some(tokens)) => {
            if let Err(e) = revoke(ctx, &tokens.refresh_token) {
                log_event("google.revoke_failed", json!({"account":email,"error":e}));
                revoke_error = Some(e);
            }
        }
        Ok(None) => {}
        Err(e) => {
            log_event("google.revoke_skipped", json!({"account":email,"error":e}));
            revoke_error = Some(e);
        }
    }
    let secret_result = ctx.secrets.delete(email);
    let meta_result = store::remove_account(&ctx.root, email);
    secret_result.map_err(|e| format!("Disconnected {email} but could not delete its stored credentials: {e}"))?;
    meta_result?;
    log_event("google.disconnected", json!({"account":email,"revoked":revoke_error.is_none()}));
    let mut out = json!({ "ok": true });
    if let Some(e) = revoke_error {
        out["revokeError"] = json!(e);
    }
    Ok(out)
}

fn revoke(ctx: &Context, refresh_token: &str) -> Result<(), String> {
    let resp = http(ctx.request_timeout)?
        .post(&ctx.endpoints.revoke)
        .form(&[("token", refresh_token)])
        .send()
        .map_err(|e| format!("Could not reach Google to revoke access: {}", e.without_url()))?;
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().unwrap_or_else(|e| format!("(unreadable reply: {})", e.without_url()));
    let (_, text) = oauth_error(&body);
    Err(format!("Google revoke failed (HTTP {}): {text}", status.as_u16()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(root: &str, state: FlowState) -> FlowEntry {
        FlowEntry { state, at: Instant::now(), root: PathBuf::from(root), cancel: Arc::new(AtomicBool::new(false)) }
    }

    #[test]
    fn finished_flows_are_pruned_after_the_ttl_but_pending_ones_are_kept() {
        let mut map = FlowMap::new();
        map.insert("old-done".into(), entry("/r", FlowState::Expired));
        map.insert("old-pending".into(), entry("/r", FlowState::Pending));
        std::thread::sleep(Duration::from_millis(80));
        map.insert("fresh-done".into(), entry("/r", FlowState::Connected { email: "a@x.com".into() }));
        prune_flows(&mut map, Duration::from_millis(40));
        let mut keys: Vec<_> = map.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["fresh-done", "old-pending"]);
    }

    #[test]
    fn registering_a_flow_supersedes_only_pending_flows_of_the_same_root() {
        let mut map = FlowMap::new();
        map.insert("mine".into(), entry("/r", FlowState::Pending));
        map.insert("other-root".into(), entry("/elsewhere", FlowState::Pending));
        map.insert("done".into(), entry("/r", FlowState::Failed { error: "x".into() }));
        let new_cancel = Arc::new(AtomicBool::new(false));
        register_flow(&mut map, std::path::Path::new("/r"), "new", new_cancel.clone(), Duration::from_secs(60));
        assert_eq!(map["mine"].state, FlowState::Superseded);
        assert!(map["mine"].cancel.load(Ordering::SeqCst));
        assert_eq!(map["other-root"].state, FlowState::Pending);
        assert!(!map["other-root"].cancel.load(Ordering::SeqCst));
        assert_eq!(map["done"].state, FlowState::Failed { error: "x".into() });
        assert_eq!(map["new"].state, FlowState::Pending);
        assert!(!new_cancel.load(Ordering::SeqCst));
    }
}
