//! A pipe lease prevents agent processes surviving an unexpected host death.
use std::{
    io::Read,
    process::{Child, Command, Stdio},
    time::Duration,
};
pub fn watch(mut lease: impl Read, group: i32) {
    if group <= 1 {
        return;
    }
    let mut data = [0u8; 64];
    while let Ok(n) = lease.read(&mut data) {
        if n == 0 {
            break;
        }
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-group, libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(100));
    #[cfg(unix)]
    unsafe {
        libc::kill(-group, libc::SIGKILL);
    }
}
pub struct Guard(Child);
impl Guard {
    pub fn start(group: u32) -> Result<Option<Self>, String> {
        // Only the native host binary implements the helper entry point. Unit fixtures run directly.
        if !std::env::args().any(|a| a == "--host") {
            return Ok(None);
        }
        let mut cmd = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
        cmd.args(["--watch-process", &group.to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        cmd.spawn()
            .map(|c| Some(Self(c)))
            .map_err(|e| e.to_string())
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        drop(self.0.stdin.take());
        let _ = self.0.wait();
    }
}
