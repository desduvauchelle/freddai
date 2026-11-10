//! Test helpers for the Google module (cfg(test) only): a minimal mock HTTP server on 127.0.0.1,
//! a temp app root, and a [`TestEnv`] bundling mock endpoints + an in-memory secret store.
//! Later slices reuse it: `let env = TestEnv::new(|req| Response::json(200, json!({...})));`
//! then `GoogleClient::with_context(env.ctx.clone(), "a@b.com")` after `env.connect("a@b.com")`.

use super::store::{self, Account, AccountStatus, MemorySecretStore, Tokens};
use super::{Context, Endpoints, Service};
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    /// Path including query string.
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Request {
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or("")
    }
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    /// Value of a form-encoded body field.
    pub fn form(&self, key: &str) -> Option<String> {
        reqwest::Url::parse(&format!("http://x/?{}", self.body))
            .ok()?
            .query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    }
}

pub struct Response {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
    pub headers: Vec<(String, String)>,
}

impl Response {
    /// Add a response header (e.g. `Location`, `Retry-After`, `Range`).
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }
    pub fn json(status: u16, v: Value) -> Self {
        Response { status, content_type: "application/json", body: v.to_string().into_bytes(), headers: Vec::new() }
    }
    pub fn text(status: u16, s: &str) -> Self {
        Response { status, content_type: "text/plain", body: s.as_bytes().to_vec(), headers: Vec::new() }
    }
}

pub struct MockServer {
    pub base: String,
    requests: Arc<Mutex<Vec<Request>>>,
}

impl MockServer {
    pub fn start(handler: impl Fn(&Request) -> Response + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock");
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(handler);
        let log = requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (handler, log) = (handler.clone(), log.clone());
                std::thread::spawn(move || serve(stream, handler.as_ref(), &log));
            }
        });
        MockServer { base, requests }
    }
    pub fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap().clone()
    }
    /// Requests whose path (without query) equals `path`.
    pub fn count(&self, path: &str) -> usize {
        self.requests().iter().filter(|r| r.path() == path).count()
    }
}

fn serve(mut stream: TcpStream, handler: &dyn Fn(&Request) -> Response, log: &Mutex<Vec<Request>>) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let (method, target) = (first.next().unwrap_or("").to_owned(), first.next().unwrap_or("").to_owned());
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned())))
        .collect();
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    while buf.len() < head_end + len {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let body = String::from_utf8_lossy(&buf[head_end..]).into_owned();
    let req = Request { method, target, headers, body };
    log.lock().unwrap().push(req.clone());
    let resp = handler(&req);
    let extra: String = resp.headers.iter().map(|(k, v)| format!("{k}: {v}\r\n")).collect();
    let _ = stream.write_all(
        format!(
            "HTTP/1.1 {} X\r\nContent-Type: {}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n",
            resp.status,
            resp.content_type,
            resp.body.len()
        )
        .as_bytes(),
    );
    let _ = stream.write_all(&resp.body);
}

/// Temp app root, deleted on drop.
pub struct TempRoot(pub PathBuf);

impl Default for TempRoot {
    fn default() -> Self {
        Self::new()
    }
}

impl TempRoot {
    pub fn new() -> Self {
        let p = std::env::temp_dir().join(format!("freddai-google-test-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&p).unwrap();
        TempRoot(p)
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Mock server + temp root + in-memory secrets + a [`Context`] wired to them.
pub struct TestEnv {
    pub server: MockServer,
    pub root: TempRoot,
    pub secrets: Arc<MemorySecretStore>,
    pub ctx: Context,
}

impl TestEnv {
    pub fn new(handler: impl Fn(&Request) -> Response + Send + Sync + 'static) -> Self {
        let server = MockServer::start(handler);
        let root = TempRoot::new();
        let secrets = Arc::new(MemorySecretStore::new());
        let ctx = Context::new(&root.0, Endpoints::mock(&server.base), secrets.clone());
        TestEnv { server, root, secrets, ctx }
    }
    /// Configure a client ID (and secret) as the Settings screen would.
    pub fn configure(&self) {
        store::config_set(&self.ctx, "test-client-id", Some("test-client-secret")).unwrap();
    }
    /// Insert a connected account with the given token state (expires_in seconds from now).
    pub fn connect(&self, email: &str, access: Option<&str>, expires_in: i64) {
        self.configure();
        store::upsert_account(
            &self.root.0,
            Account {
                email: email.into(),
                name: "Test User".into(),
                services: Service::ALL.to_vec(),
                status: AccountStatus::Ok,
                last_error: None,
                connected_at: chrono::Utc::now().to_rfc3339(),
            },
        )
        .unwrap();
        store::save_tokens(
            self.secrets.as_ref(),
            email,
            &Tokens {
                refresh_token: "refresh-1".into(),
                access_token: access.map(str::to_owned),
                expires_at: Some(chrono::Utc::now().timestamp() + expires_in),
            },
        )
        .unwrap();
    }
}
