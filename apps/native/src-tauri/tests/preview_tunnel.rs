//! Runs the preview tunnel unit + end-to-end tests (frames, cipher, grants, fake relay, HTTP,
//! WebSocket, refused connections) without linking the Tauri app: the source files are
//! included directly, like the other standalone tests in this directory.
#[path = "../src/companion_crypto.rs"]
mod companion_crypto;
#[path = "../src/preview_url.rs"]
mod preview_url;
#[allow(dead_code)]
#[path = "../src/preview_tunnel.rs"]
mod preview_tunnel;
#[allow(dead_code)]
#[path = "../src/preview_host.rs"]
mod preview_host;
