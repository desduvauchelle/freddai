use super::*;
use crate::companion_crypto::random;
use crate::preview_tunnel::{connect, Frame, Reset, StreamIds};
use std::sync::Arc;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::{TcpListener, TcpStream as TokioTcp}};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

#[test]
fn grant_rules() {
    let mut g = Grants::default();
    let now = 1_000_000;
    assert!(g.grant(80, "t", now).is_err());
    assert!(g.grant(1023, "t", now).is_err());
    assert!(g.grant(COMPANION_PORT, "t", now).is_err());
    g.reserve(50123);
    assert!(g.grant(50123, "t", now).is_err());
    assert!(g.grant(3000, "mcp", now).is_ok());
    assert!(g.is_granted(3000, now + GRANT_TTL_SECS - 1));
    assert!(!g.is_granted(3000, now + GRANT_TTL_SECS), "expired after 12 h");
    assert!(!g.is_granted(3001, now));
    assert!(authorize_at(&g, 80, Some("http://localhost:80"), now).is_err(), "low port never authorized, even if mentioned");
    assert!(authorize_at(&g, COMPANION_PORT, Some("http://localhost:49744/"), now).is_err());
    assert!(authorize_at(&g, 3001, None, now).is_err());
    assert!(authorize_at(&g, 3001, Some("open http://localhost:3001/app"), now).is_ok());
    assert!(authorize_at(&g, 3000, None, now + GRANT_TTL_SECS + 1).is_err());
}

#[test]
fn thread_url_matching() {
    assert!(mentions_port("see http://localhost:3000", 3000));
    assert!(mentions_port("see http://127.0.0.1:3000/", 3000));
    assert!(mentions_port("see http://127.0.0.1:3000/a/b?x=1#h", 3000));
    assert!(mentions_port("HTTP://LOCALHOST:3000/x", 3000));
    assert!(mentions_port(r#"{"text":"run at localhost:5173."}"#, 5173));
    assert!(!mentions_port("http://localhost:30000", 3000), "longer port");
    assert!(!mentions_port("http://localhost:300", 3000));
    assert!(!mentions_port("http://mylocalhost:3000", 3000));
    assert!(!mentions_port("http://example.com:3000", 3000));
    assert!(!mentions_port("http://192.168.1.2:3000", 3000));
}

#[test]
fn headers_are_rewritten_and_hop_by_hop_dropped() {
    let h: Headers = vec![("Host".into(), "127.0.0.1:9".into()), ("Connection".into(), "keep-alive".into()), ("Upgrade".into(), "websocket".into()),
        ("Origin".into(), "http://127.0.0.1:9".into()), ("Referer".into(), "http://127.0.0.1:9/a/b?q=1".into()), ("Proxy-Authorization".into(), "x".into()),
        ("Accept".into(), "*/*".into())];
    let out = rewrite_request_headers(&h, 3000, &[]);
    assert!(out.contains(&("host".into(), "localhost:3000".into())));
    assert!(out.contains(&("origin".into(), "http://localhost:3000".into())));
    assert!(out.contains(&("referer".into(), "http://localhost:3000/a/b?q=1".into())));
    assert!(out.contains(&("accept".into(), "*/*".into())));
    assert_eq!(out.iter().filter(|(k, _)| k == "host").count(), 1);
    for dropped in ["connection", "upgrade", "proxy-authorization"] { assert!(!out.iter().any(|(k, _)| k == dropped), "{dropped}"); }
    assert!(target("http", 3000, "//evil.com/x").is_err());
    assert!(target("http", 3000, "@evil.com").is_err());
    assert!(target("http", 3000, "/ok?a=b").is_ok());
}

// ---- fake relay: pairs a mac and a device socket per (mailbox, session) and forwards binary messages.
type Ws = tokio_tungstenite::WebSocketStream<TokioTcp>;
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
                let mut bearer = false;
                let ws = tokio_tungstenite::accept_hdr_async(sock, |req: &Request, resp: Response| {
                    uri = req.uri().to_string();
                    bearer = req.headers().get("authorization").and_then(|v| v.to_str().ok()).is_some_and(|v| v.starts_with("Bearer "));
                    Ok(resp)
                }).await.unwrap();
                assert!(bearer, "tunnel dial must carry a Bearer token");
                let (path, query) = uri.split_once('?').unwrap();
                let role = query.strip_prefix("role=").unwrap().to_owned();
                let peer = waiting.lock().unwrap().remove(path);
                match peer {
                    None => { waiting.lock().unwrap().insert(path.to_owned(), (role, ws)); }
                    Some((peer_role, peer_ws)) => {
                        assert_ne!(peer_role, role);
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

// ---- local servers
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
                let header = |name: &str| lower.lines().find_map(|l| l.strip_prefix(&format!("{name}: "))).map(str::to_owned);
                let len: usize = header("content-length").and_then(|v| v.trim().parse().ok()).unwrap_or(0);
                while buf.len() < head_end + len { let n = s.read(&mut tmp).await.unwrap(); if n == 0 { break; } buf.extend_from_slice(&tmp[..n]); }
                let first = head.lines().next().unwrap().to_owned();
                let body: Vec<u8> = if first.starts_with("POST /echo") { buf[head_end..head_end + len].to_vec() } else {
                    format!("{first}|host={}|origin={}|redirect=no", header("host").unwrap_or_default(), header("origin").unwrap_or_default()).into_bytes()
                };
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Test: yes\r\nConnection: close\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\n\r\n", body.len());
                s.write_all(resp.as_bytes()).await.unwrap();
                s.write_all(&body).await.unwrap();
                let _ = s.shutdown().await;
            });
        }
    });
    port
}
async fn ws_echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (s, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(s, |req: &Request, mut resp: Response| {
                    assert_eq!(req.headers().get("host").unwrap(), &format!("localhost:{}", req.headers().get("x-expect-port").map(|v| v.to_str().unwrap().to_owned()).unwrap_or_default()));
                    if req.headers().get("sec-websocket-protocol").is_some() { resp.headers_mut().insert("sec-websocket-protocol", "chat".parse().unwrap()); }
                    Ok(resp)
                }).await else { return };
                while let Some(Ok(m)) = ws.next().await { if m.is_text() || m.is_binary() { if ws.send(m).await.is_err() { break; } } else if m.is_close() { break; } }
            });
        }
    });
    port
}

/// Connects a mac tunnel serving `port` and a device-side harness through a fake relay.
async fn harness(port: u16) -> (TunnelSender, mpsc::Receiver<TunnelEvent>) {
    let relay = fake_relay().await;
    let (key, token, session) = (random(), random(), random());
    let mailbox = hex::encode(Sha256::digest(token.as_bytes()));
    let cfg = |role| TunnelConfig { relay: format!("http://127.0.0.1:{relay}"), mailbox: mailbox.clone(), token: token.clone(), session: session.clone(), key: key.clone(), role };
    let (mc, dc) = (cfg(Role::Mac), cfg(Role::Device));
    let (mac, device) = tokio::join!(connect(&mc), connect(&dc));
    tokio::spawn(serve(mac.unwrap(), port));
    let device = device.unwrap();
    (device.sender, device.events)
}
async fn next(events: &mut mpsc::Receiver<TunnelEvent>) -> Frame {
    match tokio::time::timeout(Duration::from_secs(10), events.recv()).await.expect("timed out").expect("closed") { TunnelEvent::Frame(f) => f, TunnelEvent::Closed(e) => panic!("tunnel closed: {e}") }
}
async fn collect_response(events: &mut mpsc::Receiver<TunnelEvent>, id: u32) -> (ResHead, Vec<u8>, usize) {
    let head = next(events).await;
    assert_eq!((head.kind, head.stream), (FrameType::ResHead, id), "expected RES_HEAD, got {head:?}");
    let (mut body, mut frames) = (Vec::new(), 0);
    loop {
        let f = next(events).await;
        assert_eq!(f.stream, id);
        match f.kind { FrameType::Body => { assert!(f.payload.len() <= tunnel::MAX_BODY_CHUNK); frames += 1; body.extend(f.payload) } FrameType::End => break, k => panic!("unexpected {k:?}") }
    }
    (head.parse().unwrap(), body, frames)
}

#[test]
fn http_roundtrip_streams_bodies_and_rewrites_headers() {
    runtime().block_on(async {
        let port = http_server().await;
        let (tx, mut rx) = harness(port).await;
        let mut ids = StreamIds::default();
        let id = ids.next();
        tx.send_req_head(id, &ReqHead { method: "GET".into(), path: "/hello?x=1".into(), headers: vec![("host".into(), "127.0.0.1:55555".into()), ("origin".into(), "http://127.0.0.1:55555".into()), ("connection".into(), "keep-alive".into())] }).await.unwrap();
        tx.send_end(id).await.unwrap();
        let (head, body, _) = collect_response(&mut rx, id).await;
        assert_eq!(head.status, 200);
        let text = String::from_utf8(body).unwrap();
        assert!(text.contains("GET /hello?x=1 HTTP/1.1"), "{text}");
        assert!(text.contains(&format!("host=localhost:{port}")), "{text}");
        assert!(text.contains(&format!("origin=http://localhost:{port}")), "{text}");
        assert!(head.headers.iter().any(|(k, v)| k == "x-test" && v == "yes"));
        assert_eq!(head.headers.iter().filter(|(k, _)| k == "set-cookie").count(), 2, "repeated headers survive");
        assert!(!head.headers.iter().any(|(k, _)| k == "connection"), "hop-by-hop dropped");

        // 600 kB upload echoed back: exercises multi-frame request and response bodies.
        let payload: Vec<u8> = (0..600_000u32).map(|i| (i % 251) as u8).collect();
        let id = ids.next();
        tx.send_req_head(id, &ReqHead { method: "POST".into(), path: "/echo".into(), headers: vec![("content-length".into(), payload.len().to_string())] }).await.unwrap();
        tx.send_body(id, &payload).await.unwrap();
        tx.send_end(id).await.unwrap();
        let (head, body, frames) = collect_response(&mut rx, id).await;
        assert_eq!(head.status, 200);
        assert_eq!(body, payload);
        assert!(frames >= 3, "{frames} body frames");
    });
}

#[test]
fn websocket_roundtrip_with_subprotocol() {
    runtime().block_on(async {
        let port = ws_echo_server().await;
        let (tx, mut rx) = harness(port).await;
        // The echo server asserts Host == localhost:<x-expect-port>; send the expected port as a header.
        tx.send_ws_open(1, &WsOpen { path: "/socket".into(), headers: vec![("host".into(), "10.0.0.5:1".into()), ("x-expect-port".into(), port.to_string()), ("origin".into(), "http://127.0.0.1:1".into())], protocols: vec!["chat".into(), "other".into()] }).await.unwrap();
        let accept = next(&mut rx).await;
        assert_eq!(accept.kind, FrameType::WsAccept);
        assert_eq!(accept.parse::<WsAccept>().unwrap().protocol.as_deref(), Some("chat"));
        tx.send_ws_text(1, "hello").await.unwrap();
        let f = next(&mut rx).await;
        assert_eq!((f.kind, f.payload.as_slice()), (FrameType::WsText, &b"hello"[..]));
        tx.send_ws_binary(1, &[1, 2, 3, 255]).await.unwrap();
        let f = next(&mut rx).await;
        assert_eq!((f.kind, f.payload.as_slice()), (FrameType::WsBinary, &[1u8, 2, 3, 255][..]));
        tx.send_ws_close(1, &WsClose { code: Some(1000), reason: Some("bye".into()) }).await.unwrap();
        // A second socket on the same tunnel works independently.
        tx.send_ws_open(3, &WsOpen { path: "/socket".into(), headers: vec![("x-expect-port".into(), port.to_string())], protocols: vec![] }).await.unwrap();
        loop { let f = next(&mut rx).await; if f.stream == 3 { assert_eq!(f.kind, FrameType::WsAccept); break; } }
    });
}

#[test]
fn refused_connections_reset_with_named_error() {
    runtime().block_on(async {
        let dead = { let l = TcpListener::bind("127.0.0.1:0").await.unwrap(); l.local_addr().unwrap().port() };
        let (tx, mut rx) = harness(dead).await;
        tx.send_req_head(1, &ReqHead { method: "GET".into(), path: "/".into(), headers: vec![] }).await.unwrap();
        tx.send_end(1).await.unwrap();
        let f = next(&mut rx).await;
        assert_eq!((f.kind, f.stream), (FrameType::Reset, 1));
        assert_eq!(f.parse::<Reset>().unwrap().error, "preview_port_unreachable");
        tx.send_ws_open(3, &WsOpen { path: "/".into(), headers: vec![], protocols: vec![] }).await.unwrap();
        let f = next(&mut rx).await;
        assert_eq!((f.kind, f.stream), (FrameType::Reset, 3));
        assert_eq!(f.parse::<Reset>().unwrap().error, "preview_port_unreachable");
        // Even stream ids are a protocol error for that stream, not the tunnel.
        tx.send_req_head(2, &ReqHead { method: "GET".into(), path: "/".into(), headers: vec![] }).await.unwrap();
        let f = next(&mut rx).await;
        assert_eq!((f.stream, f.parse::<Reset>().unwrap().error.as_str()), (2, "preview_tunnel_protocol"));
    });
}

#[test]
fn open_enforces_grants_reachability_and_relay_then_serves() {
    let auth = |relay| RelayAuth { relay, token: "tok", key: "00" };
    // Rules fail before anything else.
    assert!(open(&auth(None), 80, "/", Some("http://localhost:80")).unwrap_err().starts_with("preview_not_granted"));
    assert!(open(&auth(None), COMPANION_PORT as u64, "/", Some("http://localhost:49744")).unwrap_err().starts_with("preview_not_granted"));
    assert!(open(&auth(None), 70_000, "/", None).unwrap_err().starts_with("preview_not_granted"));
    let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    assert!(open(&auth(None), dead as u64, "/", Some(&format!("see http://localhost:{dead}"))).unwrap_err().starts_with("preview_port_unreachable"));
    let live = runtime().block_on(http_server());
    assert!(open(&auth(None), live as u64, "/", None).unwrap_err().starts_with("preview_not_granted"), "no share and no thread URL");
    assert!(open(&auth(None), live as u64, "/", Some(&format!("run http://127.0.0.1:{live}/x"))).unwrap_err().starts_with("preview_tunnel_unavailable"), "no relay configured");
    assert!(open(&auth(Some("http://127.0.0.1:1")), live as u64, "/", Some(&format!("http://localhost:{live}"))).unwrap_err().starts_with("preview_tunnel_unavailable"), "dial refused");
    assert!(open(&auth(None), live as u64, "bad", Some(&format!("http://localhost:{live}"))).unwrap_err().starts_with("preview_invalid_request"));
    // Success path through a fake relay with an explicit share (the real token/key shapes).
    grant_port(live, "test").unwrap();
    let relay = runtime().block_on(fake_relay());
    let (token, key) = (random(), random());
    let url = format!("http://127.0.0.1:{relay}");
    let result = open(&RelayAuth { relay: Some(&url), token: &token, key: &key }, live as u64, "/", None).unwrap();
    assert_eq!(result["port"], live);
    let session = result["session"].as_str().unwrap().to_owned();
    assert_eq!(session.len(), 64);
    runtime().block_on(async {
        let cfg = TunnelConfig { relay: url.clone(), mailbox: hex::encode(Sha256::digest(token.as_bytes())), token: token.clone(), session, key, role: Role::Device };
        let mut dev = connect(&cfg).await.unwrap();
        dev.sender.send_req_head(1, &ReqHead { method: "GET".into(), path: "/p".into(), headers: vec![] }).await.unwrap();
        dev.sender.send_end(1).await.unwrap();
        let (head, body, _) = collect_response(&mut dev.events, 1).await;
        assert_eq!(head.status, 200);
        assert!(String::from_utf8(body).unwrap().contains("GET /p"));
    });
}

#[cfg(test)]
mod url_tests {
    use super::super::parse_localhost_url as parse_url;
    #[test]
    fn accepts_loopback_urls() {
        assert_eq!(parse_url("http://localhost:3000"), Ok((3000, "/".into())));
        assert_eq!(parse_url("http://127.0.0.1:5173/app/x?a=1&b=2"), Ok((5173, "/app/x?a=1&b=2".into())));
        assert_eq!(parse_url("https://localhost:8443/p#frag"), Ok((8443, "/p".into())));
        assert_eq!(parse_url("  HTTP://LOCALHOST:3000/A "), Ok((3000, "/A".into())));
        assert_eq!(parse_url("http://localhost:3000?x=1"), Ok((3000, "/?x=1".into())));
    }
    #[test]
    fn rejects_everything_else() {
        for bad in ["", "localhost:3000", "ftp://localhost:3000", "http://localhost", "http://localhost:0", "http://example.com:3000", "http://192.168.1.2:3000",
            "http://user@localhost:3000", "http://localhost:3000@evil.com", "http://mylocalhost:3000", "http://localhost:99999", "http://[::1]:3000", "http://localhost:3000/a b", "javascript:alert(1)", "http://0.0.0.0:3000"] {
            assert_eq!(parse_url(bad), Err("preview_invalid_url"), "{bad:?}");
        }
    }
}
