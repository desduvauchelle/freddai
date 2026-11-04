//! Integrated terminal: PTY sessions for the desktop app (never compiled for iOS/Android).
//! Output streams to the frontend as `terminal-output` events and `terminal-exit` on shell exit.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

fn shell_command(cwd: &Path) -> CommandBuilder {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| {
        eprintln!("terminal: $SHELL is not set; falling back to /bin/zsh");
        "/bin/zsh".into()
    });
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd
}

/// Split off the longest valid UTF-8 prefix; an incomplete trailing sequence stays in `pending`.
fn take_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => { let s = s.to_string(); pending.clear(); s }
        Err(e) => {
            let valid = e.valid_up_to();
            match e.error_len() {
                // Incomplete tail: keep it for the next read.
                None => { let s = String::from_utf8_lossy(&pending[..valid]).into_owned(); pending.drain(..valid); s }
                // Genuinely invalid bytes: emit lossily rather than stalling.
                Some(_) => { let s = String::from_utf8_lossy(pending).into_owned(); pending.clear(); s }
            }
        }
    }
}

impl PtySession {
    pub fn spawn(
        cwd: &Path, cols: u16, rows: u16,
        on_data: impl Fn(String) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        if !cwd.is_dir() { return Err(format!("Terminal folder does not exist: {}", cwd.display())); }
        let pair = native_pty_system()
            .openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Cannot open a terminal: {e}"))?;
        let child = pair.slave.spawn_command(shell_command(cwd)).map_err(|e| format!("Cannot start the shell: {e}"))?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| format!("Cannot read terminal output: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("Cannot write to terminal: {e}"))?;
        let child = Arc::new(Mutex::new(child));
        let waiter = child.clone();
        std::thread::spawn(move || {
            let (mut buf, mut pending) = ([0u8; 8192], Vec::new());
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let text = take_utf8(&mut pending);
                        if !text.is_empty() { on_data(text); }
                    }
                }
            }
            if !pending.is_empty() { on_data(String::from_utf8_lossy(&pending).into_owned()); }
            // EOF: the shell (or whole session) ended. Poll so close() can still take the lock to kill.
            let code = loop {
                match waiter.lock().map_err(|_| ()).and_then(|mut c| c.try_wait().map_err(|_| ())) {
                    Ok(Some(status)) => break Some(status.exit_code()),
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
                    Err(()) => break None,
                }
            };
            on_exit(code);
        });
        Ok(Self { master: pair.master, writer, child })
    }

    pub fn write(&mut self, data: &str) -> Result<(), String> {
        self.writer.write_all(data.as_bytes()).and_then(|_| self.writer.flush()).map_err(|e| format!("Cannot write to terminal: {e}"))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master.resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Cannot resize terminal: {e}"))
    }

    pub fn kill(&self) {
        if let Ok(mut c) = self.child.lock() { let _ = c.kill(); }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) { self.kill(); }
}

#[derive(Default)]
pub struct Terminals {
    next: Mutex<u32>,
    sessions: Mutex<HashMap<u32, PtySession>>,
}

impl Terminals {
    /// Kill every shell (app exit).
    pub fn close_all(&self) {
        if let Ok(mut s) = self.sessions.lock() { s.clear(); }
    }
}

#[derive(Clone, Serialize)]
struct Output { id: u32, data: String }
#[derive(Clone, Serialize)]
struct Exit { id: u32, code: Option<u32> }

#[tauri::command]
pub fn terminal_open(app: AppHandle, state: State<'_, Terminals>, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    let id = { let mut n = state.next.lock().map_err(|_| "terminal state poisoned")?; *n += 1; *n };
    let (a, b) = (app.clone(), app);
    let session = PtySession::spawn(
        Path::new(&cwd), cols, rows,
        move |data| { let _ = a.emit("terminal-output", Output { id, data }); },
        move |code| { let _ = b.emit("terminal-exit", Exit { id, code }); },
    )?;
    state.sessions.lock().map_err(|_| "terminal state poisoned")?.insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn terminal_write(state: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    let mut s = state.sessions.lock().map_err(|_| "terminal state poisoned")?;
    s.get_mut(&id).ok_or_else(|| format!("Terminal {id} is not running"))?.write(&data)
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let s = state.sessions.lock().map_err(|_| "terminal state poisoned")?;
    s.get(&id).ok_or_else(|| format!("Terminal {id} is not running"))?.resize(cols, rows)
}

#[tauri::command]
pub fn terminal_close(state: State<'_, Terminals>, id: u32) -> Result<(), String> {
    // Dropping the session kills the shell; closing an already-exited terminal is fine.
    state.sessions.lock().map_err(|_| "terminal state poisoned")?.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn pty_runs_echo_and_reports_exit() {
        let (tx, rx) = mpsc::channel();
        let (etx, erx) = mpsc::channel();
        let dir = std::env::temp_dir();
        let mut s = PtySession::spawn(&dir, 80, 24, move |d| { let _ = tx.send(d); }, move |c| { let _ = etx.send(c); }).unwrap();
        s.write("echo freddai-$((20+22))\nexit 3\n").unwrap();
        let mut out = String::new();
        while let Ok(d) = rx.recv_timeout(Duration::from_secs(10)) { out.push_str(&d); }
        assert!(out.contains("freddai-42"), "output was: {out:?}");
        assert_eq!(erx.recv_timeout(Duration::from_secs(5)).unwrap(), Some(3));
    }

    #[test]
    fn spawn_rejects_missing_folder() {
        assert!(PtySession::spawn(Path::new("/nonexistent-freddai"), 80, 24, |_| {}, |_| {}).is_err());
    }

    #[test]
    fn utf8_split_across_reads_is_preserved() {
        let bytes = "é".as_bytes();
        let mut p = vec![bytes[0]];
        assert_eq!(take_utf8(&mut p), "");
        p.push(bytes[1]);
        assert_eq!(take_utf8(&mut p), "é");
    }
}
