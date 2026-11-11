#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod browser;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod local_preview;
#[cfg(target_os = "macos")]
mod routine_notifications;
mod companion_operations;
#[cfg(target_os = "macos")]
mod writing_tools;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod window_state;
mod companion_crypto;
// Shared with the future phone side, so compiled everywhere.
#[allow(dead_code)]
mod preview_tunnel;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod preview_host;
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
mod thread_windows;
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
#[cfg(target_os = "macos")]
mod bug_walk;
#[cfg_attr(not(any(target_os = "ios", target_os = "android")), allow(dead_code))]
mod client_diag;
#[cfg(any(target_os = "ios", target_os = "android", target_os = "macos"))]
mod mobile;
#[cfg(any(target_os = "ios", target_os = "android", target_os = "macos"))]
mod preview_device;
#[cfg(target_os = "macos")]
mod satellite;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // generate_context! must be expanded exactly once per crate (it embeds the Info.plist symbol).
    let context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    if satellite::enabled() { mobile::run(context); return; }
    #[cfg(any(target_os = "ios", target_os = "android"))]
    mobile::run(context);
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    desktop::run(context);
}

/// Starts the keep-awake monitor; called by the long-lived `--host` process.
#[cfg(target_os = "macos")]
pub fn start_awake_monitor(root: std::path::PathBuf) { routine_notifications::start(root.clone()); awake::spawn_monitor(root) }

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

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod thread_list_settings;
