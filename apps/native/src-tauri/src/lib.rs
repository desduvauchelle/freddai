#[cfg(any(target_os = "ios", target_os = "android", test))]
mod companion_operations;
#[cfg(target_os = "macos")]
mod writing_tools;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod window_state;
mod companion_crypto;
mod companion_enrollment;
mod wake;
#[cfg(target_os = "macos")]
mod awake;
#[cfg(target_os = "macos")]
mod companion_pairing;
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
#[path = "companion_pairing_unsupported.rs"]
mod companion_pairing;
#[cfg(target_os = "macos")]
mod companion_relay;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod desktop;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod git_history;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod git_actions;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod terminal;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod updater;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod screen_grab;
#[cfg(target_os = "macos")]
mod companion_server;
#[cfg(target_os = "macos")]
mod voice;
#[cfg_attr(not(any(target_os = "ios", target_os = "android")), allow(dead_code))]
mod client_diag;
#[cfg(any(target_os = "ios", target_os = "android"))]
mod mobile;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    mobile::run();
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    desktop::run();
}

/// Starts the keep-awake monitor; called by the long-lived `--host` process.
#[cfg(target_os = "macos")]
pub fn start_awake_monitor(root: std::path::PathBuf) { awake::spawn_monitor(root) }

#[cfg(target_os = "macos")]
pub fn serve_companion(root: std::path::PathBuf) -> Result<(), String> {
    if !companion_server::start(root)? { return Ok(()); }
    loop { std::thread::park(); }
}

#[cfg(target_os = "macos")]
pub fn configure_companion_relay(root: &std::path::Path, url: &str) -> Result<(), String> {
    companion_pairing::control(root,"relay",url).map(|_|())
}

#[cfg(windows)]
mod windows_startup;
