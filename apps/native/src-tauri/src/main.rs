#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "ios"))]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--watch-process") {
        if let Some(group) = args.get(2).and_then(|s| s.parse::<i32>().ok()) {
            freddai_core::watchdog::watch(std::io::stdin(), group);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--host") {
        let root = std::path::PathBuf::from(args.get(2).expect("Missing host workspace"));
        #[cfg(target_os = "macos")]
        freddai_native_lib::start_awake_monitor(root.clone());
        if let Err(e) = freddai_core::host::serve(root) {
            eprintln!("{e}");
            std::process::exit(1)
        }
        return;
    }
    #[cfg(target_os = "macos")]
    if args.get(1).map(String::as_str) == Some("--companion-server") {
        let root = std::path::PathBuf::from(args.get(2).expect("Missing workspace"));
        if let Err(error) = freddai_native_lib::serve_companion(root) { eprintln!("{error}"); std::process::exit(1); }
        return;
    }
    #[cfg(target_os = "macos")]
    if args.get(1).map(String::as_str) == Some("--companion-relay") {
        let root = std::path::PathBuf::from(args.get(2).expect("Missing workspace"));
        let url = args.get(3).expect("Missing relay URL (empty disables remote access)");
        if let Err(error) = freddai_native_lib::configure_companion_relay(&root,url) {eprintln!("{error}");std::process::exit(1);}
        println!("Companion relay configuration saved");
        return;
    }
    // Preserve startup diagnostics when Finder provides no terminal stderr.
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        use std::os::fd::AsRawFd;
        use std::os::unix::fs::OpenOptionsExt;
        let dir = std::path::PathBuf::from(home).join("Library/Logs/Freddai");
        if std::fs::create_dir_all(&dir).is_ok() {
            let path = dir.join("native.log");
            if std::fs::metadata(&path).is_ok_and(|meta| meta.len() > 1024 * 1024) {
                let _ = std::fs::rename(&path, dir.join("native.previous.log"));
            }
            if let Ok(log) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .mode(0o600)
                .open(path)
            {
                unsafe {
                    libc::dup2(log.as_raw_fd(), libc::STDERR_FILENO);
                }
                eprintln!(
                    "Freddai startup pid={} time={:?}",
                    std::process::id(),
                    std::time::SystemTime::now()
                );
            }
        }
    }
    freddai_native_lib::run();
}

#[cfg(target_os = "ios")]
fn main() { freddai_native_lib::run(); }
