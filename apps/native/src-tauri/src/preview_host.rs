//! Mac side of the companion preview tunnel (docs/preview-tunnel.md): grants, the
//! `preview_open` entry point, and the executor that serves tunnel streams against
//! `127.0.0.1:<port>`. Nothing other than loopback on a granted port is ever reachable.
use crate::preview_tunnel::{self as tunnel, FrameType, Headers, ReqHead, ResHead, Role, Tunnel, TunnelConfig, TunnelError, TunnelEvent, TunnelSender, WsAccept, WsClose, WsOpen};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, net::{SocketAddr, TcpStream}, sync::{Mutex, OnceLock}, time::Duration};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{self, client::IntoClientRequest, protocol::{frame::coding::CloseCode, CloseFrame, WebSocketConfig}, Message};

#[allow(dead_code)]
pub const GRANT_TTL_SECS: u64 = 12 * 3600;
/// Companion HTTPS listener; never proxied.
pub const COMPANION_PORT: u16 = 49744;
const MAX_STREAMS: usize = 64;
const MAX_PATH: usize = 8 * 1024;

// ---------------------------------------------------------------- grants

#[derive(Default)]
pub struct Grants { map: HashMap<u16, (u64, String)>, reserved: HashSet<u16> }
#[allow(dead_code)]
impl Grants {
    /// Port rules: >= 1024, not the companion port, not a registered Freddai listener.
    pub fn check_port(&self, port: u16) -> Result<(), String> {
        if port < 1024 { return Err(format!("port {port} is below 1024")); }
        if port == COMPANION_PORT || self.reserved.contains(&port) { return Err(format!("port {port} is a Freddai port")); }
        Ok(())
    }
    pub fn grant(&mut self, port: u16, source: &str, now: u64) -> Result<(), String> {
        self.check_port(port)?;
        self.map.retain(|_, (expiry, _)| *expiry > now);
        self.map.insert(port, (now + GRANT_TTL_SECS, source.to_owned()));
        Ok(())
    }
    pub fn is_granted(&self, port: u16, now: u64) -> bool { self.check_port(port).is_ok() && self.map.get(&port).is_some_and(|(expiry, _)| *expiry > now) }
    pub fn reserve(&mut self, port: u16) { self.reserved.insert(port); self.map.remove(&port); }
}
fn grants() -> &'static Mutex<Grants> { static G: OnceLock<Mutex<Grants>> = OnceLock::new(); G.get_or_init(Default::default) }
/// Records a port shared by an agent (called by the `freddai_share_preview` MCP tool). Expires after 12 h.
#[allow(dead_code)]
pub fn grant_port(port: u16, source: &str) -> Result<(), String> {
    let result = grants().lock().map_err(|_| "grant store poisoned".to_string())?.grant(port, source, crate::companion_crypto::now());
    match &result {
        Ok(()) => eprintln!("preview_tunnel_grant_recorded port={port} source={source:?}"),
        Err(reason) => eprintln!("preview_tunnel_grant_refused port={port} source={source:?} reason={reason:?}"),
    }
    result
}
/// Imports shares recorded by the `freddai_share_preview` MCP tool. That tool runs in the background
/// host process, so it hands shares over through `companion/preview-grants.json`; `grant_port` applies
/// the port rules here. Refusals are logged by `grant_port`.
pub fn import_shared(root: &std::path::Path) {
    for port in freddai_core::preview_grants::active(root) { if !is_granted(port) { let _ = grant_port(port, "mcp"); } }
}
/// Marks a port as owned by a Freddai listener so it can never be granted or proxied.
#[allow(dead_code)]
pub fn reserve_port(port: u16) { if let Ok(mut g) = grants().lock() { g.reserve(port); } }
pub fn is_granted(port: u16) -> bool { grants().lock().map(|g| g.is_granted(port, crate::companion_crypto::now())).unwrap_or(false) }
/// True if `localhost:<port>` or `127.0.0.1:<port>` appears as a URL authority in `text`.
pub fn mentions_port(text: &str, port: u16) -> bool {
    let text = text.to_ascii_lowercase();
    for host in ["localhost", "127.0.0.1"] {
        let needle = format!("{host}:{port}");
        for (at, _) in text.match_indices(&needle) {
            let before_ok = text[..at].bytes().next_back().is_none_or(|b| !(b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')));
            let after_ok = text.as_bytes().get(at + needle.len()).is_none_or( |b| !b.is_ascii_digit());
            if before_ok && after_ok { return true; }
        }
    }
    false
}
/// Grant check: an explicit share, or a localhost URL for the port in the thread's messages.
pub fn authorize_at(grants: &Grants, port: u16, thread_text: Option<&str>, now: u64) -> Result<(), String> {
    grants.check_port(port)?;
    if grants.is_granted(port, now) || thread_text.is_some_and(|t| mentions_port(t, port)) { return Ok(()); }
    Err(format!("port {port} was not shared in this thread"))
}

// ---------------------------------------------------------------- runtime + open

pub(crate) fn runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| tokio::runtime::Builder::new_multi_thread().worker_threads(2).thread_name("preview-tunnel").enable_all().build().expect("preview tunnel runtime"))
}

pub struct RelayAuth<'a> { pub relay: Option<&'a str>, /** device mailbox secret (Bearer token) */ pub token: &'a str, /** device key hex */ pub key: &'a str }

/// Handles the `preview_open {threadId, port, path}` RPC for an already authenticated device.
/// `thread_text` is the serialized messages of `threadId` (None if unavailable); only consulted
/// when the port has no explicit grant. Errors are the named codes returned to the phone.
pub fn open(auth: &RelayAuth, port: u64, path: &str, thread_text: Option<&str>) -> Result<Value, String> {
    let refuse = |code: &str, detail: String| { eprintln!("preview_tunnel_open_refused code={code} port={port} detail={detail:?}"); Err::<Value, String>(format!("{code}: {detail}")) };
    let Ok(port) = u16::try_from(port) else { return refuse("preview_not_granted", "port out of range".into()) };
    if !path.starts_with('/') || path.starts_with("//") || path.len() > MAX_PATH || path.bytes().any(|b| b < 0x21 && b != b' ' || b == 0x7f) { return refuse("preview_invalid_request", "invalid path".into()); }
    {
        let g = grants().lock().map_err(|_| "preview_tunnel_unavailable: grant store poisoned".to_string())?;
        if let Err(reason) = authorize_at(&g, port, thread_text, crate::companion_crypto::now()) { return refuse("preview_not_granted", reason); }
    }
    if TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(1)).is_err() { return refuse("preview_port_unreachable", format!("nothing listening on {port}")); }
    let Some(relay) = auth.relay else { return refuse("preview_tunnel_unavailable", "no relay configured".into()) };
    let session = crate::companion_crypto::random();
    let cfg = TunnelConfig { relay: relay.to_owned(), mailbox: hex::encode(Sha256::digest(auth.token.as_bytes())), token: auth.token.to_owned(), session: session.clone(), key: auth.key.to_owned(), role: Role::Mac };
    match runtime().block_on(tunnel::connect(&cfg)) {
        Ok(t) => {
            eprintln!("preview_tunnel_opened port={port}");
            runtime().spawn(async move {
                let reason = serve(t, port).await;
                eprintln!("preview_tunnel_closed port={port} code={} detail={:?}", reason.code, reason.detail);
            });
            Ok(json!({"session": session, "port": port}))
        }
        Err(e) => { eprintln!("preview_tunnel_dial_failed port={port} code={} detail={:?}", e.code, e.detail); Err(format!("preview_tunnel_unavailable: {}", e.detail)) }
    }
}

/// Reports whether the dev server behind a granted port is listening. A share's recorded command is only
/// spawned when `start` is true (an explicit user click); otherwise a non-listening port with a command
/// returns `preview_server_confirm: <command> @ <cwd>` (the UI splits on the last ` @ `).
/// Callers must only pass granted ports: only a share can carry a command, so nothing else is ever spawned.
/// Errors: `preview_server_confirm`, `preview_server_starting` (retry shortly), `preview_server_failed`, `preview_port_unreachable`.
pub fn server_status(root: &std::path::Path, port: u16, start: bool, wait: Duration) -> Result<(), String> {
    use freddai_core::preview_grants::{is_listening, share};
    if is_listening(port) { return Ok(()); }
    let Some(command) = share(root, port).and_then(|s| s.command.map(|c| (c, s.cwd))) else {
        eprintln!("preview_tunnel_ensure_server port={port} result=no_command");
        return Err(format!("preview_port_unreachable: nothing listening on {port}"));
    };
    if !start {
        let cwd = command.1.as_ref().map(|c| c.display().to_string()).unwrap_or_default();
        eprintln!("preview_tunnel_ensure_server port={port} result=confirm");
        return Err(format!("preview_server_confirm: {} @ {cwd}", command.0));
    }
    ensure_server(root, port, wait)
}

fn ensure_server(root: &std::path::Path, port: u16, wait: Duration) -> Result<(), String> {
    use freddai_core::preview_grants::{ensure_running, ServerState};
    match ensure_running(root, port, wait) {
        ServerState::Listening => { eprintln!("preview_tunnel_ensure_server port={port} result=listening"); Ok(()) }
        ServerState::Starting { pid, log } => { eprintln!("preview_tunnel_ensure_server port={port} result=starting pid={pid}"); Err(format!("preview_server_starting: pid {pid}, log {}", log.display())) }
        ServerState::Failed { detail, .. } => { eprintln!("preview_tunnel_ensure_server port={port} result=failed detail={detail:?}"); Err(format!("preview_server_failed: {detail}")) }
        ServerState::NoCommand => { eprintln!("preview_tunnel_ensure_server port={port} result=no_command"); Err(format!("preview_port_unreachable: nothing listening on {port}")) }
    }
}

/// Parses `http(s)://localhost|127.0.0.1:<port>[path][?query]` into `(port, path)`; fragment dropped.
/// Shared by the phone (`preview_device`) and the desktop `preview_open` command.
pub use crate::preview_url::parse_localhost_url;

// ---------------------------------------------------------------- executor

enum In { Body(Vec<u8>), End, WsText(String), WsBinary(Vec<u8>), WsClose(WsClose) }
struct Handle { tx: mpsc::UnboundedSender<In>, task: tokio::task::AbortHandle }

/// Serves every stream the device opens until the tunnel closes; returns why it closed.
pub async fn serve(mut t: Tunnel, port: u16) -> TunnelError {
    let client = match reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(3)).build() {
        Ok(c) => c,
        Err(e) => { t.sender.close(); return TunnelError::new("preview_tunnel_unavailable", e.to_string()); }
    };
    let mut streams: HashMap<u32, Handle> = HashMap::new();
    let reason = loop {
        let Some(event) = t.events.recv().await else { break TunnelError::new("preview_tunnel_closed", "event channel closed") };
        let frame = match event { TunnelEvent::Closed(e) => break e, TunnelEvent::Frame(f) => f };
        let id = frame.stream;
        match frame.kind {
            FrameType::ReqHead | FrameType::WsOpen => {
                streams.retain(|_, h| !h.task.is_finished());
                let reset = |code: &'static str, detail: &str| { let s = t.sender.clone(); let d = detail.to_owned(); async move { let _ = s.send_reset(id, code, Some(d)).await; } };
                if id % 2 == 0 || streams.contains_key(&id) { reset("preview_tunnel_protocol", "invalid or duplicate stream id").await; continue; }
                if streams.len() >= MAX_STREAMS { reset("preview_too_many_streams", "too many open streams").await; continue; }
                let (tx, rx) = mpsc::unbounded_channel();
                let sender = t.sender.clone();
                let task = if frame.kind == FrameType::ReqHead {
                    match frame.parse::<ReqHead>() { Ok(head) => tokio::spawn(run_http(client.clone(), sender, port, id, head, rx)), Err(e) => { reset(e.code, &e.detail).await; continue; } }
                } else {
                    match frame.parse::<WsOpen>() { Ok(open) => tokio::spawn(run_ws(sender, port, id, open, rx)), Err(e) => { reset(e.code, &e.detail).await; continue; } }
                };
                streams.insert(id, Handle { tx, task: task.abort_handle() });
            }
            FrameType::Body => { if let Some(h) = streams.get(&id) { let _ = h.tx.send(In::Body(frame.payload)); } }
            FrameType::End => { if let Some(h) = streams.get(&id) { let _ = h.tx.send(In::End); } }
            FrameType::WsText => { if let Some(h) = streams.get(&id) { let _ = h.tx.send(In::WsText(String::from_utf8_lossy(&frame.payload).into_owned())); } }
            FrameType::WsBinary => { if let Some(h) = streams.get(&id) { let _ = h.tx.send(In::WsBinary(frame.payload)); } }
            FrameType::WsClose => { if let Some(h) = streams.get(&id) { let _ = h.tx.send(In::WsClose(frame.parse().unwrap_or_default())); } }
            FrameType::Reset => { if let Some(h) = streams.remove(&id) { h.task.abort(); } }
            // Mac-to-device types arriving from the device are a protocol violation for that stream only.
            FrameType::ResHead | FrameType::WsAccept => { let _ = t.sender.send_reset(id, "preview_tunnel_protocol", Some("unexpected frame direction".into())).await; }
            FrameType::Ping | FrameType::Pong => {}
        }
    };
    for (_, h) in streams { h.task.abort(); }
    t.sender.close();
    reason
}

fn rewrite_origin(port: u16) -> String { format!("http://localhost:{port}") }
fn rewrite_referer(value: &str, port: u16) -> Option<String> {
    let u = reqwest::Url::parse(value).ok()?;
    let mut out = format!("{}{}", rewrite_origin(port), u.path());
    if let Some(q) = u.query() { out.push('?'); out.push_str(q); }
    Some(out)
}
/// Drops hop-by-hop headers, rewrites Host/Origin/Referer to `localhost:<port>`.
/// `drop` lists extra lowercase names to omit.
pub fn rewrite_request_headers(headers: &Headers, port: u16, drop: &[&str]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (k, v) in headers {
        let name = k.to_ascii_lowercase();
        if tunnel::is_hop_by_hop(&name) || name == "host" || drop.contains(&name.as_str()) { continue; }
        match name.as_str() {
            "origin" => out.push((name, rewrite_origin(port))),
            "referer" => if let Some(r) = rewrite_referer(v, port) { out.push((name, r)); },
            _ => out.push((name, v.clone())),
        }
    }
    out.push(("host".into(), format!("localhost:{port}")));
    out
}
fn target(scheme: &str, port: u16, path: &str) -> Result<reqwest::Url, (&'static str, String)> {
    if !path.starts_with('/') || path.starts_with("//") || path.len() > MAX_PATH { return Err(("preview_invalid_request", "invalid path".into())); }
    let url = reqwest::Url::parse(&format!("{scheme}://127.0.0.1:{port}{path}")).map_err(|e| ("preview_invalid_request", e.to_string()))?;
    if url.host_str() != Some("127.0.0.1") || url.port() != Some(port) { return Err(("preview_invalid_request", "path escapes the preview host".into())); }
    Ok(url)
}

async fn run_http(client: reqwest::Client, sender: TunnelSender, port: u16, id: u32, head: ReqHead, rx: mpsc::UnboundedReceiver<In>) {
    if let Err((code, detail)) = http_inner(&client, &sender, port, id, head, rx).await {
        eprintln!("preview_tunnel_stream_failed port={port} kind=http code={code} detail={detail:?}");
        let _ = sender.send_reset(id, code, Some(detail)).await;
    }
}
async fn http_inner(client: &reqwest::Client, sender: &TunnelSender, port: u16, id: u32, head: ReqHead, mut rx: mpsc::UnboundedReceiver<In>) -> Result<(), (&'static str, String)> {
    let url = target("http", port, &head.path)?;
    let method = reqwest::Method::from_bytes(head.method.as_bytes()).map_err(|_| ("preview_invalid_request", "invalid method".to_string()))?;
    let first = rx.recv().await;
    let has_body = matches!(first, Some(In::Body(_)));
    let mut req = client.request(method, url);
    for (k, v) in rewrite_request_headers(&head.headers, port, if has_body { &[] } else { &["content-length"] }) {
        let (Ok(name), Ok(value)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), reqwest::header::HeaderValue::from_str(&v)) else { continue };
        req = req.header(name, value);
    }
    if let Some(In::Body(first)) = first {
        let stream = futures_util::stream::unfold((Some(first), rx), |(pending, mut rx)| async move {
            if let Some(chunk) = pending { return Some((Ok::<_, std::io::Error>(bytes::Bytes::from(chunk)), (None, rx))); }
            match rx.recv().await { Some(In::Body(chunk)) => Some((Ok(bytes::Bytes::from(chunk)), (None, rx))), _ => None }
        });
        req = req.body(reqwest::Body::wrap_stream(stream));
    } else if first.is_none() { return Ok(()); }
    let response = req.send().await.map_err(|e| {
        if e.is_connect() { ("preview_port_unreachable", format!("nothing listening on {port}")) }
        else if e.is_timeout() { ("preview_request_timeout", e.to_string()) }
        else { ("preview_request_failed", e.without_url().to_string()) }
    })?;
    let headers = response.headers().iter().filter(|(k, _)| !tunnel::is_hop_by_hop(k.as_str()))
        .map(|(k, v)| (k.as_str().to_owned(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
    let fail = |e: TunnelError| (e.code, e.detail);
    sender.send_res_head(id, &ResHead { status: response.status().as_u16(), headers }).await.map_err(fail)?;
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| ("preview_response_failed", e.without_url().to_string()))?;
        sender.send_body(id, &chunk).await.map_err(fail)?;
    }
    sender.send_end(id).await.map_err(fail)
}

fn to_close_frame(c: &WsClose) -> CloseFrame {
    let code = match c.code { Some(1005 | 1006 | 1015) | None => CloseCode::Normal, Some(c) => CloseCode::from(c) };
    CloseFrame { code, reason: c.reason.clone().unwrap_or_default().into() }
}
async fn run_ws(sender: TunnelSender, port: u16, id: u32, open: WsOpen, rx: mpsc::UnboundedReceiver<In>) {
    if let Err((code, detail)) = ws_inner(&sender, port, id, open, rx).await {
        eprintln!("preview_tunnel_stream_failed port={port} kind=ws code={code} detail={detail:?}");
        let _ = sender.send_reset(id, code, Some(detail)).await;
    }
}
async fn ws_inner(sender: &TunnelSender, port: u16, id: u32, open: WsOpen, mut rx: mpsc::UnboundedReceiver<In>) -> Result<(), (&'static str, String)> {
    target("ws", port, &open.path)?;
    // Connect to loopback, but present `localhost:<port>` as the authority: tungstenite derives Host from the URI.
    let mut req = format!("ws://localhost:{port}{}", open.path).into_client_request().map_err(|e| ("preview_invalid_request", e.to_string()))?;
    for (k, v) in rewrite_request_headers(&open.headers, port, &["sec-websocket-protocol", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "content-length"]) {
        if k == "host" || k.starts_with("sec-websocket-") { continue; }
        if let (Ok(name), Ok(value)) = (tungstenite::http::HeaderName::from_bytes(k.as_bytes()), tungstenite::http::HeaderValue::from_str(&v)) { req.headers_mut().append(name, value); }
    }
    if !open.protocols.is_empty() {
        let value = open.protocols.join(", ");
        req.headers_mut().insert("sec-websocket-protocol", tungstenite::http::HeaderValue::from_str(&value).map_err(|_| ("preview_invalid_request", "invalid subprotocol".to_string()))?);
    }
    let config = WebSocketConfig::default().max_message_size(Some(tunnel::MAX_FRAME_PLAINTEXT)).max_frame_size(Some(tunnel::MAX_FRAME_PLAINTEXT));
    let socket = match tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect(SocketAddr::from(([127, 0, 0, 1], port)))).await {
        Ok(Ok(s)) => s,
        Ok(Err(_)) => return Err(("preview_port_unreachable", format!("nothing listening on {port}"))),
        Err(_) => return Err(("preview_ws_failed", "connect timed out".into())),
    };
    let (mut ws, response) = match tokio::time::timeout(Duration::from_secs(5), tokio_tungstenite::client_async_with_config(req, socket, Some(config))).await {
        Err(_) => return Err(("preview_ws_failed", "handshake timed out".into())),
        Ok(Err(tungstenite::Error::Io(_))) => return Err(("preview_port_unreachable", format!("nothing listening on {port}"))),
        Ok(Err(tungstenite::Error::Http(r))) => return Err(("preview_ws_rejected", format!("server answered HTTP {}", r.status().as_u16()))),
        Ok(Err(e)) => return Err(("preview_ws_failed", e.to_string())),
        Ok(Ok(v)) => v,
    };
    let protocol = response.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()).map(str::to_owned);
    let fail = |e: TunnelError| (e.code, e.detail);
    sender.send_ws_accept(id, &WsAccept { protocol }).await.map_err(fail)?;
    loop {
        tokio::select! {
            incoming = rx.recv() => match incoming {
                None | Some(In::End) | Some(In::Body(_)) => { let _ = ws.close(None).await; return Ok(()); }
                Some(In::WsText(t)) => ws.send(Message::Text(t.into())).await.map_err(|e| ("preview_ws_failed", e.to_string()))?,
                Some(In::WsBinary(b)) => ws.send(Message::Binary(b.into())).await.map_err(|e| ("preview_ws_failed", e.to_string()))?,
                Some(In::WsClose(c)) => { let _ = ws.send(Message::Close(Some(to_close_frame(&c)))).await; let _ = ws.close(None).await; return Ok(()); }
            },
            message = ws.next() => match message {
                None => { sender.send_ws_close(id, &WsClose::default()).await.map_err(fail)?; return Ok(()); }
                Some(Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed)) => { sender.send_ws_close(id, &WsClose::default()).await.map_err(fail)?; return Ok(()); }
                Some(Err(e)) => return Err(("preview_ws_failed", e.to_string())),
                Some(Ok(Message::Text(t))) => sender.send_ws_text(id, t.as_str()).await.map_err(fail)?,
                Some(Ok(Message::Binary(b))) => sender.send_ws_binary(id, &b).await.map_err(fail)?,
                Some(Ok(Message::Close(c))) => {
                    let close = c.map(|c| WsClose { code: Some(u16::from(c.code)), reason: Some(c.reason.to_string()) }).unwrap_or_default();
                    sender.send_ws_close(id, &close).await.map_err(fail)?;
                    return Ok(());
                }
                Some(Ok(_)) => {}
            }
        }
    }
}

#[cfg(test)]
#[path = "preview_host/tests.rs"]
mod tests;
