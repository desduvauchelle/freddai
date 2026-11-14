//! Headless PTY sessions polled by a satellite Mac.
//!
//! The companion server is a headless process without a Tauri `AppHandle`, so terminal output cannot be
//! pushed as events. Each session buffers its output as sequenced chunks and the satellite polls with
//! `terminal_poll(id, after)`. Chunks below `after` are acknowledged and dropped; the buffer is capped
//! (oldest dropped first, reported once as `truncated`); sessions nobody polls for 10 minutes are killed.
use crate::terminal::PtySession;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    path::Path,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex, Once, OnceLock,
    },
    time::{Duration, Instant},
};

/// Total buffered output per session.
const MAX_BUFFERED_BYTES: usize = 4 * 1024 * 1024;
/// A session nobody has polled for this long is killed.
const IDLE_LIMIT: Duration = Duration::from_secs(10 * 60);

/// Pure buffering logic, separate from the PTY so the cap can be unit tested.
pub(crate) struct Buffer {
    chunks: VecDeque<(u64, String)>,
    bytes: usize,
    next: u64,
    dropped: bool,
    cap: usize,
}

impl Buffer {
    pub(crate) fn new(cap: usize) -> Self {
        Self { chunks: VecDeque::new(), bytes: 0, next: 0, dropped: false, cap }
    }
    pub(crate) fn push(&mut self, data: String) {
        if data.is_empty() { return; }
        self.bytes += data.len();
        self.chunks.push_back((self.next, data));
        self.next += 1;
        // Always keep the newest chunk, even when it alone exceeds the cap.
        while self.bytes > self.cap && self.chunks.len() > 1 {
            if let Some((_, old)) = self.chunks.pop_front() {
                self.bytes -= old.len();
                self.dropped = true;
            }
        }
    }
    /// Chunks with `seq >= after` (older ones are acknowledged and freed), and whether output was
    /// dropped since the last poll (reported once).
    pub(crate) fn take(&mut self, after: u64) -> (Vec<(u64, String)>, bool) {
        while self.chunks.front().is_some_and(|(seq, _)| *seq < after) {
            if let Some((_, old)) = self.chunks.pop_front() { self.bytes -= old.len(); }
        }
        let truncated = std::mem::take(&mut self.dropped);
        (self.chunks.iter().cloned().collect(), truncated)
    }
}

struct Shared {
    buffer: Buffer,
    /// `Some(code)` once the shell has exited (the code itself may be unknown).
    exited: Option<Option<u32>>,
    last_polled: Instant,
}

struct Session {
    pty: PtySession,
    shared: Arc<Mutex<Shared>>,
}

static SESSIONS: OnceLock<Mutex<HashMap<u32, Session>>> = OnceLock::new();
static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static REAPER: Once = Once::new();

fn sessions() -> &'static Mutex<HashMap<u32, Session>> {
    SESSIONS.get_or_init(Default::default)
}

fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "Terminal state is unavailable".to_string())
}

fn not_running(id: u32) -> String { format!("Terminal {id} is not running") }

fn start_reaper() {
    REAPER.call_once(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(30));
            let Ok(mut all) = sessions().lock() else { continue };
            let stale: Vec<u32> = all
                .iter()
                .filter(|(_, s)| s.shared.lock().map_or(true, |sh| sh.last_polled.elapsed() >= IDLE_LIMIT))
                .map(|(id, _)| *id)
                .collect();
            for id in stale {
                // Dropping the session kills the shell.
                all.remove(&id);
                eprintln!("{}", json!({"event": "satellite.terminal_reaped", "id": id, "reason": "not polled for 10 minutes"}));
            }
        });
    });
}

pub fn open(cwd: &str, cols: u16, rows: u16) -> Result<u32, String> {
    start_reaper();
    let shared = Arc::new(Mutex::new(Shared { buffer: Buffer::new(MAX_BUFFERED_BYTES), exited: None, last_polled: Instant::now() }));
    let (data_sink, exit_sink) = (shared.clone(), shared.clone());
    let pty = PtySession::spawn(
        Path::new(cwd),
        cols,
        rows,
        move |data| { if let Ok(mut s) = data_sink.lock() { s.buffer.push(data); } },
        move |code| { if let Ok(mut s) = exit_sink.lock() { s.exited = Some(code); } },
    )?;
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    lock(sessions())?.insert(id, Session { pty, shared });
    Ok(id)
}

pub fn write(id: u32, data: &str) -> Result<(), String> {
    let mut all = lock(sessions())?;
    all.get_mut(&id).ok_or_else(|| not_running(id))?.pty.write(data)
}

pub fn resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let all = lock(sessions())?;
    all.get(&id).ok_or_else(|| not_running(id))?.pty.resize(cols, rows)
}

pub fn close(id: u32) -> Result<(), String> {
    // Dropping the session kills the shell; closing an already-gone terminal is fine.
    lock(sessions())?.remove(&id);
    Ok(())
}

/// `{"chunks":[{"seq","data"}], "next", "exited", "code", "truncated"}`. Once `exited` has been
/// reported the session is removed, so a later poll of the same id errors "not running".
pub fn poll(id: u32, after: u64) -> Result<Value, String> {
    let mut all = lock(sessions())?;
    let session = all.get(&id).ok_or_else(|| not_running(id))?;
    let (chunks, truncated, next, exited) = {
        let mut sh = lock(&session.shared)?;
        sh.last_polled = Instant::now();
        let (chunks, truncated) = sh.buffer.take(after);
        (chunks, truncated, sh.buffer.next.max(after), sh.exited)
    };
    if exited.is_some() { all.remove(&id); }
    Ok(json!({
        "chunks": chunks.iter().map(|(seq, data)| json!({"seq": seq, "data": data})).collect::<Vec<_>>(),
        "next": next,
        "exited": exited.is_some(),
        "code": exited.flatten(),
        "truncated": truncated,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_cap_drops_oldest_and_reports_truncation_once() {
        let mut b = Buffer::new(10);
        for _ in 0..4 { b.push("xxxx".into()); } // 16 bytes > cap 10: oldest two dropped
        let (chunks, truncated) = b.take(0);
        assert!(truncated);
        assert_eq!(chunks.iter().map(|(s, _)| *s).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(b.next, 4);
        let (_, truncated_again) = b.take(0);
        assert!(!truncated_again, "truncation is reported once");
    }

    #[test]
    fn buffer_take_acknowledges_older_chunks() {
        let mut b = Buffer::new(1024);
        for s in ["a", "b", "c"] { b.push(s.into()); }
        let (chunks, truncated) = b.take(2);
        assert!(!truncated);
        assert_eq!(chunks, vec![(2, "c".to_string())]);
        assert_eq!(b.bytes, 1);
    }

    #[test]
    fn oversized_single_chunk_is_kept() {
        let mut b = Buffer::new(2);
        b.push("hello".into());
        assert_eq!(b.take(0).0.len(), 1);
    }

    #[test]
    fn missing_session_is_a_loud_error() {
        assert!(poll(u32::MAX, 0).unwrap_err().contains("not running"));
        assert!(write(u32::MAX, "x").is_err());
    }

    #[test]
    fn shell_session_round_trip() {
        let id = open(&std::env::temp_dir().to_string_lossy(), 80, 24).unwrap();
        write(id, "echo fred-$((20+22))\n").unwrap();
        let (mut out, mut after) = (String::new(), 0u64);
        let deadline = Instant::now() + Duration::from_secs(20);
        while !out.contains("fred-42") {
            assert!(Instant::now() < deadline, "no output; got {out:?}");
            let v = poll(id, after).unwrap();
            for c in v["chunks"].as_array().unwrap() { out.push_str(c["data"].as_str().unwrap()); }
            after = v["next"].as_u64().unwrap();
            std::thread::sleep(Duration::from_millis(50));
        }
        resize(id, 100, 30).unwrap();
        close(id).unwrap();
        assert!(poll(id, after).is_err());
    }
}
