//! Authorized HTTP helper for one connected Google account.
//!
//! ```ignore
//! let email = google::resolve_account(root, args["account"].as_str())?;
//! let client = google::GoogleClient::new(root, &email);
//! let v = client.get_json("https://gmail.googleapis.com/gmail/v1/users/me/profile", &[])?;
//! ```
//! Access tokens are refreshed when within 60 s of expiry; a 401 triggers one refresh and one retry.
//! A per-account lock prevents concurrent refreshes. Every non-2xx is an `Err` carrying the HTTP
//! status, Google's message/reason, the account and the request path.

use super::oauth::{http, oauth_error};
use super::store::{self, AccountStatus, Tokens};
use super::{log_event, off_runtime, Context};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl HttpMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
        }
    }
    fn reqwest(self) -> reqwest::Method {
        match self {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Put => reqwest::Method::PUT,
            HttpMethod::Patch => reqwest::Method::PATCH,
            HttpMethod::Delete => reqwest::Method::DELETE,
        }
    }
}

/// Request body.
#[derive(Clone, Debug)]
pub enum Body {
    None,
    Json(Value),
    /// Raw bytes with a caller-chosen `Content-Type` (media uploads, RFC 822 messages, ...).
    Bytes { content_type: String, data: Vec<u8> },
}

/// A status-checked response: lower-cased header names, raw body.
#[derive(Clone, Debug)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    /// First header named `name` (case-insensitive).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// A failed Google request. `Display` (and the `String` conversion) is exactly the loud message the
/// plain methods return; `status` and `retry_after_secs` let callers act on it without parsing text.
#[derive(Clone, Debug)]
pub struct GoogleError {
    pub message: String,
    /// HTTP status, `None` for transport and token failures.
    pub status: Option<u16>,
    /// Parsed `Retry-After` (seconds) from a 429 or 503 reply.
    pub retry_after_secs: Option<u64>,
}

impl std::fmt::Display for GoogleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<String> for GoogleError {
    fn from(message: String) -> Self {
        GoogleError { message, status: None, retry_after_secs: None }
    }
}

impl From<&str> for GoogleError {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}

impl From<GoogleError> for String {
    fn from(e: GoogleError) -> String {
        e.message
    }
}

/// `Retry-After` is delta-seconds or an HTTP date; returns seconds from now (0 for a past date).
pub fn parse_retry_after(value: &str) -> Option<u64> {
    let v = value.trim();
    if let Ok(secs) = v.parse::<u64>() {
        return Some(secs);
    }
    let at = chrono::DateTime::parse_from_rfc2822(v).ok()?;
    Some((at.timestamp() - chrono::Utc::now().timestamp()).max(0) as u64)
}

/// Refresh the access token when it has less than this many seconds left.
const REFRESH_MARGIN_SECS: i64 = 60;

type LockMap = Mutex<HashMap<(PathBuf, String), Arc<Mutex<()>>>>;

pub(crate) fn account_lock(root: &Path, email: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<LockMap> = OnceLock::new();
    LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry((root.to_path_buf(), email.to_lowercase()))
        .or_default()
        .clone()
}

/// An authorized client bound to one connected account.
#[derive(Clone)]
pub struct GoogleClient {
    ctx: Context,
    email: String,
    /// Use the long media-transfer timeout (`Context::media_timeout`) instead of the JSON one.
    media: bool,
}

impl GoogleClient {
    /// Production client (real endpoints, platform secret store). `email` should come from
    /// [`super::resolve_account`].
    pub fn new(root: &Path, email: &str) -> Self {
        Self::with_context(Context::production(root), email)
    }
    pub fn with_context(ctx: Context, email: &str) -> Self {
        GoogleClient { ctx, email: email.to_owned(), media: false }
    }
    pub fn email(&self) -> &str {
        &self.email
    }
    /// The same account with the longer media-transfer timeout, for Drive downloads/uploads and
    /// Gmail attachment/message transfers. Ordinary JSON calls keep the short timeout.
    pub fn media(&self) -> GoogleClient {
        GoogleClient { media: true, ..self.clone() }
    }
    /// Endpoints in use (API base URLs for Gmail/Calendar/Drive live here).
    pub fn endpoints(&self) -> &super::Endpoints {
        &self.ctx.endpoints
    }

    // ---- convenience wrappers (all return parsed JSON; an empty 2xx body is `Value::Null`)

    pub fn get_json(&self, url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        self.json(HttpMethod::Get, url, query, Body::None)
    }
    pub fn post_json(&self, url: &str, query: &[(&str, &str)], body: Value) -> Result<Value, String> {
        self.json(HttpMethod::Post, url, query, Body::Json(body))
    }
    pub fn put_json(&self, url: &str, query: &[(&str, &str)], body: Value) -> Result<Value, String> {
        self.json(HttpMethod::Put, url, query, Body::Json(body))
    }
    pub fn patch_json(&self, url: &str, query: &[(&str, &str)], body: Value) -> Result<Value, String> {
        self.json(HttpMethod::Patch, url, query, Body::Json(body))
    }
    pub fn delete(&self, url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        self.json(HttpMethod::Delete, url, query, Body::None)
    }
    /// POST/PUT/PATCH raw bytes, parse a JSON reply.
    pub fn send_bytes(
        &self,
        method: HttpMethod,
        url: &str,
        query: &[(&str, &str)],
        content_type: &str,
        data: Vec<u8>,
    ) -> Result<Value, String> {
        self.json(method, url, query, Body::Bytes { content_type: content_type.into(), data })
    }
    /// GET raw bytes (file downloads, `alt=media`, attachments).
    pub fn get_bytes(&self, url: &str, query: &[(&str, &str)]) -> Result<Vec<u8>, String> {
        self.request(HttpMethod::Get, url, query, Body::None)
    }

    /// GET a JSON reply keeping the structured error ([`GoogleError`]: status and `Retry-After`).
    /// Its message is identical to [`get_json`](Self::get_json)'s error string.
    pub fn get_json_checked(&self, url: &str, query: &[(&str, &str)]) -> Result<Value, GoogleError> {
        self.json_checked(HttpMethod::Get, url, query, Body::None)
    }

    fn json(&self, method: HttpMethod, url: &str, query: &[(&str, &str)], body: Body) -> Result<Value, String> {
        Ok(self.json_checked(method, url, query, body)?)
    }

    fn json_checked(&self, method: HttpMethod, url: &str, query: &[(&str, &str)], body: Body) -> Result<Value, GoogleError> {
        let bytes = self.request_full(method, url, query, body)?.body;
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_slice(&bytes).map_err(|e| {
            format!(
                "Google returned a non-JSON reply (account {}, {} {}): {e}",
                self.email,
                method.as_str(),
                url_path(url)
            )
        })?)
    }

    /// Core request: authorize, send, refresh once on 401, return the raw 2xx body.
    pub fn request(
        &self,
        method: HttpMethod,
        url: &str,
        query: &[(&str, &str)],
        body: Body,
    ) -> Result<Vec<u8>, String> {
        Ok(self.request_full(method, url, query, body)?.body)
    }

    /// Like [`request`](Self::request) but also returns the status and response headers. A failure
    /// is a [`GoogleError`] whose message equals the plain method's error string and which carries
    /// the parsed `Retry-After` of a 429/503.
    pub fn request_full(
        &self,
        method: HttpMethod,
        url: &str,
        query: &[(&str, &str)],
        body: Body,
    ) -> Result<Response, GoogleError> {
        self.request_with(method, url, query, &[], &[], body)
    }

    /// [`request_full`](Self::request_full) with extra request headers and extra statuses to treat as
    /// success (e.g. 308 "resume incomplete" for resumable uploads). Absolute `url`s are used as given.
    pub fn request_with(
        &self,
        method: HttpMethod,
        url: &str,
        query: &[(&str, &str)],
        headers: &[(&str, &str)],
        also_ok: &[u16],
        body: Body,
    ) -> Result<Response, GoogleError> {
        off_runtime(|| self.request_blocking(method, url, query, headers, also_ok, &body))
    }

    fn request_blocking(
        &self,
        method: HttpMethod,
        url: &str,
        query: &[(&str, &str)],
        headers: &[(&str, &str)],
        also_ok: &[u16],
        body: &Body,
    ) -> Result<Response, GoogleError> {
        let path = url_path(url);
        let mut token = self.access_token(None)?;
        let mut refreshed = false;
        loop {
            let resp = self.send_once(method, url, query, headers, body, &token, &path)?;
            let status = resp.status;
            if (200..300).contains(&status) || also_ok.contains(&status) {
                return Ok(resp);
            }
            if status == 401 && !refreshed {
                refreshed = true;
                log_event("google.request_unauthorized", json!({"account":self.email,"method":method.as_str(),"path":path}));
                token = self.access_token(Some(&token))?;
                continue;
            }
            let detail = api_error_detail(&resp.body);
            let msg = format!(
                "Google API error: HTTP {status} {detail} (account {}, {} {path})",
                self.email,
                method.as_str()
            );
            let retry_after_secs = if status == 429 || status == 503 {
                resp.header("retry-after").and_then(parse_retry_after)
            } else {
                None
            };
            log_event(
                "google.request_failed",
                json!({"account":self.email,"method":method.as_str(),"path":path,"status":status,"error":detail,"retry_after_secs":retry_after_secs}),
            );
            return Err(GoogleError { message: msg, status: Some(status), retry_after_secs });
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn send_once(
        &self,
        method: HttpMethod,
        url: &str,
        query: &[(&str, &str)],
        headers: &[(&str, &str)],
        body: &Body,
        token: &str,
        path: &str,
    ) -> Result<Response, String> {
        let fail = |what: &str, e: &dyn std::fmt::Display| {
            let msg = format!(
                "Google request failed: {what}: {e} (account {}, {} {path})",
                self.email,
                method.as_str()
            );
            log_event("google.request_failed", json!({"account":self.email,"method":method.as_str(),"path":path,"status":null,"error":msg}));
            msg
        };
        let timeout = if self.media { self.ctx.media_timeout } else { self.ctx.request_timeout };
        let mut req = http(timeout)?.request(method.reqwest(), url).bearer_auth(token);
        if !query.is_empty() {
            req = req.query(query);
        }
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        req = match body {
            Body::None => {
                if matches!(method, HttpMethod::Post | HttpMethod::Put | HttpMethod::Patch) {
                    req.header("Content-Length", "0")
                } else {
                    req
                }
            }
            Body::Json(v) => req.json(v),
            Body::Bytes { content_type, data } => req.header("Content-Type", content_type).body(data.clone()),
        };
        // `without_url`: a reqwest error otherwise embeds the full URL, query string included.
        let resp = req.send().map_err(|e| fail("could not reach Google", &e.without_url()))?;
        let status = resp.status().as_u16();
        let headers = resp
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_ascii_lowercase(), v.to_owned())))
            .collect();
        let bytes = resp.bytes().map_err(|e| fail("could not read the reply", &e.without_url()))?;
        // `Vec::from(Bytes)` reuses the buffer instead of copying a large download a second time.
        Ok(Response { status, headers, body: Vec::from(bytes) })
    }

    // ---- tokens

    /// A usable access token. `stale` is a token that just got a 401: it is never returned, and a
    /// refresh is skipped if another thread already replaced it.
    fn access_token(&self, stale: Option<&str>) -> Result<String, String> {
        let lock = account_lock(&self.ctx.root, &self.email);
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        let account = store::get_account(&self.ctx.root, &self.email)?.ok_or_else(|| {
            format!("Google account {} is not connected. Connect it in Settings → Connected accounts.", self.email)
        })?;
        if account.status == AccountStatus::NeedsReauth {
            return Err(reconnect_message(&self.email, account.last_error.as_deref().unwrap_or("access was revoked or expired")));
        }
        let tokens = store::load_tokens(self.ctx.secrets.as_ref(), &self.email)?.ok_or_else(|| {
            format!(
                "Stored credentials for Google account {} are missing. Reconnect it in Settings → Connected accounts.",
                self.email
            )
        })?;
        if let (Some(at), Some(exp)) = (&tokens.access_token, tokens.expires_at) {
            if exp - chrono::Utc::now().timestamp() > REFRESH_MARGIN_SECS && Some(at.as_str()) != stale {
                return Ok(at.clone());
            }
        }
        self.refresh(tokens, account.status)
    }

    /// Caller holds the account lock.
    fn refresh(&self, tokens: Tokens, status: AccountStatus) -> Result<String, String> {
        let ctx = &self.ctx;
        let client_id = store::client_id(&ctx.root)?
            .ok_or("No Google OAuth client ID is configured. Add one in Settings → Connected accounts.")?;
        let secret = store::client_secret(ctx)?;
        let mut form: Vec<(&str, &str)> = vec![
            ("client_id", client_id.as_str()),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];
        if let Some(s) = secret.as_deref() {
            form.push(("client_secret", s));
        }
        let fail = |detail: &str| {
            log_event("google.token_refresh_failed", json!({"account":self.email,"error":detail}));
            format!("Could not refresh Google access for {}: {detail}", self.email)
        };
        let resp = http(ctx.request_timeout)?
            .post(&ctx.endpoints.token)
            .form(&form)
            .send()
            .map_err(|e| fail(&format!("could not reach Google ({})", e.without_url())))?;
        let http_status = resp.status();
        let text = resp.text().map_err(|e| fail(&format!("unreadable reply ({})", e.without_url())))?;
        if !http_status.is_success() {
            let (code, detail) = oauth_error(&text);
            let detail = format!("HTTP {}: {detail}", http_status.as_u16());
            log_event("google.token_refresh_failed", json!({"account":self.email,"error":detail}));
            if code.as_deref() == Some("invalid_grant") {
                self.record_status(AccountStatus::NeedsReauth, &detail);
                return Err(reconnect_message(&self.email, &detail));
            }
            if http_status.is_client_error() {
                self.record_status(AccountStatus::Error, &detail);
            }
            return Err(format!("Could not refresh Google access for {}: {detail}", self.email));
        }
        let v: Value = serde_json::from_str(&text).map_err(|e| fail(&format!("unexpected reply ({e})")))?;
        let access = v["access_token"]
            .as_str()
            .ok_or_else(|| fail("the reply had no access_token"))?
            .to_owned();
        let updated = Tokens {
            refresh_token: v["refresh_token"].as_str().filter(|t| !t.is_empty()).map(str::to_owned).unwrap_or(tokens.refresh_token),
            access_token: Some(access.clone()),
            expires_at: Some(chrono::Utc::now().timestamp() + v["expires_in"].as_i64().unwrap_or(3600)),
        };
        // A disconnect that finished while the request was in flight must not be undone by saving
        // fresh tokens for an account that no longer exists.
        if store::get_account(&ctx.root, &self.email)?.is_none() {
            log_event("google.token_refresh_discarded", json!({"account":self.email,"reason":"account_disconnected"}));
            return Err(format!("Google account {} was disconnected while its access was being refreshed.", self.email));
        }
        store::save_tokens(ctx.secrets.as_ref(), &self.email, &updated)?;
        if status != AccountStatus::Ok {
            store::set_status(&ctx.root, &self.email, AccountStatus::Ok, None)?;
        }
        Ok(access)
    }
}

impl GoogleClient {
    /// Persist an account status change; a failure to do so is logged, never silently dropped.
    fn record_status(&self, status: AccountStatus, detail: &str) {
        if let Err(e) = store::set_status(&self.ctx.root, &self.email, status, Some(detail)) {
            log_event(
                "google.account_status_update_failed",
                json!({"account":self.email,"status":status.as_str(),"error":e}),
            );
        }
    }
}

fn reconnect_message(email: &str, detail: &str) -> String {
    format!(
        "Google account {email} needs to be reconnected ({detail}). Reconnect it in Settings → Connected accounts."
    )
}

/// Path of a URL for error messages and logs (no query string, never credentials).
pub(crate) fn url_path(url: &str) -> String {
    reqwest::Url::parse(url).map(|u| u.path().to_owned()).unwrap_or_else(|_| {
        // Unparseable: still never echo a query string or fragment.
        url.split(['?', '#']).next().unwrap_or("").chars().take(80).collect()
    })
}

/// `message [reason]` from a Google API error body, falling back to the raw (truncated) body.
fn api_error_detail(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let err = &v["error"];
    let message = err["message"].as_str().or_else(|| err["error_description"].as_str()).or_else(|| err.as_str());
    let reason = err["errors"][0]["reason"].as_str().or_else(|| err["status"].as_str());
    match (message, reason) {
        (Some(m), Some(r)) => format!("{m} [{r}]"),
        (Some(m), None) => m.to_owned(),
        _ if text.trim().is_empty() => "(empty reply)".into(),
        _ => text.chars().take(300).collect(),
    }
}
