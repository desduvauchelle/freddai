//! Microphone capture on a dedicated thread (cpal streams are not Send).

use super::resample::resample_to_16k_mono;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat};
use std::sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex};
use std::thread::JoinHandle;

const MAX_SECONDS: usize = 300;
pub const MIC_DENIED: &str = "Microphone access denied — allow Freddai in System Settings › Privacy & Security › Microphone";

struct Session {
    stop_tx: mpsc::Sender<()>,
    join: JoinHandle<()>,
    samples: Arc<Mutex<Vec<f32>>>,
    rate: u32,
    channels: u16,
    failed: Arc<Mutex<Option<String>>>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

pub fn is_recording() -> bool {
    SESSION.lock().unwrap_or_else(|p| p.into_inner()).is_some()
}

fn map_err(context: &str, e: impl std::fmt::Display) -> String {
    let text = e.to_string();
    let lower = text.to_lowercase();
    if lower.contains("permission") || lower.contains("denied") || lower.contains("not authorized") {
        MIC_DENIED.to_string()
    } else {
        format!("{context}: {text}")
    }
}

pub fn start() -> Result<(), String> {
    let mut guard = SESSION.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_some() {
        return Err("Already recording".into());
    }
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let failed = Arc::new(Mutex::new(None::<String>));
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, u16), String>>();
    let (s2, f2) = (samples.clone(), failed.clone());
    let join = std::thread::Builder::new()
        .name("voice-recorder".into())
        .spawn(move || {
            let stream = match build(s2, f2) {
                Ok((stream, rate, ch)) => {
                    let _ = ready_tx.send(Ok((rate, ch)));
                    stream
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let _ = stop_rx.recv(); // returns on stop() or when the sender is dropped
            drop(stream);
        })
        .map_err(|e| format!("Could not start recorder thread: {e}"))?;
    let (rate, channels) = match ready_rx.recv_timeout(std::time::Duration::from_secs(15)) {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => { let _ = join.join(); return Err(e); }
        Err(_) => return Err("Timed out opening the microphone".into()),
    };
    *guard = Some(Session { stop_tx, join, samples, rate, channels, failed });
    Ok(())
}

fn build(samples: Arc<Mutex<Vec<f32>>>, failed: Arc<Mutex<Option<String>>>) -> Result<(cpal::Stream, u32, u16), String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("No microphone found — connect an input device and try again")?;
    let config = device.default_input_config().map_err(|e| map_err("Could not read microphone settings", e))?;
    let rate = config.sample_rate().0;
    let channels = config.channels();
    let cap = MAX_SECONDS * rate as usize * channels as usize;
    let cfg = config.config();
    let on_err = move |e: cpal::StreamError| {
        eprintln!("voice.recorder.stream_error error={e}");
        *failed.lock().unwrap_or_else(|p| p.into_inner()) = Some(e.to_string());
    };
    let full = Arc::new(AtomicBool::new(false));
    macro_rules! input {
        ($t:ty) => {{
            let (samples, full) = (samples.clone(), full.clone());
            device.build_input_stream(
                &cfg,
                move |data: &[$t], _| {
                    if full.load(Ordering::Relaxed) { return; }
                    let mut b = samples.lock().unwrap_or_else(|p| p.into_inner());
                    let room = cap.saturating_sub(b.len());
                    if data.len() >= room { full.store(true, Ordering::Relaxed); }
                    b.extend(data.iter().take(room).map(|s| s.to_sample::<f32>()));
                },
                on_err,
                None,
            )
        }};
    }
    let stream = match config.sample_format() {
        SampleFormat::F32 => input!(f32),
        SampleFormat::I16 => input!(i16),
        SampleFormat::U16 => input!(u16),
        other => return Err(format!("Unsupported microphone sample format {other:?}")),
    }
    .map_err(|e| map_err("Could not open the microphone", e))?;
    stream.play().map_err(|e| map_err("Could not start the microphone", e))?;
    Ok((stream, rate, channels))
}

fn end() -> Result<(Vec<f32>, u32, u16, Option<String>), String> {
    let s = SESSION.lock().unwrap_or_else(|p| p.into_inner()).take().ok_or("Not recording")?;
    let _ = s.stop_tx.send(());
    let _ = s.join.join();
    let samples = std::mem::take(&mut *s.samples.lock().unwrap_or_else(|p| p.into_inner()));
    let failure = s.failed.lock().unwrap_or_else(|p| p.into_inner()).clone();
    Ok((samples, s.rate, s.channels, failure))
}

/// Stops and returns 16 kHz mono samples.
pub fn stop() -> Result<Vec<f32>, String> {
    let (samples, rate, channels, failure) = end()?;
    if let Some(e) = failure {
        return Err(format!("Microphone stream failed: {e}"));
    }
    // macOS delivers exact digital silence when the app lacks microphone permission.
    if samples.len() > rate as usize * channels as usize / 2 && samples.iter().all(|s| *s == 0.0) {
        return Err(MIC_DENIED.into());
    }
    Ok(resample_to_16k_mono(&samples, rate, channels))
}

pub fn cancel() {
    let _ = end();
}
