//! Encrypted multiplexed preview tunnel over the Freddai relay (see docs/preview-tunnel.md).
//! Shared by the Mac side (serves streams against localhost) and the device side (opens streams).
//! The relay is a blind pipe: every WebSocket binary message is `nonce(12) || AES-256-GCM`.
use aes_gcm::{aead::{Aead, AeadCore, OsRng, Payload}, Aes256Gcm, Nonce};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::{sync::{mpsc, Notify}, time::Instant};
use tokio_tungstenite::tungstenite::{self, client::IntoClientRequest, protocol::WebSocketConfig, Message};

/// Largest BODY payload carried by one frame.
pub const MAX_BODY_CHUNK: usize = 256 * 1024;
/// Largest relay WebSocket message (the relay closes with 4413 above this).
pub const MAX_MESSAGE: usize = 1024 * 1024;
/// Largest frame plaintext: message minus nonce(12) and GCM tag(16).
pub const MAX_FRAME_PLAINTEXT: usize = MAX_MESSAGE - 28;
pub const PING_INTERVAL: Duration = Duration::from_secs(20);
/// Peers ping every 20 s; three missed intervals means the tunnel is dead.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(70);
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(10);

/// Named failure. `code` is a stable `preview_*` identifier shown to the user and logged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TunnelError { pub code: &'static str, pub detail: String }
impl TunnelError { pub fn new(code: &'static str, detail: impl Into<String>) -> Self { Self { code, detail: detail.into() } } }
impl std::fmt::Display for TunnelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.detail.is_empty() { f.write_str(self.code) } else { write!(f, "{} ({})", self.code, self.detail) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameType { ReqHead = 1, Body = 2, End = 3, ResHead = 4, WsOpen = 5, WsAccept = 6, WsText = 7, WsBinary = 8, WsClose = 9, Reset = 10, Ping = 11, Pong = 12 }
impl FrameType {
    pub fn from_u8(v: u8) -> Option<Self> {
        use FrameType::*;
        Some(match v { 1 => ReqHead, 2 => Body, 3 => End, 4 => ResHead, 5 => WsOpen, 6 => WsAccept, 7 => WsText, 8 => WsBinary, 9 => WsClose, 10 => Reset, 11 => Ping, 12 => Pong, _ => return None })
    }
}

/// `type u8 | stream u32 BE | payload`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame { pub kind: FrameType, pub stream: u32, pub payload: Vec<u8> }
impl Frame {
    pub fn new(kind: FrameType, stream: u32, payload: Vec<u8>) -> Self { Self { kind, stream, payload } }
    pub fn json<T: Serialize>(kind: FrameType, stream: u32, value: &T) -> Self {
        Self::new(kind, stream, serde_json::to_vec(value).unwrap_or_default())
    }
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(5 + self.payload.len());
        out.push(self.kind as u8);
        out.extend_from_slice(&self.stream.to_be_bytes());
        out.extend_from_slice(&self.payload);
        out
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, TunnelError> {
        if bytes.len() < 5 { return Err(TunnelError::new("preview_tunnel_protocol", "short frame")); }
        let kind = FrameType::from_u8(bytes[0]).ok_or_else(|| TunnelError::new("preview_tunnel_protocol", format!("unknown frame type {}", bytes[0])))?;
        let stream = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
        Ok(Self { kind, stream, payload: bytes[5..].to_vec() })
    }
    pub fn parse<T: for<'de> Deserialize<'de>>(&self) -> Result<T, TunnelError> {
        serde_json::from_slice(&self.payload).map_err(|e| TunnelError::new("preview_tunnel_protocol", format!("bad {:?} payload: {e}", self.kind)))
    }
}

pub type Headers = Vec<(String, String)>;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReqHead { pub method: String, pub path: String, pub headers: Headers }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ResHead { pub status: u16, pub headers: Headers }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WsOpen { pub path: String, #[serde(default)] pub headers: Headers, #[serde(default)] pub protocols: Vec<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct WsAccept { #[serde(default, skip_serializing_if = "Option::is_none")] pub protocol: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct WsClose { #[serde(default, skip_serializing_if = "Option::is_none")] pub code: Option<u16>, #[serde(default, skip_serializing_if = "Option::is_none")] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Reset { pub error: String, #[serde(default, skip_serializing_if = "Option::is_none")] pub detail: Option<String> }

/// Hop-by-hop headers are dropped in both directions.
pub fn is_hop_by_hop(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    matches!(n.as_str(), "connection" | "keep-alive" | "transfer-encoding" | "upgrade" | "te" | "trailer") || n.starts_with("proxy-")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role { Mac, Device }
impl Role {
    pub fn as_str(self) -> &'static str { match self { Role::Mac => "mac", Role::Device => "device" } }
    fn send_dir(self) -> &'static str { match self { Role::Mac => "m2d", Role::Device => "d2m" } }
    fn recv_dir(self) -> &'static str { match self { Role::Mac => "d2m", Role::Device => "m2d" } }
}

/// AES-256-GCM with AAD `freddai-tunnel-v1:<session>:<dir>:<seq>`; strict per-direction counters.
pub struct TunnelCipher { cipher: Aes256Gcm, session: String, role: Role, send_seq: u64, recv_seq: u64 }
impl TunnelCipher {
    pub fn new(device_key_hex: &str, session: &str, role: Role) -> Result<Self, TunnelError> {
        let cipher = crate::companion_crypto::cipher(device_key_hex).map_err(|e| TunnelError::new("preview_tunnel_crypto", e))?;
        Ok(Self { cipher, session: session.to_owned(), role, send_seq: 0, recv_seq: 0 })
    }
    fn aad(&self, dir: &str, seq: u64) -> String { format!("freddai-tunnel-v1:{}:{dir}:{seq}", self.session) }
    pub fn seal(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, TunnelError> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let aad = self.aad(self.role.send_dir(), self.send_seq);
        let ct = self.cipher.encrypt(&nonce, Payload { msg: plaintext, aad: aad.as_bytes() }).map_err(|_| TunnelError::new("preview_tunnel_crypto", "encrypt failed"))?;
        self.send_seq += 1;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ct);
        Ok(out)
    }
    /// Any tamper, replay, drop or reorder changes the expected seq and fails authentication.
    pub fn open(&mut self, message: &[u8]) -> Result<Vec<u8>, TunnelError> {
        if message.len() < 12 + 16 { return Err(TunnelError::new("preview_tunnel_auth", "short message")); }
        let aad = self.aad(self.role.recv_dir(), self.recv_seq);
        let pt = self.cipher.decrypt(Nonce::from_slice(&message[..12]), Payload { msg: &message[12..], aad: aad.as_bytes() })
            .map_err(|_| TunnelError::new("preview_tunnel_auth", format!("authentication or sequence check failed at seq {}", self.recv_seq)))?;
        self.recv_seq += 1;
        Ok(pt)
    }
}

#[derive(Clone)]
pub struct TunnelConfig {
    /// Relay origin, `https://host` (`http://127.0.0.1:port` accepted for loopback tests).
    pub relay: String,
    /// sha256(token) hex: the mailbox id used in the URL.
    pub mailbox: String,
    /// Bearer token (the device's mailbox secret). Never logged.
    pub token: String,
    pub session: String,
    /// Device key hex (never logged).
    pub key: String,
    pub role: Role,
}
fn is_hex64(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) }
impl TunnelConfig {
    pub fn url(&self) -> Result<String, TunnelError> {
        if !is_hex64(&self.session) || !is_hex64(&self.mailbox) { return Err(TunnelError::new("preview_tunnel_unavailable", "invalid session or mailbox id")); }
        let u = reqwest::Url::parse(self.relay.trim()).map_err(|_| TunnelError::new("preview_tunnel_unavailable", "invalid relay address"))?;
        let host = u.host_str().ok_or_else(|| TunnelError::new("preview_tunnel_unavailable", "invalid relay address"))?;
        let loopback = matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]");
        let scheme = match u.scheme() { "https" => "wss", "http" if loopback => "ws", _ => return Err(TunnelError::new("preview_tunnel_unavailable", "relay must be https")) };
        let authority = match u.port() { Some(p) => format!("{host}:{p}"), None => host.to_owned() };
        Ok(format!("{scheme}://{authority}/v1/tunnels/{}/{}?role={}", self.mailbox, self.session, self.role.as_str()))
    }
}

#[derive(Debug)]
pub enum TunnelEvent { Frame(Frame), Closed(TunnelError) }

/// Cheap, cloneable handle for sending frames. Frames are sealed in send order by the connection task.
#[derive(Clone)]
pub struct TunnelSender { tx: mpsc::Sender<Frame>, stop: Arc<Notify> }
impl TunnelSender {
    pub async fn send(&self, frame: Frame) -> Result<(), TunnelError> {
        if frame.payload.len() > MAX_FRAME_PLAINTEXT { return Err(TunnelError::new("preview_tunnel_protocol", "frame too large")); }
        self.tx.send(frame).await.map_err(|_| TunnelError::new("preview_tunnel_closed", "tunnel is closed"))
    }
    pub async fn send_json<T: Serialize>(&self, kind: FrameType, stream: u32, value: &T) -> Result<(), TunnelError> { self.send(Frame::json(kind, stream, value)).await }
    pub async fn send_req_head(&self, stream: u32, head: &ReqHead) -> Result<(), TunnelError> { self.send_json(FrameType::ReqHead, stream, head).await }
    pub async fn send_res_head(&self, stream: u32, head: &ResHead) -> Result<(), TunnelError> { self.send_json(FrameType::ResHead, stream, head).await }
    /// Splits into <= 256 KiB BODY frames.
    pub async fn send_body(&self, stream: u32, bytes: &[u8]) -> Result<(), TunnelError> {
        for chunk in bytes.chunks(MAX_BODY_CHUNK) { self.send(Frame::new(FrameType::Body, stream, chunk.to_vec())).await?; }
        Ok(())
    }
    pub async fn send_end(&self, stream: u32) -> Result<(), TunnelError> { self.send(Frame::new(FrameType::End, stream, vec![])).await }
    pub async fn send_ws_open(&self, stream: u32, open: &WsOpen) -> Result<(), TunnelError> { self.send_json(FrameType::WsOpen, stream, open).await }
    pub async fn send_ws_accept(&self, stream: u32, accept: &WsAccept) -> Result<(), TunnelError> { self.send_json(FrameType::WsAccept, stream, accept).await }
    pub async fn send_ws_text(&self, stream: u32, text: &str) -> Result<(), TunnelError> { self.send(Frame::new(FrameType::WsText, stream, text.as_bytes().to_vec())).await }
    pub async fn send_ws_binary(&self, stream: u32, bytes: &[u8]) -> Result<(), TunnelError> { self.send(Frame::new(FrameType::WsBinary, stream, bytes.to_vec())).await }
    pub async fn send_ws_close(&self, stream: u32, close: &WsClose) -> Result<(), TunnelError> { self.send_json(FrameType::WsClose, stream, close).await }
    pub async fn send_reset(&self, stream: u32, error: &str, detail: Option<String>) -> Result<(), TunnelError> {
        self.send_json(FrameType::Reset, stream, &Reset { error: error.to_owned(), detail }).await
    }
    /// Closes the relay socket; the receiver then yields `TunnelEvent::Closed`.
    pub fn close(&self) { self.stop.notify_one(); }
}

/// Device-side stream id allocator: odd numbers, incrementing.
#[derive(Default)]
pub struct StreamIds(u32);
impl StreamIds { pub fn next(&mut self) -> u32 { self.0 = self.0.wrapping_add(2); if self.0.is_multiple_of(2) { self.0 = 1; } self.0 } }

pub struct Tunnel { pub sender: TunnelSender, pub events: mpsc::Receiver<TunnelEvent> }

fn close_error(code: u16, reason: &str) -> TunnelError {
    let name = match code { 4408 => "preview_tunnel_peer_timeout", 4409 => "preview_tunnel_role_taken", 4400 => "preview_tunnel_protocol", 4413 => "preview_tunnel_too_large", _ => "preview_tunnel_closed" };
    TunnelError::new(name, format!("relay closed with code {code} {reason}").trim().to_owned())
}

/// Dials the relay as `cfg.role` and starts the connection task (seal/open, keepalive, forwarding).
pub async fn connect(cfg: &TunnelConfig) -> Result<Tunnel, TunnelError> {
    let url = cfg.url()?;
    let mut cipher = TunnelCipher::new(&cfg.key, &cfg.session, cfg.role)?;
    let mut request = url.as_str().into_client_request().map_err(|e| TunnelError::new("preview_tunnel_unavailable", e.to_string()))?;
    let mut auth = tungstenite::http::HeaderValue::from_str(&format!("Bearer {}", cfg.token)).map_err(|_| TunnelError::new("preview_tunnel_unavailable", "invalid token"))?;
    auth.set_sensitive(true);
    request.headers_mut().insert(tungstenite::http::header::AUTHORIZATION, auth);
    let config = WebSocketConfig::default().max_message_size(Some(MAX_MESSAGE)).max_frame_size(Some(MAX_MESSAGE));
    let (ws, _) = tokio::time::timeout(DIAL_TIMEOUT, tokio_tungstenite::connect_async_with_config(request, Some(config), false)).await
        .map_err(|_| TunnelError::new("preview_tunnel_unavailable", "relay dial timed out"))?
        .map_err(|e| TunnelError::new("preview_tunnel_unavailable", format!("relay dial failed: {}", redact(&e.to_string(), cfg))))?;
    let (out_tx, mut out_rx) = mpsc::channel::<Frame>(64);
    let (ev_tx, ev_rx) = mpsc::channel::<TunnelEvent>(256);
    let stop = Arc::new(Notify::new());
    let sender = TunnelSender { tx: out_tx, stop: stop.clone() };
    let pong_sender = sender.clone();
    tokio::spawn(async move {
        let (mut sink, mut stream) = ws.split();
        let mut ping = tokio::time::interval_at(Instant::now() + PING_INTERVAL, PING_INTERVAL);
        let mut last_in = Instant::now();
        let reason: TunnelError = loop {
            tokio::select! {
                frame = out_rx.recv() => {
                    let Some(frame) = frame else { break TunnelError::new("preview_tunnel_closed", "closed locally") };
                    match cipher.seal(&frame.encode()) {
                        Ok(bytes) => if let Err(e) = sink.send(Message::Binary(bytes.into())).await { break TunnelError::new("preview_tunnel_closed", format!("send failed: {e}")); },
                        Err(e) => break e,
                    }
                }
                _ = stop.notified() => break TunnelError::new("preview_tunnel_closed", "closed locally"),
                _ = ping.tick() => {
                    if last_in.elapsed() > IDLE_TIMEOUT { break TunnelError::new("preview_tunnel_timeout", "peer stopped responding"); }
                    let _ = pong_sender.tx.try_send(Frame::new(FrameType::Ping, 0, vec![]));
                }
                message = stream.next() => match message {
                    None => break TunnelError::new("preview_tunnel_closed", "relay closed"),
                    Some(Err(e)) => break TunnelError::new("preview_tunnel_closed", format!("relay error: {e}")),
                    Some(Ok(Message::Binary(bytes))) => {
                        last_in = Instant::now();
                        let frame = match cipher.open(&bytes).and_then(|p| Frame::decode(&p)) { Ok(f) => f, Err(e) => break e };
                        match frame.kind {
                            FrameType::Ping => { let _ = pong_sender.tx.try_send(Frame::new(FrameType::Pong, 0, vec![])); }
                            FrameType::Pong => {}
                            _ => if ev_tx.send(TunnelEvent::Frame(frame)).await.is_err() { break TunnelError::new("preview_tunnel_closed", "consumer gone"); },
                        }
                    }
                    Some(Ok(Message::Close(frame))) => break frame.map(|f| close_error(u16::from(f.code), &f.reason)).unwrap_or_else(|| TunnelError::new("preview_tunnel_closed", "relay closed")),
                    Some(Ok(Message::Text(_))) => break TunnelError::new("preview_tunnel_protocol", "unexpected text message"),
                    Some(Ok(_)) => {}
                }
            }
        };
        let _ = sink.close().await;
        let _ = ev_tx.send(TunnelEvent::Closed(reason)).await;
    });
    Ok(Tunnel { sender, events: ev_rx })
}
fn redact(text: &str, cfg: &TunnelConfig) -> String {
    text.replace(&cfg.token, "<token>").replace(&cfg.key, "<key>").replace(&cfg.mailbox, "<mailbox>").replace(&cfg.session, "<session>")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    fn key() -> String { crate::companion_crypto::random() }
    #[test]
    fn frames_roundtrip_and_reject_garbage() {
        for kind in [FrameType::ReqHead, FrameType::Body, FrameType::End, FrameType::ResHead, FrameType::WsOpen, FrameType::WsAccept, FrameType::WsText, FrameType::WsBinary, FrameType::WsClose, FrameType::Reset, FrameType::Ping, FrameType::Pong] {
            let f = Frame::new(kind, 0xDEADBEEF, vec![1, 2, 3]);
            let bytes = f.encode();
            assert_eq!(bytes[0], kind as u8);
            assert_eq!(&bytes[1..5], &0xDEADBEEFu32.to_be_bytes());
            assert_eq!(Frame::decode(&bytes).unwrap(), f);
        }
        assert_eq!(Frame::decode(&Frame::new(FrameType::End, 7, vec![]).encode()).unwrap().payload.len(), 0);
        assert!(Frame::decode(&[1, 0, 0]).is_err());
        assert!(Frame::decode(&[99, 0, 0, 0, 1]).is_err());
        let head = ReqHead { method: "GET".into(), path: "/a?b=1".into(), headers: vec![("accept".into(), "*/*".into())] };
        assert_eq!(Frame::json(FrameType::ReqHead, 1, &head).parse::<ReqHead>().unwrap(), head);
    }
    #[test]
    fn stream_ids_are_odd_and_increasing() {
        let mut ids = StreamIds::default();
        assert_eq!((ids.next(), ids.next(), ids.next()), (1, 3, 5));
    }
    #[test]
    fn cipher_roundtrips_in_order_and_rejects_seq_mismatch_tamper_and_wrong_direction() {
        let (k, s) = (key(), crate::companion_crypto::random());
        let mut mac = TunnelCipher::new(&k, &s, Role::Mac).unwrap();
        let mut dev = TunnelCipher::new(&k, &s, Role::Device).unwrap();
        let (m0, m1, m2) = (mac.seal(b"zero").unwrap(), mac.seal(b"one").unwrap(), mac.seal(b"two").unwrap());
        assert_eq!(dev.open(&m0).unwrap(), b"zero");
        // Skipped message: m2 arrives while seq 1 is expected.
        assert_eq!(dev.open(&m2).unwrap_err().code, "preview_tunnel_auth");
        // A failed open does not advance; the in-order message still works, then replay fails.
        assert_eq!(dev.open(&m1).unwrap(), b"one");
        assert!(dev.open(&m1).is_err());
        assert_eq!(dev.open(&m2).unwrap(), b"two");
        // Tamper.
        let mut mac = TunnelCipher::new(&k, &s, Role::Mac).unwrap();
        let mut dev = TunnelCipher::new(&k, &s, Role::Device).unwrap();
        let mut bad = mac.seal(b"payload").unwrap();
        *bad.last_mut().unwrap() ^= 1;
        assert!(dev.open(&bad).is_err());
        // Reflection (own direction), wrong session, wrong key.
        let mut mac = TunnelCipher::new(&k, &s, Role::Mac).unwrap();
        let mut mac2 = TunnelCipher::new(&k, &s, Role::Mac).unwrap();
        assert!(mac2.open(&mac.seal(b"x").unwrap()).is_err());
        let mut other_session = TunnelCipher::new(&k, &crate::companion_crypto::random(), Role::Device).unwrap();
        assert!(other_session.open(&TunnelCipher::new(&k, &s, Role::Mac).unwrap().seal(b"x").unwrap()).is_err());
        let mut other_key = TunnelCipher::new(&key(), &s, Role::Device).unwrap();
        assert!(other_key.open(&TunnelCipher::new(&k, &s, Role::Mac).unwrap().seal(b"x").unwrap()).is_err());
        assert!(TunnelCipher::new("nothex", &s, Role::Mac).is_err());
    }
    #[test]
    fn urls_validate_ids_and_scheme() {
        let mut cfg = TunnelConfig { relay: "https://relay.example.com".into(), mailbox: crate::companion_crypto::random(), token: "t".into(), session: crate::companion_crypto::random(), key: key(), role: Role::Mac };
        assert_eq!(cfg.url().unwrap(), format!("wss://relay.example.com/v1/tunnels/{}/{}?role=mac", cfg.mailbox, cfg.session));
        cfg.relay = "http://example.com".into();
        assert!(cfg.url().is_err());
        cfg.relay = "http://127.0.0.1:9".into();
        assert!(cfg.url().unwrap().starts_with("ws://127.0.0.1:9/"));
        cfg.session = "../x".into();
        assert!(cfg.url().is_err());
    }
    #[test]
    fn hop_by_hop_headers() {
        for h in ["Connection", "keep-alive", "Transfer-Encoding", "Upgrade", "Proxy-Authorization", "TE", "Trailer"] { assert!(is_hop_by_hop(h), "{h}"); }
        for h in ["content-type", "cookie", "host"] { assert!(!is_hop_by_hop(h), "{h}"); }
    }
}
