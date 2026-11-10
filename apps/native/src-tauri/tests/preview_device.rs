//! Device-side preview loopback server end to end: browser -> loopback proxy -> encrypted tunnel
//! over a fake relay -> Mac executor (`preview_host::serve`) -> local test servers.
//! Source files are included directly (like tests/preview_tunnel.rs) so the Tauri app is not linked.
#[path = "../src/companion_crypto.rs"]
mod companion_crypto;
#[allow(dead_code)]
#[path = "../src/preview_tunnel.rs"]
mod preview_tunnel;
#[allow(dead_code)]
#[path = "../src/preview_host.rs"]
mod preview_host;
#[allow(dead_code)]
#[path = "../src/preview_device/proxy.rs"]
mod proxy;
#[path = "../src/preview_device/url.rs"]
mod url;

use futures_util::{SinkExt, StreamExt};
use preview_tunnel::{connect, Role, TunnelConfig, TunnelEvent};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::{Arc, Mutex}, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::{TcpListener, TcpStream}};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, handshake::server::{Request, Response}, Message};

type Ws = tokio_tungstenite::WebSocketStream<TcpStream>;
async fn fake_relay() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let waiting: Arc<Mutex<HashMap<String, (String, Ws)>>> = Default::default();
    tokio::spawn(async move {
        loop {
            let (sock, _) = listener.accept().await.unwrap();
            let waiting = waiting.clone();
            tokio::spawn(async move {
                let mut uri = String::new();
                let ws = tokio_tungstenite::accept_hdr_async(sock, |req: &Request, resp: Response| { uri = req.uri().to_string(); Ok(resp) }).await.unwrap();
                let (path, query) = uri.split_once('?').unwrap();
                let role = query.strip_prefix("role=").unwrap().to_owned();
                let peer = waiting.lock().unwrap().remove(path);
                match peer {
                    None => { waiting.lock().unwrap().insert(path.to_owned(), (role, ws)); }
                    Some((_, peer_ws)) => {
                        let (mut a_tx, mut a_rx) = ws.split();
                        let (mut b_tx, mut b_rx) = peer_ws.split();
                        tokio::spawn(async move { while let Some(Ok(m)) = a_rx.next().await { if m.is_close() || b_tx.send(m).await.is_err() { break; } } let _ = b_tx.close().await; });
                        tokio::spawn(async move { while let Some(Ok(m)) = b_rx.next().await { if m.is_close() || a_tx.send(m).await.is_err() { break; } } let _ = a_tx.close().await; });
                    }
                }
            });
        }
    });
    port
}

/// Minimal HTTP server: POST /echo echoes the body, GET /big returns 700 kB, anything else describes the request.
async fn http_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (mut s, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut tmp = [0u8; 8192];
                let head_end = loop {
                    let n = s.read(&mut tmp).await.unwrap();
                    if n == 0 { return; }
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") { break i + 4; }
                };
                let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                let lower = head.to_ascii_lowercase();
                let len: usize = lower.lines().find_map(|l| l.strip_prefix("content-length: ")).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
                while buf.len() < head_end + len { let n = s.read(&mut tmp).await.unwrap(); if n == 0 { break; } buf.extend_from_slice(&tmp[..n]); }
                let first = head.lines().next().unwrap().to_owned();
                let body: Vec<u8> = if first.starts_with("POST /echo") { buf[head_end..head_end + len].to_vec() }
                    else if first.starts_with("GET /big") { big() } else { format!("{first}|host={}", lower.lines().find_map(|l| l.strip_prefix("host: ")).unwrap_or("")).into_bytes() };
                s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Test: yes\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
                s.write_all(&body).await.unwrap();
                let _ = s.shutdown().await;
            });
        }
    });
    port
}
fn big() -> Vec<u8> { (0..700_000u32).map(|i| (i % 251) as u8).collect() }
async fn ws_echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (s, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(s, |req: &Request, mut resp: Response| {
                    if req.headers().get("sec-websocket-protocol").is_some() { resp.headers_mut().insert("sec-websocket-protocol", "chat".parse().unwrap()); }
                    Ok(resp)
                }).await else { return };
                while let Some(Ok(m)) = ws.next().await { if m.is_text() || m.is_binary() { if ws.send(m).await.is_err() { break; } } else if m.is_close() { break; } }
            });
        }
    });
    port
}

struct Fixture { local: u16, mac: preview_tunnel::TunnelSender, statuses: Arc<Mutex<Vec<(String, bool)>>>, closed: Arc<Mutex<Option<String>>>, proxy: proxy::Proxy }
/// Mac executor serving `upstream`, device-side proxy on a loopback port, joined by a fake relay.
async fn fixture(upstream: u16) -> Fixture {
    let relay = fake_relay().await;
    let (key, token, session) = (companion_crypto::random(), companion_crypto::random(), companion_crypto::random());
    let mailbox = hex::encode(Sha256::digest(token.as_bytes()));
    let cfg = |role| TunnelConfig { relay: format!("http://127.0.0.1:{relay}"), mailbox: mailbox.clone(), token: token.clone(), session: session.clone(), key: key.clone(), role };
    let (mc, dc) = (cfg(Role::Mac), cfg(Role::Device));
    let (mac, device) = tokio::join!(connect(&mc), connect(&dc));
    let mac = mac.unwrap();
    let mac_sender = mac.sender.clone();
    tokio::spawn(preview_host::serve(mac, upstream));
    let statuses: Arc<Mutex<Vec<(String, bool)>>> = Default::default();
    let closed: Arc<Mutex<Option<String>>> = Default::default();
    let (s2, c2) = (statuses.clone(), closed.clone());
    let proxy = proxy::start(device.unwrap(), Arc::new(move |m: &str, e: bool| s2.lock().unwrap().push((m.to_owned(), e))), Box::new(move |e| *c2.lock().unwrap() = Some(e.code.to_owned()))).await.unwrap();
    Fixture { local: proxy.port, mac: mac_sender, statuses, closed, proxy }
}

/// One-shot HTTP/1.1 client; returns (status, headers text, body).
async fn fetch(port: u16, method: &str, path: &str, body: &[u8]) -> (u16, String, Vec<u8>) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    s.write_all(format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
    s.write_all(body).await.unwrap();
    let mut raw = Vec::new();
    tokio::time::timeout(Duration::from_secs(15), s.read_to_end(&mut raw)).await.expect("timed out").unwrap();
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("no head") + 4;
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let status = head.split(' ').nth(1).unwrap().parse().unwrap();
    let body = raw[split..].to_vec();
    // Decode chunked bodies (hyper uses it when the response has no content-length).
    let body = if head.to_ascii_lowercase().contains("transfer-encoding: chunked") { dechunk(&body) } else { body };
    (status, head, body)
}
fn dechunk(mut b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let i = b.windows(2).position(|w| w == b"\r\n").unwrap();
        let n = usize::from_str_radix(std::str::from_utf8(&b[..i]).unwrap().trim(), 16).unwrap();
        if n == 0 { return out; }
        out.extend_from_slice(&b[i + 2..i + 2 + n]);
        b = &b[i + 2 + n + 2..];
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn http_get_and_streamed_bodies_roundtrip() {
    let upstream = http_server().await;
    let f = fixture(upstream).await;
    let (status, head, body) = fetch(f.local, "GET", "/hello?x=1", b"").await;
    assert_eq!(status, 200);
    let text = String::from_utf8(body).unwrap();
    assert!(text.contains("GET /hello?x=1 HTTP/1.1") && text.contains(&format!("host=localhost:{upstream}")), "{text}");
    assert!(head.to_ascii_lowercase().contains("x-test: yes"), "{head}");
    // 700 kB response spans several BODY frames.
    let (status, _, body) = fetch(f.local, "GET", "/big", b"").await;
    assert_eq!((status, body), (200, big()));
    // 600 kB upload echoed back: streamed request and response bodies.
    let payload: Vec<u8> = (0..600_000u32).map(|i| (i % 241) as u8).collect();
    let (status, _, body) = fetch(f.local, "POST", "/echo", &payload).await;
    assert_eq!(status, 200);
    assert_eq!(body, payload);
    // Foreign Host headers (DNS rebinding) are refused locally.
    let mut s = TcpStream::connect(("127.0.0.1", f.local)).await.unwrap();
    s.write_all(b"GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n").await.unwrap();
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).await.unwrap();
    assert!(String::from_utf8_lossy(&raw).starts_with("HTTP/1.1 403"));
    assert!(f.statuses.lock().unwrap().is_empty(), "no failure was reported");
    f.proxy.shutdown();
}

#[tokio::test(flavor = "multi_thread")]
async fn reset_becomes_502_with_the_named_error_and_a_status_line() {
    let dead = { let l = TcpListener::bind("127.0.0.1:0").await.unwrap(); l.local_addr().unwrap().port() };
    let f = fixture(dead).await;
    let (status, head, body) = fetch(f.local, "GET", "/", b"").await;
    assert_eq!(status, 502, "{head}");
    let text = String::from_utf8(body).unwrap();
    assert!(text.contains("Preview tunnel failed") && text.contains("preview_port_unreachable"), "{text}");
    let statuses = f.statuses.lock().unwrap().clone();
    assert!(statuses.iter().any(|(m, e)| *e && m.contains("preview_port_unreachable")), "{statuses:?}");
    f.proxy.shutdown();
}

#[tokio::test(flavor = "multi_thread")]
async fn websocket_echo_with_subprotocol_through_the_loopback_server() {
    let upstream = ws_echo_server().await;
    let f = fixture(upstream).await;
    let mut request = format!("ws://127.0.0.1:{}/socket", f.local).into_client_request().unwrap();
    request.headers_mut().insert("sec-websocket-protocol", "chat, other".parse().unwrap());
    let (mut ws, response) = tokio_tungstenite::connect_async(request).await.unwrap();
    assert_eq!(response.headers().get("sec-websocket-protocol").unwrap(), "chat");
    ws.send(Message::text("hello")).await.unwrap();
    assert_eq!(ws.next().await.unwrap().unwrap(), Message::text("hello"));
    ws.send(Message::binary(vec![1u8, 2, 3, 255])).await.unwrap();
    assert_eq!(ws.next().await.unwrap().unwrap(), Message::binary(vec![1u8, 2, 3, 255]));
    ws.close(None).await.unwrap();
    // A second socket is independent.
    let (mut ws2, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{}/other", f.local)).await.unwrap();
    ws2.send(Message::text("again")).await.unwrap();
    assert_eq!(ws2.next().await.unwrap().unwrap(), Message::text("again"));
    f.proxy.shutdown();
}

#[tokio::test(flavor = "multi_thread")]
async fn tunnel_close_fails_streams_and_notifies() {
    let upstream = http_server().await;
    let f = fixture(upstream).await;
    assert_eq!(fetch(f.local, "GET", "/a", b"").await.0, 200);
    f.mac.close();
    for _ in 0..100 { if f.closed.lock().unwrap().is_some() { break; } tokio::time::sleep(Duration::from_millis(50)).await; }
    assert!(f.closed.lock().unwrap().is_some(), "on_closed must run");
    let (status, _, body) = fetch(f.local, "GET", "/b", b"").await;
    assert_eq!(status, 502);
    assert!(String::from_utf8(body).unwrap().contains("preview_tunnel"));
    let statuses = f.statuses.lock().unwrap().clone();
    assert!(statuses.iter().any(|(m, e)| *e && m.contains("Preview tunnel closed")), "{statuses:?}");
    let _ = TunnelEvent::Closed; // keep the import honest across feature changes
    f.proxy.shutdown();
}
