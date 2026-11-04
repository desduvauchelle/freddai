#[cfg(not(target_os = "ios"))]
mod window_state;
mod companion_crypto;
#[cfg(target_os = "macos")]
mod companion_pairing;
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
#[path = "companion_pairing_unsupported.rs"]
mod companion_pairing;
#[cfg(target_os = "macos")]
mod companion_relay;
#[cfg(not(target_os = "ios"))]
mod desktop;
#[cfg(not(target_os = "ios"))]
mod git_history;
#[cfg(not(target_os = "ios"))]
mod screen_grab;
#[cfg(target_os = "macos")]
mod companion_server;
#[cfg(target_os = "ios")]
mod mobile;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "ios")]
    mobile::run();
    #[cfg(not(target_os = "ios"))]
    desktop::run();
}

#[cfg(target_os = "macos")]
pub fn serve_companion(root: std::path::PathBuf) -> Result<(), String> {
    if !companion_server::start(root)? { return Ok(()); }
    loop { std::thread::park(); }
}

#[cfg(target_os = "macos")]
pub fn configure_companion_relay(root: &std::path::Path, url: &str) -> Result<(), String> {
    companion_pairing::control(root,"relay",url).map(|_|())
}
