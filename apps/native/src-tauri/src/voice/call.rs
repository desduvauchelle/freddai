//! Hands-free voice call: continuous mic capture, energy VAD segmentation, and
//! in-order local Whisper transcription. Plain Rust; events go out through an `Emit` closure
//! so there is no Tauri dependency here.

use super::recorder::MIC_DENIED;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::Duration;

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

const RATE: usize = 16_000;
const WINDOW: usize = 320; // 20 ms
const WINDOW_MS: u32 = 20;
const HANGOVER_MS: u32 = 100; // gap tolerated before an unconfirmed candidate is dropped
const TAIL_KEEP_MS: u32 = 200;

// ---------------------------------------------------------------------------------------------
// VAD / segmenter (pure)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct VadConfig {
    pub silence_ms: u32,
    pub min_speech_ms: u32,
    pub preroll_ms: u32,
    pub max_segment_ms: u32,
}

impl VadConfig {
    pub fn new(silence_ms: u32, min_speech_ms: u32) -> Self {
        Self {
            silence_ms,
            min_speech_ms,
            preroll_ms: 300,
            max_segment_ms: 60_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VadEvent {
    SpeechStart { at_ms: u64 },
    Segment { samples: Vec<f32>, duration_ms: u64 },
}

struct Seg {
    buf: Vec<f32>,
    run_ms: u32,
    silent_ms: u32,
    announced: bool,
}

pub struct Segmenter {
    cfg: VadConfig,
    carry: Vec<f32>,
    preroll: VecDeque<Vec<f32>>,
    floor: f32,
    total_samples: u64,
    seg: Option<Seg>,
}

fn rms(s: &[f32]) -> f32 {
    (s.iter().map(|v| v * v).sum::<f32>() / s.len().max(1) as f32).sqrt()
}

const INITIAL_FLOOR: f32 = 0.003;

impl Segmenter {
    pub fn new(cfg: VadConfig) -> Self {
        Self {
            cfg,
            carry: Vec::new(),
            preroll: VecDeque::new(),
            floor: INITIAL_FLOOR,
            total_samples: 0,
            seg: None,
        }
    }

    /// True once the current segment has passed min_speech_ms.
    pub fn in_speech(&self) -> bool {
        self.seg.as_ref().map(|s| s.announced).unwrap_or(false)
    }

    /// Drops any partial segment and pre-roll; keeps the learned noise floor.
    pub fn reset(&mut self) {
        self.carry.clear();
        self.preroll.clear();
        self.seg = None;
    }

    /// Feed 16 kHz mono samples of any length.
    pub fn feed(&mut self, frame: &[f32]) -> Vec<VadEvent> {
        let mut events = Vec::new();
        self.carry.extend_from_slice(frame);
        let mut offset = 0;
        while self.carry.len() - offset >= WINDOW {
            let w: Vec<f32> = self.carry[offset..offset + WINDOW].to_vec();
            offset += WINDOW;
            self.window(w, &mut events);
        }
        self.carry.drain(..offset);
        events
    }

    fn window(&mut self, w: Vec<f32>, events: &mut Vec<VadEvent>) {
        let r = rms(&w);
        self.total_samples += w.len() as u64;
        let on = (self.floor * 3.0).max(0.012);
        let sustain = (self.floor * 1.8).max(0.007);
        let preroll_windows = (self.cfg.preroll_ms / WINDOW_MS) as usize;
        let max_samples = self.cfg.max_segment_ms as usize * RATE / 1000;
        let total_ms = self.total_samples * 1000 / RATE as u64;

        let Some(seg) = self.seg.as_mut() else {
            if r >= on {
                let mut buf: Vec<f32> = self.preroll.drain(..).flatten().collect();
                buf.extend_from_slice(&w);
                self.seg = Some(Seg {
                    buf,
                    run_ms: WINDOW_MS,
                    silent_ms: 0,
                    announced: false,
                });
                self.maybe_announce(total_ms, events);
            } else {
                // Fast to follow the room down, slow to follow it up.
                let k = if r < self.floor { 0.2 } else { 0.01 };
                self.floor = (self.floor + (r - self.floor) * k).max(1e-4);
                self.preroll.push_back(w);
                while self.preroll.len() > preroll_windows {
                    self.preroll.pop_front();
                }
            }
            return;
        };

        seg.buf.extend_from_slice(&w);
        if r >= sustain {
            seg.silent_ms = 0;
            seg.run_ms += WINDOW_MS;
        } else {
            seg.silent_ms += WINDOW_MS;
        }
        if !seg.announced {
            if seg.silent_ms >= HANGOVER_MS {
                self.seg = None; // cough/click: never reached min_speech_ms
            } else {
                self.maybe_announce(total_ms, events);
            }
            return;
        }
        if seg.silent_ms >= self.cfg.silence_ms {
            let drop_ms = seg.silent_ms.saturating_sub(TAIL_KEEP_MS) as usize;
            let keep = seg.buf.len().saturating_sub(drop_ms * RATE / 1000);
            let mut samples = std::mem::take(&mut seg.buf);
            samples.truncate(keep);
            self.seg = None;
            self.preroll.clear();
            events.push(segment_event(samples));
        } else if seg.buf.len() >= max_samples {
            let samples = std::mem::take(&mut seg.buf);
            seg.silent_ms = 0;
            events.push(segment_event(samples));
        }
    }

    fn maybe_announce(&mut self, total_ms: u64, events: &mut Vec<VadEvent>) {
        if let Some(seg) = self.seg.as_mut() {
            if !seg.announced && seg.run_ms >= self.cfg.min_speech_ms {
                seg.announced = true;
                events.push(VadEvent::SpeechStart { at_ms: total_ms });
            }
        }
    }
}

fn segment_event(samples: Vec<f32>) -> VadEvent {
    let duration_ms = samples.len() as u64 * 1000 / RATE as u64;
    VadEvent::Segment {
        samples,
        duration_ms,
    }
}

// ---------------------------------------------------------------------------------------------
// Whisper silence hallucinations
// ---------------------------------------------------------------------------------------------

const HALLUCINATIONS: &[&str] = &[
    "thank you",
    "thanks",
    "thanks for watching",
    "thank you for watching",
    "thank you so much for watching",
    "you",
    "bye",
    "blank audio",
    "silence",
    "music",
    "inaudible",
];

pub fn is_hallucination(text: &str) -> bool {
    let norm: String = text
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    norm.is_empty() || HALLUCINATIONS.contains(&norm.as_str())
}

// ---------------------------------------------------------------------------------------------
// Streaming area-average resampler (device rate -> 16 kHz)
// ---------------------------------------------------------------------------------------------

struct Resampler {
    ratio: f64,
    buf: Vec<f32>,
    pos: f64,
}

impl Resampler {
    fn new(from_rate: u32) -> Self {
        Self {
            ratio: from_rate as f64 / RATE as f64,
            buf: Vec::new(),
            pos: 0.0,
        }
    }

    fn push(&mut self, input: &[f32]) -> Vec<f32> {
        if (self.ratio - 1.0).abs() < 1e-9 {
            return input.to_vec();
        }
        self.buf.extend_from_slice(input);
        let mut out = Vec::new();
        while self.pos + self.ratio <= self.buf.len() as f64 {
            let (a, b) = (self.pos, self.pos + self.ratio);
            let mut sum = 0.0f64;
            let mut i = a.floor() as usize;
            while (i as f64) < b {
                let overlap = b.min(i as f64 + 1.0) - a.max(i as f64);
                sum += self.buf[i] as f64 * overlap;
                i += 1;
            }
            out.push((sum / self.ratio) as f32);
            self.pos = b;
        }
        let drop = (self.pos.floor() as usize).min(self.buf.len());
        self.buf.drain(..drop);
        self.pos -= drop as f64;
        out
    }
}

// ---------------------------------------------------------------------------------------------
// Session runtime
// ---------------------------------------------------------------------------------------------

struct Shared {
    emit: Emit,
    listening: AtomicBool,
    in_speech: AtomicBool,
    pending: AtomicUsize,
    last: Mutex<&'static str>,
}

impl Shared {
    fn set(&self, state: &'static str, error: Option<&str>) {
        let mut last = self.last.lock().unwrap_or_else(|p| p.into_inner());
        if *last == state && error.is_none() {
            return;
        }
        *last = state;
        eprintln!(
            "voice.call.state state={state}{}",
            error.map(|e| format!(" error={e}")).unwrap_or_default()
        );
        let payload = match error {
            Some(e) => json!({ "state": state, "error": e }),
            None => json!({ "state": state }),
        };
        (self.emit)("voice-call://state", payload);
    }

    fn refresh(&self) {
        let state = if !self.listening.load(Ordering::SeqCst) {
            "paused"
        } else if self.in_speech.load(Ordering::SeqCst) {
            "speech"
        } else if self.pending.load(Ordering::SeqCst) > 0 {
            "transcribing"
        } else {
            "listening"
        };
        self.set(state, None);
    }

    fn fail(&self, msg: &str) {
        eprintln!("voice.call.error error={msg}");
        self.set("error", Some(msg));
    }
}

struct Session {
    id: u64,
    stop: Arc<AtomicBool>,
    shared: Arc<Shared>,
    join: JoinHandle<()>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

fn lock() -> std::sync::MutexGuard<'static, Option<Session>> {
    SESSION.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn is_active() -> bool {
    lock().is_some()
}

enum Msg {
    Audio(Vec<f32>),
    Failed(String),
}

fn map_err(context: &str, e: impl std::fmt::Display) -> String {
    let text = e.to_string();
    let lower = text.to_lowercase();
    if lower.contains("permission") || lower.contains("denied") || lower.contains("not authorized")
    {
        MIC_DENIED.to_string()
    } else {
        format!("{context}: {text}")
    }
}

fn open_stream(tx: mpsc::Sender<Msg>) -> Result<(cpal::Stream, u32), String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("No microphone found — connect an input device and try again")?;
    let config = device
        .default_input_config()
        .map_err(|e| map_err("Could not read microphone settings", e))?;
    let rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let cfg = config.config();
    let err_tx = tx.clone();
    let on_err = move |e: cpal::StreamError| {
        let _ = err_tx.send(Msg::Failed(format!("Microphone stream failed: {e}")));
    };
    macro_rules! input {
        ($t:ty) => {{
            let tx = tx.clone();
            device.build_input_stream(
                &cfg,
                move |data: &[$t], _| {
                    let mono: Vec<f32> = data
                        .chunks(channels.max(1))
                        .map(|f| {
                            f.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / f.len() as f32
                        })
                        .collect();
                    let _ = tx.send(Msg::Audio(mono));
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
    stream
        .play()
        .map_err(|e| map_err("Could not start the microphone", e))?;
    Ok((stream, rate))
}

pub fn start(
    root: &Path,
    emit: Emit,
    silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
) -> Result<(), String> {
    let mut guard = lock();
    if guard.is_some() {
        return Err("A voice call is already running".into());
    }
    if super::recorder::is_recording() {
        return Err("Dictation is recording — finish it before starting a voice call".into());
    }
    super::ready(root)?;
    let cfg = VadConfig::new(
        silence_ms.unwrap_or(1000).clamp(200, 10_000),
        min_speech_ms.unwrap_or(400).clamp(100, 5_000),
    );
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Shared {
        emit,
        listening: AtomicBool::new(true),
        in_speech: AtomicBool::new(false),
        pending: AtomicUsize::new(0),
        last: Mutex::new("idle"),
    });
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let (t_stop, t_shared, t_root) = (stop.clone(), shared.clone(), root.to_path_buf());
    let join = std::thread::Builder::new()
        .name("voice-call".into())
        .spawn(move || run(id, t_root, cfg, t_stop, t_shared, ready_tx))
        .map_err(|e| format!("Could not start voice call thread: {e}"))?;
    match ready_rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            let _ = join.join();
            eprintln!("voice.call.start_failed error={e}");
            return Err(e);
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            return Err("Timed out opening the microphone".into());
        }
    }
    super::transcribe::warm(root);
    eprintln!(
        "voice.call.start silence_ms={} min_speech_ms={}",
        cfg.silence_ms, cfg.min_speech_ms
    );
    shared.refresh();
    *guard = Some(Session {
        id,
        stop,
        shared,
        join,
    });
    Ok(())
}

pub fn stop() -> Result<(), String> {
    let taken = lock().take();
    if let Some(s) = taken {
        s.stop.store(true, Ordering::SeqCst);
        let _ = s.join.join();
        eprintln!("voice.call.stop");
        s.shared.set("idle", None);
    }
    Ok(())
}

pub fn set_listening(listening: bool) -> Result<(), String> {
    let guard = lock();
    let s = guard.as_ref().ok_or("No voice call is running")?;
    s.shared.listening.store(listening, Ordering::SeqCst);
    if !listening {
        s.shared.in_speech.store(false, Ordering::SeqCst);
    }
    s.shared.refresh();
    Ok(())
}

struct Job {
    id: u64,
    samples: Vec<f32>,
    duration_ms: u64,
}

fn run(
    id: u64,
    root: PathBuf,
    cfg: VadConfig,
    stop: Arc<AtomicBool>,
    shared: Arc<Shared>,
    ready_tx: mpsc::Sender<Result<(), String>>,
) {
    let (tx, rx) = mpsc::channel::<Msg>();
    let (stream, rate) = match open_stream(tx) {
        Ok(v) => v,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };
    let _ = ready_tx.send(Ok(()));

    // Transcription never runs on the capture loop; jobs are processed strictly in order.
    let (job_tx, job_rx) = mpsc::channel::<Job>();
    let (w_stop, w_shared, w_root) = (stop.clone(), shared.clone(), root);
    let worker = std::thread::Builder::new().name("voice-call-transcribe".into()).spawn(move || {
        while let Ok(job) = job_rx.recv() {
            let result = if w_stop.load(Ordering::SeqCst) { None } else { Some(super::transcribe::transcribe_samples(&w_root, &job.samples)) };
            let mut failed = false;
            match result {
                None => {}
                Some(Ok(t)) => {
                    let text = t.text.trim();
                    if text.is_empty() {
                        eprintln!("voice.call.segment_skipped reason=empty id={} duration_ms={}", job.id, job.duration_ms);
                    } else if is_hallucination(text) {
                        eprintln!("voice.call.segment_skipped reason=hallucination id={} text={text:?}", job.id);
                    } else if !w_stop.load(Ordering::SeqCst) {
                        eprintln!("voice.call.segment id={} duration_ms={} chars={}", job.id, job.duration_ms, text.chars().count());
                        (w_shared.emit)("voice-call://segment", json!({ "id": job.id, "text": text, "durationMs": job.duration_ms }));
                    }
                }
                Some(Err(e)) => {
                    failed = true;
                    w_shared.pending.fetch_sub(1, Ordering::SeqCst);
                    w_shared.fail(&format!("Transcription failed: {e}"));
                }
            }
            if !failed {
                w_shared.pending.fetch_sub(1, Ordering::SeqCst);
                if !w_stop.load(Ordering::SeqCst) { w_shared.refresh(); }
            }
        }
    });

    let mut seg = Segmenter::new(cfg);
    let mut resampler = Resampler::new(rate);
    let mut next_id = 1u64;
    let (mut raw_total, mut raw_nonzero) = (0usize, false);
    let mut was_listening = true;
    let fatal = |msg: String| {
        shared.fail(&msg);
        let mut g = lock();
        if g.as_ref().map(|s| s.id == id).unwrap_or(false) {
            // Self-teardown: leave the error state visible; a later start() works again.
            *g = None;
        }
    };
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let audio = match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Msg::Audio(a)) => a,
            Ok(Msg::Failed(e)) => {
                fatal(e);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                fatal("Microphone stream ended unexpectedly".into());
                break;
            }
        };
        raw_total += audio.len();
        raw_nonzero |= audio.iter().any(|s| *s != 0.0);
        // macOS delivers exact digital silence when the app lacks microphone permission.
        if !raw_nonzero && raw_total >= rate as usize * 2 {
            fatal(MIC_DENIED.into());
            break;
        }
        let listening = shared.listening.load(Ordering::SeqCst);
        if !listening {
            was_listening = false;
            continue;
        }
        if !was_listening {
            seg.reset();
            resampler = Resampler::new(rate);
            was_listening = true;
            continue; // this chunk may hold the tail of whatever was playing
        }
        for ev in seg.feed(&resampler.push(&audio)) {
            match ev {
                VadEvent::SpeechStart { at_ms } => {
                    eprintln!("voice.call.speech_start at_ms={at_ms}");
                    (shared.emit)("voice-call://speech-start", json!({ "atMs": at_ms }));
                }
                VadEvent::Segment {
                    samples,
                    duration_ms,
                } => {
                    let sid = next_id;
                    next_id += 1;
                    shared.pending.fetch_add(1, Ordering::SeqCst);
                    if job_tx
                        .send(Job {
                            id: sid,
                            samples,
                            duration_ms,
                        })
                        .is_err()
                    {
                        shared.pending.fetch_sub(1, Ordering::SeqCst);
                        fatal("Transcription worker stopped unexpectedly".into());
                    }
                }
            }
        }
        if seg.in_speech() != shared.in_speech.swap(seg.in_speech(), Ordering::SeqCst)
            || !seg.in_speech()
        {
            shared.refresh();
        }
    }
    drop(stream);
    drop(job_tx);
    drop(worker);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> VadConfig {
        VadConfig::new(1000, 400)
    }
    fn silence(ms: usize) -> Vec<f32> {
        (0..ms * 16)
            .map(|i| if i % 2 == 0 { 0.0005 } else { -0.0005 })
            .collect()
    }
    fn speech(ms: usize) -> Vec<f32> {
        (0..ms * 16).map(|i| 0.1 * (i as f32 * 0.2).sin()).collect()
    }
    fn run(parts: &[Vec<f32>]) -> Vec<VadEvent> {
        let mut s = Segmenter::new(cfg());
        let mut out = Vec::new();
        for p in parts {
            for chunk in p.chunks(1600) {
                out.extend(s.feed(chunk));
            }
        }
        out
    }
    fn segments(ev: &[VadEvent]) -> Vec<&Vec<f32>> {
        ev.iter()
            .filter_map(|e| {
                if let VadEvent::Segment { samples, .. } = e {
                    Some(samples)
                } else {
                    None
                }
            })
            .collect()
    }
    fn starts(ev: &[VadEvent]) -> usize {
        ev.iter()
            .filter(|e| matches!(e, VadEvent::SpeechStart { .. }))
            .count()
    }

    #[test]
    fn silence_produces_nothing() {
        assert!(run(&[silence(5000)]).is_empty());
    }

    #[test]
    fn short_burst_does_not_start_speech() {
        let ev = run(&[silence(1000), speech(200), silence(2000)]);
        assert!(ev.is_empty(), "{ev:?}");
    }

    #[test]
    fn speech_then_silence_yields_one_segment_with_preroll() {
        let ev = run(&[silence(1000), speech(1000), silence(1500)]);
        assert_eq!(starts(&ev), 1);
        let segs = segments(&ev);
        assert_eq!(segs.len(), 1);
        // 300 ms pre-roll + 1 s speech + 200 ms kept tail
        let n = segs[0].len();
        assert!(
            (16_000 + 4_800..=16_000 + 4_800 + 3_200 + 320).contains(&n),
            "len {n}"
        );
        // pre-roll is quiet, then speech follows
        assert!(segs[0][..4_000].iter().all(|s| s.abs() < 0.01));
        assert!(segs[0][4_800..5_600].iter().any(|s| s.abs() > 0.05));
    }

    #[test]
    fn short_pause_keeps_one_segment() {
        let ev = run(&[
            silence(1000),
            speech(800),
            silence(300),
            speech(800),
            silence(1500),
        ]);
        assert_eq!(starts(&ev), 1);
        assert_eq!(segments(&ev).len(), 1);
    }

    #[test]
    fn long_silence_splits_segments() {
        let ev = run(&[
            silence(500),
            speech(800),
            silence(1500),
            speech(800),
            silence(1500),
        ]);
        assert_eq!((starts(&ev), segments(&ev).len()), (2, 2));
    }

    #[test]
    fn force_cuts_at_sixty_seconds() {
        let ev = run(&[silence(500), speech(65_000), silence(1500)]);
        let segs = segments(&ev);
        assert_eq!(segs.len(), 2);
        assert!(segs[0].len() >= 60 * 16_000 && segs[0].len() <= 60 * 16_000 + 640);
        assert_eq!(starts(&ev), 1);
    }

    #[test]
    fn reset_drops_partial_segment() {
        let mut s = Segmenter::new(cfg());
        s.feed(&silence(500));
        s.feed(&speech(800));
        assert!(s.in_speech());
        s.reset();
        assert!(!s.in_speech());
        assert!(s.feed(&silence(2000)).is_empty());
    }

    #[test]
    fn filters_whisper_hallucinations() {
        for t in [
            "Thank you.",
            "Thanks for watching!",
            "[BLANK_AUDIO]",
            "you",
            " You. ",
            "Thank you for watching.",
            "",
        ] {
            assert!(is_hallucination(t), "{t:?}");
        }
        for t in [
            "Thank you for the summary",
            "open the settings",
            "you there?",
        ] {
            assert!(!is_hallucination(t), "{t:?}");
        }
    }

    #[test]
    fn resampler_downsamples_streaming() {
        let mut r = Resampler::new(48_000);
        let input = vec![0.5f32; 4800];
        let mut out = r.push(&input[..1000]);
        out.extend(r.push(&input[1000..]));
        assert!((out.len() as i64 - 1600).abs() <= 1, "{}", out.len());
        assert!(out.iter().all(|v| (v - 0.5).abs() < 1e-5));
    }
}
