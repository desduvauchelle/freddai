//! Device-side loopback server for the companion preview tunnel (docs/preview-tunnel.md).
//! Listens on 127.0.0.1:<random>, multiplexes every HTTP request / WebSocket the native web view
//! makes onto the encrypted tunnel, and fails loudly (visible 502 page + status callback + log).
//! No Tauri dependency, so it is testable on the host.
use crate::preview_tunnel::{self as tunnel, Frame, FrameType, ReqHead, ResHead, Reset, StreamIds, Tunnel, TunnelError, TunnelEvent, TunnelSender, WsAccept, WsClose, WsOpen};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use hyper::{body::{Body, Frame as BodyFrame, Incoming}, header, service::service_fn, HeaderMap, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::{collections::HashMap, convert::Infallible, io, pin::Pin, sync::{Arc, Mutex}, task::{Context, Poll}};
use tokio::{net::TcpListener, sync::{mpsc, watch}};
use tokio_tungstenite::{tungstenite::{handshake::derive_accept_key, protocol::{frame::coding::CloseCode, CloseFrame, Role as WsRole}, Message}, WebSocketStream};

/// Called with `(message, is_error)` whenever the preview should show a status line.
pub type StatusFn = Arc<dyn Fn(&str, bool) + Send + Sync>;
/// Called once if the tunnel closes on its own (not on `Proxy::shutdown`).
pub type ClosedFn = Box<dyn FnOnce(&TunnelError) + Send>;

#[derive(Default)]
struct Inner { ids: StreamIds, streams: HashMap<u32, mpsc::UnboundedSender<Frame>>, closed: Option<TunnelError> }
struct Shared { sender: TunnelSender, inner: Mutex<Inner>, status: StatusFn }

/// One in-flight tunnel stream. Dropping it unregisters the stream and, unless it finished
/// cleanly, tells the Mac to abort it.
struct StreamGuard { shared: Arc<Shared>, id: u32, rx: mpsc::UnboundedReceiver<Frame>, finished: bool, pump: Option<tokio::task::AbortHandle> }
impl Drop for StreamGuard {
    fn drop(&mut self) {
        if let Some(p) = self.pump.take() { p.abort(); }
        let closed = {
            let mut i = self.shared.inner.lock().unwrap_or_else(|e| e.into_inner());
            i.streams.remove(&self.id);
            i.closed.is_some()
        };
        if !self.finished && !closed {
            if let Ok(h) = tokio::runtime::Handle::try_current() {
                let (s, id) = (self.shared.sender.clone(), self.id);
                h.spawn(async move { let _ = s.send_reset(id, "preview_client_aborted", None).await; });
            }
        }
    }
}
impl Shared {
    fn open_stream(self: &Arc<Self>) -> Result<StreamGuard, TunnelError> {
        let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(e) = &i.closed { return Err(e.clone()); }
        let id = i.ids.next();
        let (tx, rx) = mpsc::unbounded_channel();
        i.streams.insert(id, tx);
        Ok(StreamGuard { shared: self.clone(), id, rx, finished: false, pump: None })
    }
    fn closed_error(&self) -> TunnelError {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).closed.clone().unwrap_or_else(|| TunnelError::new("preview_tunnel_closed", "tunnel is closed"))
    }
}

// ---------------------------------------------------------------- bodies

enum ResBody { Full(Option<Bytes>), Stream(StreamGuard) }
impl Body for ResBody {
    type Data = Bytes;
    type Error = io::Error;
    fn poll_frame(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Result<BodyFrame<Bytes>, io::Error>>> {
        match &mut *self {
            ResBody::Full(b) => Poll::Ready(b.take().map(|b| Ok(BodyFrame::data(b)))),
            ResBody::Stream(g) => loop {
                match g.rx.poll_recv(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Some(f)) => match f.kind {
                        FrameType::Body => return Poll::Ready(Some(Ok(BodyFrame::data(Bytes::from(f.payload))))),
                        FrameType::End => { g.finished = true; return Poll::Ready(None); }
                        FrameType::Reset => {
                            g.finished = true;
                            let r = f.parse::<Reset>().unwrap_or(Reset { error: "preview_tunnel_protocol".into(), detail: None });
                            report(&g.shared, g.id, &r.error, r.detail.as_deref().unwrap_or(""));
                            return Poll::Ready(Some(Err(io::Error::other(r.error))));
                        }
                        _ => continue,
                    },
                    Poll::Ready(None) => {
                        g.finished = true;
                        let e = g.shared.closed_error();
                        return Poll::Ready(Some(Err(io::Error::other(e.code))));
                    }
                }
            },
        }
    }
    fn is_end_stream(&self) -> bool { match self { ResBody::Full(b) => b.is_none(), ResBody::Stream(g) => g.finished } }
}

fn report(shared: &Shared, stream: u32, code: &str, detail: &str) {
    eprintln!("preview_stream_failed stream={stream} code={code} detail={detail:?}");
    (shared.status)(&format!("Preview tunnel failed: {code}{}", if detail.is_empty() { String::new() } else { format!(" ({detail})") }), true);
}
fn escape(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }
fn failure_page(status: StatusCode, code: &str, detail: &str) -> Response<ResBody> {
    let html = format!("<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Preview tunnel failed</title><body style=\"font:16px -apple-system,system-ui,sans-serif;padding:24px;color:#222\"><h2>Preview tunnel failed</h2><p><code>{}</code></p><p>{}</p></body>", escape(code), escape(detail));
    Response::builder().status(status).header(header::CONTENT_TYPE, "text/html; charset=utf-8").header(header::CACHE_CONTROL, "no-store").body(ResBody::Full(Some(Bytes::from(html)))).unwrap_or_else(|_| Response::new(ResBody::Full(None)))
}
fn bad_gateway(shared: &Shared, stream: u32, code: &str, detail: &str) -> Response<ResBody> {
    report(shared, stream, code, detail);
    failure_page(StatusCode::BAD_GATEWAY, code, detail)
}

// ---------------------------------------------------------------- request handling

fn headers_of(map: &HeaderMap, skip_prefix: &str) -> Vec<(String, String)> {
    map.iter().filter(|(k, _)| !tunnel::is_hop_by_hop(k.as_str()) && (skip_prefix.is_empty() || !k.as_str().starts_with(skip_prefix)))
        .map(|(k, v)| (k.as_str().to_owned(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect()
}
fn host_ok(req: &Request<Incoming>, port: u16) -> bool {
    req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).is_some_and(|h| h.eq_ignore_ascii_case(&format!("127.0.0.1:{port}")) || h.eq_ignore_ascii_case(&format!("localhost:{port}")))
}
fn is_ws_upgrade<B>(req: &Request<B>) -> bool {
    let has = |name, token: &str| req.headers().get_all(name).iter().any(|v| v.to_str().is_ok_and(|v| v.split(',').any(|t| t.trim().eq_ignore_ascii_case(token))));
    has(header::UPGRADE, "websocket") && has(header::CONNECTION, "upgrade")
}

async fn handle(shared: Arc<Shared>, port: u16, req: Request<Incoming>) -> Result<Response<ResBody>, Infallible> {
    if !host_ok(&req, port) { return Ok(failure_page(StatusCode::FORBIDDEN, "preview_forbidden_host", "unexpected Host header")); }
    Ok(if is_ws_upgrade(&req) { handle_ws(shared, req).await } else { handle_http(shared, req).await })
}

async fn handle_http(shared: Arc<Shared>, req: Request<Incoming>) -> Response<ResBody> {
    let mut guard = match shared.open_stream() { Ok(g) => g, Err(e) => return bad_gateway(&shared, 0, e.code, &e.detail) };
    let id = guard.id;
    let head = ReqHead { method: req.method().as_str().to_owned(), path: req.uri().path_and_query().map(|p| p.as_str().to_owned()).unwrap_or_else(|| "/".into()), headers: headers_of(req.headers(), "") };
    if let Err(e) = shared.sender.send_req_head(id, &head).await { guard.finished = true; return bad_gateway(&shared, id, e.code, &e.detail); }
    let mut body = req.into_body();
    let sender = shared.sender.clone();
    let pump = tokio::spawn(async move {
        loop {
            match std::future::poll_fn(|cx| Pin::new(&mut body).poll_frame(cx)).await {
                Some(Ok(frame)) => if let Ok(data) = frame.into_data() { if sender.send_body(id, &data).await.is_err() { return; } },
                Some(Err(_)) => { let _ = sender.send_reset(id, "preview_client_aborted", None).await; return; }
                None => { let _ = sender.send_end(id).await; return; }
            }
        }
    });
    guard.pump = Some(pump.abort_handle());
    let res = loop {
        match guard.rx.recv().await {
            Some(f) if f.kind == FrameType::ResHead => match f.parse::<ResHead>() { Ok(h) => break h, Err(e) => { guard.finished = true; return bad_gateway(&shared, id, e.code, &e.detail); } },
            Some(f) if f.kind == FrameType::Reset => { guard.finished = true; let r = f.parse::<Reset>().unwrap_or(Reset { error: "preview_tunnel_protocol".into(), detail: None }); return bad_gateway(&shared, id, &r.error, r.detail.as_deref().unwrap_or("")); }
            Some(_) => continue,
            None => { guard.finished = true; let e = shared.closed_error(); return bad_gateway(&shared, id, e.code, &e.detail); }
        }
    };
    let mut builder = Response::builder().status(StatusCode::from_u16(res.status).unwrap_or(StatusCode::BAD_GATEWAY));
    for (k, v) in &res.headers {
        if tunnel::is_hop_by_hop(k) { continue; }
        if let (Ok(name), Ok(value)) = (header::HeaderName::from_bytes(k.as_bytes()), header::HeaderValue::from_str(v)) { builder = builder.header(name, value); }
    }
    match builder.body(ResBody::Stream(guard)) {
        Ok(r) => r,
        Err(e) => bad_gateway(&shared, id, "preview_tunnel_protocol", &e.to_string()),
    }
}

async fn handle_ws(shared: Arc<Shared>, mut req: Request<Incoming>) -> Response<ResBody> {
    let Some(key) = req.headers().get(header::SEC_WEBSOCKET_KEY).and_then(|k| k.to_str().ok()).map(str::to_owned) else {
        return failure_page(StatusCode::BAD_REQUEST, "preview_invalid_request", "missing Sec-WebSocket-Key");
    };
    let protocols: Vec<String> = req.headers().get_all(header::SEC_WEBSOCKET_PROTOCOL).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(',')).map(|p| p.trim().to_owned()).filter(|p| !p.is_empty()).collect();
    let on_upgrade = hyper::upgrade::on(&mut req);
    let mut guard = match shared.open_stream() { Ok(g) => g, Err(e) => return bad_gateway(&shared, 0, e.code, &e.detail) };
    let id = guard.id;
    let open = WsOpen { path: req.uri().path_and_query().map(|p| p.as_str().to_owned()).unwrap_or_else(|| "/".into()), headers: headers_of(req.headers(), "sec-websocket-"), protocols };
    if let Err(e) = shared.sender.send_ws_open(id, &open).await { guard.finished = true; return bad_gateway(&shared, id, e.code, &e.detail); }
    let accept = loop {
        match guard.rx.recv().await {
            Some(f) if f.kind == FrameType::WsAccept => break f.parse::<WsAccept>().unwrap_or_default(),
            Some(f) if f.kind == FrameType::Reset => { guard.finished = true; let r = f.parse::<Reset>().unwrap_or(Reset { error: "preview_tunnel_protocol".into(), detail: None }); return bad_gateway(&shared, id, &r.error, r.detail.as_deref().unwrap_or("")); }
            Some(_) => continue,
            None => { guard.finished = true; let e = shared.closed_error(); return bad_gateway(&shared, id, e.code, &e.detail); }
        }
    };
    let mut builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS).header(header::UPGRADE, "websocket").header(header::CONNECTION, "Upgrade").header(header::SEC_WEBSOCKET_ACCEPT, derive_accept_key(key.as_bytes()));
    if let Some(p) = accept.protocol.as_deref().and_then(|p| header::HeaderValue::from_str(p).ok()) { builder = builder.header(header::SEC_WEBSOCKET_PROTOCOL, p); }
    let response = match builder.body(ResBody::Full(None)) { Ok(r) => r, Err(e) => { guard.finished = true; return bad_gateway(&shared, id, "preview_tunnel_protocol", &e.to_string()); } };
    tokio::spawn(ws_pump(guard, on_upgrade));
    response
}

async fn ws_pump(mut guard: StreamGuard, on_upgrade: hyper::upgrade::OnUpgrade) {
    let (sender, id) = (guard.shared.sender.clone(), guard.id);
    let Ok(upgraded) = on_upgrade.await else { return }; // guard drop resets the stream
    let mut ws = WebSocketStream::from_raw_socket(TokioIo::new(upgraded), WsRole::Server, None).await;
    let sendable = |c: u16| (1000..5000).contains(&c) && !matches!(c, 1004 | 1005 | 1006 | 1015);
    loop {
        tokio::select! {
            msg = ws.next() => match msg {
                Some(Ok(Message::Text(t))) => if sender.send_ws_text(id, t.as_str()).await.is_err() { guard.finished = true; break },
                Some(Ok(Message::Binary(b))) => if sender.send_ws_binary(id, &b).await.is_err() { guard.finished = true; break },
                Some(Ok(Message::Close(cf))) => {
                    let close = WsClose { code: cf.as_ref().map(|c| u16::from(c.code)), reason: cf.map(|c| c.reason.to_string()).filter(|r| !r.is_empty()) };
                    let _ = sender.send_ws_close(id, &close).await;
                    guard.finished = true;
                    break;
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => break, // abrupt web view disconnect: guard drop sends RESET
            },
            frame = guard.rx.recv() => {
                let Some(f) = frame else {
                    guard.finished = true;
                    let _ = ws.send(Message::Close(Some(CloseFrame { code: CloseCode::Error, reason: "preview_tunnel_closed".into() }))).await;
                    break;
                };
                match f.kind {
                    FrameType::WsText => { let sent = ws.send(Message::text(String::from_utf8_lossy(&f.payload).into_owned())).await; if sent.is_err() { break; } }
                    FrameType::WsBinary => { let sent = ws.send(Message::binary(f.payload)).await; if sent.is_err() { break; } }
                    FrameType::WsClose => {
                        guard.finished = true;
                        let c: WsClose = f.parse().unwrap_or_default();
                        let frame = c.code.filter(|c| sendable(*c)).map(|code| CloseFrame { code: CloseCode::from(code), reason: c.reason.clone().unwrap_or_default().into() });
                        let _ = ws.send(Message::Close(frame)).await;
                        break;
                    }
                    FrameType::Reset => {
                        guard.finished = true;
                        let r = f.parse::<Reset>().unwrap_or(Reset { error: "preview_tunnel_protocol".into(), detail: None });
                        report(&guard.shared, id, &r.error, r.detail.as_deref().unwrap_or(""));
                        let _ = ws.send(Message::Close(Some(CloseFrame { code: CloseCode::Error, reason: r.error.into() }))).await;
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}

// ---------------------------------------------------------------- server + demux

/// A running loopback server bound to one tunnel.
pub struct Proxy { pub port: u16, shutdown: watch::Sender<bool>, sender: TunnelSender }
impl Proxy {
    /// Stops the server and closes the tunnel. No status line and no `ClosedFn` call.
    pub fn shutdown(&self) { let _ = self.shutdown.send(true); self.sender.close(); }
}

/// Binds 127.0.0.1:0 and serves the tunnel. `on_closed` runs if the tunnel dies by itself.
pub async fn start(tunnel: Tunnel, status: StatusFn, on_closed: ClosedFn) -> io::Result<Proxy> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let Tunnel { sender, mut events } = tunnel;
    let shared = Arc::new(Shared { sender: sender.clone(), inner: Mutex::new(Inner::default()), status: status.clone() });
    let (shutdown, shutdown_rx) = watch::channel(false);

    let (demux_shared, demux_shutdown) = (shared.clone(), shutdown_rx.clone());
    tokio::spawn(async move {
        let reason = loop {
            match events.recv().await {
                Some(TunnelEvent::Frame(f)) => {
                    let tx = demux_shared.inner.lock().unwrap_or_else(|e| e.into_inner()).streams.get(&f.stream).cloned();
                    if let Some(tx) = tx { let _ = tx.send(f); }
                }
                Some(TunnelEvent::Closed(e)) => break e,
                None => break TunnelError::new("preview_tunnel_closed", "event channel closed"),
            }
        };
        {
            let mut i = demux_shared.inner.lock().unwrap_or_else(|e| e.into_inner());
            i.closed = Some(reason.clone());
            i.streams.clear(); // wakes every in-flight stream with a failure
        }
        let by_user = *demux_shutdown.borrow();
        eprintln!("preview_tunnel_closed reason={} detail={:?} requested={by_user}", reason.code, reason.detail);
        if !by_user {
            (demux_shared.status)(&format!("Preview tunnel closed: {}", reason), true);
            on_closed(&reason);
        }
    });

    let mut accept_shutdown = shutdown_rx;
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = accept_shutdown.changed() => break,
                accepted = listener.accept() => {
                    let Ok((sock, _)) = accepted else { continue };
                    let (shared, mut conn_shutdown) = (shared.clone(), accept_shutdown.clone());
                    tokio::spawn(async move {
                        let service = service_fn(move |req| handle(shared.clone(), port, req));
                        let conn = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(sock), service).with_upgrades();
                        tokio::pin!(conn);
                        tokio::select! {
                            result = &mut conn => { if let Err(e) = result { if !e.is_incomplete_message() { eprintln!("preview_loopback_connection_error detail={e}"); } } }
                            _ = conn_shutdown.changed() => {}
                        }
                    });
                }
            }
        }
    });
    Ok(Proxy { port, shutdown, sender })
}
