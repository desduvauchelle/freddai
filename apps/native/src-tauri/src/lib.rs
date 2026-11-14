#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod project_editor;
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
mod preview_url;
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
mod app_windows;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod scout;
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
/// Satellite Mac: host-side command dispatcher (`/v1/desktop`) and the satellite GUI runtime.
#[cfg(target_os = "macos")]
mod satellite_host;
#[cfg(target_os = "macos")]
mod satellite_terminals;
#[cfg(target_os = "macos")]
mod satellite_desktop;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // generate_context! must be expanded exactly once per crate (it embeds the Info.plist symbol).
    let context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    refuse_host_cache_gui();
    #[cfg(target_os = "macos")]
    if satellite::enabled() { satellite_desktop::run(context); return; }
    #[cfg(any(target_os = "ios", target_os = "android"))]
    mobile::run(context);
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    desktop::run(context);
}

/// The GUI must run from the installed bundle: a cached copy shares its bundle id and is stale.
/// Headless modes (--host, --mcp, ...) are dispatched in main.rs before this and may run from the cache.
#[cfg(target_os = "macos")]
fn refuse_host_cache_gui() {
    let Ok(exe) = std::env::current_exe() else { return };
    if !exe.components().any(|c| c.as_os_str() == "host-binaries") { return; }
    eprintln!("{}", serde_json::json!({"event":"gui_launched_from_host_cache","path":exe.to_string_lossy(),"action":"opening /Applications/Freddai.app"}));
    match std::process::Command::new("/usr/bin/open").arg("/Applications/Freddai.app").status() {
        Ok(s) if s.success() => {}
        other => eprintln!("{}", serde_json::json!({"event":"gui_launched_from_host_cache.open_failed","result":format!("{other:?}")})),
    }
    std::process::exit(1);
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
