//! Device (phone / iPad) side of the companion preview tunnel (docs/preview-tunnel.md).
//! `open` asks the Mac for a session over the existing companion RPC, dials the relay as
//! `role=device`, starts the loopback server (`proxy`) and presents a native web view on it.
use crate::preview_tunnel::{self as tunnel, Role, TunnelConfig};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{future::Future, sync::{Arc, Mutex, OnceLock}};

mod proxy;
mod url;
use proxy::{Proxy, StatusFn};
use url::parse_url;

/// Relay credentials of the paired device. Never logged.
pub struct TunnelAuth { pub relay: Option<String>, /** device mailbox secret (Bearer token) */ pub token: String, /** device key hex */ pub key: String }

struct Active { serial: u64, proxy: Proxy }
fn active() -> &'static Mutex<Option<Active>> { static A: OnceLock<Mutex<Option<Active>>> = OnceLock::new(); A.get_or_init(Default::default) }
fn next_serial() -> u64 { use std::sync::atomic::{AtomicU64, Ordering}; static S: AtomicU64 = AtomicU64::new(1); S.fetch_add(1, Ordering::Relaxed) }
fn open_lock() -> &'static tokio::sync::Mutex<()> { static L: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new(); L.get_or_init(Default::default) }

/// Closes the active preview (tunnel + loopback server), if any.
fn close_active(reason: &str) {
    let taken = active().lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(a) = taken { eprintln!("preview_tunnel_closed reason={reason}"); a.proxy.shutdown(); }
}
fn clear_if(serial: u64) {
    let mut slot = active().lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref().is_some_and(|a| a.serial == serial) { *slot = None; }
}

fn status_fn(app: &tauri::AppHandle) -> StatusFn {
    let app = app.clone();
    Arc::new(move |message: &str, error: bool| {
        let (app, message) = (app.clone(), message.to_owned());
        tauri::async_runtime::spawn_blocking(move || { if let Err(e) = native_status(&app, &message, error) { eprintln!("preview_status_failed detail={e:?}"); } });
    })
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn native_present(app: &tauri::AppHandle, url: &str, title: &str) -> Result<(), String> { tauri_plugin_native_shell::present_preview(app, url, title) }
#[cfg(any(target_os = "ios", target_os = "android"))]
fn native_status(app: &tauri::AppHandle, message: &str, error: bool) -> Result<(), String> { tauri_plugin_native_shell::preview_status(app, message, error) }
#[cfg(any(target_os = "ios", target_os = "android"))]
fn native_listen_dismissed(app: &tauri::AppHandle) -> Result<(), String> {
    static REGISTERED: OnceLock<()> = OnceLock::new();
    if REGISTERED.get().is_some() { return Ok(()); }
    tauri_plugin_native_shell::on_preview_dismissed(app, || close_active("dismissed"))?;
    let _ = REGISTERED.set(());
    Ok(())
}
// macOS satellite mode has no native shell plugin: hand the loopback URL to the default browser.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn native_present(app: &tauri::AppHandle, url: &str, _title: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn native_status(_app: &tauri::AppHandle, message: &str, error: bool) -> Result<(), String> { eprintln!("preview_status error={error} message={message:?}"); Ok(()) }
#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn native_listen_dismissed(_app: &tauri::AppHandle) -> Result<(), String> { Ok(()) }

/// Implements the `preview_open` command. `rpc` sends the composer operation `preview_open`
/// through the existing companion path (direct LAN, then relay) and returns `{session, port}`;
/// its error strings (`preview_not_granted`, `preview_port_unreachable`, ...) pass through unchanged.
pub async fn open<A, F, Fut>(app: tauri::AppHandle, thread_id: String, url: String, auth: A, rpc: F) -> Result<Value, String>
where A: FnOnce() -> Result<TunnelAuth, String>, F: FnOnce(Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
    let _serial_open = open_lock().lock().await;
    let result = open_inner(&app, &thread_id, &url, auth, rpc).await;
    if let Err(error) = &result { eprintln!("preview_open_failed thread={thread_id} error={error:?}"); }
    result
}

async fn open_inner<A, F, Fut>(app: &tauri::AppHandle, thread_id: &str, url: &str, auth: A, rpc: F) -> Result<Value, String>
where A: FnOnce() -> Result<TunnelAuth, String>, F: FnOnce(Value) -> Fut, Fut: Future<Output = Result<Value, String>> {
    let (port, path) = match parse_url(url) { Ok(p) => p, Err(e) => { eprintln!("preview_open_requested thread={thread_id} port=invalid"); return Err(e.into()); } };
    eprintln!("preview_open_requested thread={thread_id} port={port}");
    close_active("replaced");
    native_listen_dismissed(app)?;
    let reply = rpc(json!({"threadId": thread_id, "port": port, "path": path})).await?;
    let session = reply["session"].as_str().filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())).ok_or("preview_invalid_response")?.to_owned();
    if reply["port"].as_u64() != Some(port as u64) { return Err("preview_invalid_response".into()); }
    let auth = auth()?;
    let relay = auth.relay.clone().ok_or("preview_tunnel_unavailable")?;
    let cfg = TunnelConfig { relay, mailbox: hex::encode(Sha256::digest(auth.token.as_bytes())), token: auth.token, session, key: auth.key, role: Role::Device };
    let tunnel = tunnel::connect(&cfg).await.map_err(|e| { eprintln!("preview_tunnel_dial_failed code={} detail={:?}", e.code, e.detail); e.code.to_owned() })?;
    let serial = next_serial();
    let on_closed: proxy::ClosedFn = Box::new(move |_| clear_if(serial));
    let proxy = proxy::start(tunnel, status_fn(app), on_closed).await.map_err(|e| { eprintln!("preview_loopback_bind_failed detail={e}"); "preview_loopback_unavailable".to_string() })?;
    eprintln!("preview_tunnel_connected port={port} local_port={}", proxy.port);
    let local_url = format!("http://127.0.0.1:{}{path}", proxy.port);
    let title = format!("localhost:{port}");
    *active().lock().unwrap_or_else(|e| e.into_inner()) = Some(Active { serial, proxy });
    let presenting = app.clone();
    let presented = tauri::async_runtime::spawn_blocking({ let url = local_url.clone(); move || native_present(&presenting, &url, &title) }).await
        .map_err(|e| e.to_string()).and_then(|r| r);
    if let Err(e) = presented { close_active("present_failed"); return Err(e); }
    Ok(json!({"url": local_url, "port": port}))
}
