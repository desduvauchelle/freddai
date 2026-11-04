//! Diagnostic `[stream-timing]` lines (stderr -> ~/Library/Logs/Freddai/native.log).
//! `t` is monotonic ms since this process first logged; `wall` is unix epoch ms so
//! host-process and app-process lines can be correlated.
use std::{sync::OnceLock, time::Instant};

fn origin() -> &'static Instant {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    ORIGIN.get_or_init(Instant::now)
}
pub fn mono_ms() -> f64 {
    origin().elapsed().as_secs_f64() * 1000.0
}
pub fn wall_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
pub fn ms(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}
pub fn log(proc_kind: &str, fields: std::fmt::Arguments) {
    eprintln!(
        "[stream-timing] t={:.1} wall={} proc={}[{}] {}",
        mono_ms(),
        wall_ms(),
        proc_kind,
        std::process::id(),
        fields
    );
}
