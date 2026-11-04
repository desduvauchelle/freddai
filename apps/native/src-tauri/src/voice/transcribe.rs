//! Lazy-loaded, cached Whisper engine (transcribe-rs / whisper.cpp with Metal).

use super::{download, registry, settings};
use serde::Serialize;
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use transcribe_rs::whisper_cpp::{WhisperEngine, WhisperInferenceParams};

const IDLE_UNLOAD: Duration = Duration::from_secs(300);
const MIN_SAMPLES: usize = 4800; // 0.3 s at 16 kHz

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    pub duration_ms: u64,
    pub model: String,
}

struct Loaded {
    id: String,
    engine: WhisperEngine,
    last_used: Instant,
}

static ENGINE: Mutex<Option<Loaded>> = Mutex::new(None);
static REAPER: OnceLock<()> = OnceLock::new();

fn ensure_reaper() {
    REAPER.get_or_init(|| {
        let _ = std::thread::Builder::new().name("voice-idle-unload".into()).spawn(|| loop {
            std::thread::sleep(Duration::from_secs(30));
            let mut g = ENGINE.lock().unwrap_or_else(|p| p.into_inner());
            if g.as_ref().map(|l| l.last_used.elapsed() > IDLE_UNLOAD).unwrap_or(false) {
                eprintln!("voice.unload reason=idle");
                *g = None;
            }
        });
    });
}

fn load_into(g: &mut Option<Loaded>, root: &Path, id: &str) -> Result<(), String> {
    if g.as_ref().map(|l| l.id == id).unwrap_or(false) {
        return Ok(());
    }
    *g = None;
    let m = registry::find(id).ok_or_else(|| format!("Unknown voice model \"{id}\""))?;
    let started = Instant::now();
    let engine = WhisperEngine::load(&download::model_path(root, m))
        .map_err(|e| format!("Could not load voice model {}: {e}", m.name))?;
    eprintln!("voice.load model={id} elapsed_ms={}", started.elapsed().as_millis());
    *g = Some(Loaded { id: id.to_string(), engine, last_used: Instant::now() });
    ensure_reaper();
    Ok(())
}

/// Load the active model in a background thread so the next transcription is fast.
pub fn warm(root: &Path) {
    let root = root.to_path_buf();
    let _ = std::thread::Builder::new().name("voice-warm".into()).spawn(move || {
        let id = match super::ready(&root) {
            Ok(id) => id,
            Err(_) => return,
        };
        let mut g = ENGINE.lock().unwrap_or_else(|p| p.into_inner());
        if let Err(e) = load_into(&mut g, &root, &id) {
            eprintln!("voice.warm.failed model={id} error={e}");
        }
    });
}

/// Drop the cached engine (e.g. when its model is deleted).
pub fn unload(id: &str) {
    let mut g = ENGINE.lock().unwrap_or_else(|p| p.into_inner());
    if g.as_ref().map(|l| l.id == id).unwrap_or(false) {
        *g = None;
    }
}

/// Drop any cached engine. Idempotent. Call before process exit: ggml-metal asserts in
/// its static destructors if a model is still loaded.
pub fn unload_all() {
    let mut g = ENGINE.lock().unwrap_or_else(|p| p.into_inner());
    *g = None;
}

/// Blocking. `samples` must be 16 kHz mono.
pub fn transcribe_samples(root: &Path, samples: &[f32]) -> Result<Transcript, String> {
    let id = super::ready(root)?;
    let language = settings::load(root)?.language;
    let duration_ms = samples.len() as u64 * 1000 / 16_000;
    if samples.len() < MIN_SAMPLES || rms(samples) < 1e-4 {
        return Ok(Transcript { text: String::new(), duration_ms, model: id });
    }
    let started = Instant::now();
    let params = WhisperInferenceParams {
        language: if language == "auto" || language.is_empty() { None } else { Some(language) },
        ..WhisperInferenceParams::default()
    };
    let text = {
        let mut g = ENGINE.lock().unwrap_or_else(|p| p.into_inner());
        load_into(&mut g, root, &id)?;
        let loaded = g.as_mut().expect("engine loaded");
        let result = loaded
            .engine
            .transcribe_with(samples, &params)
            .map_err(|e| format!("Transcription failed: {e}"))?;
        loaded.last_used = Instant::now();
        result.text.trim().to_string()
    };
    eprintln!(
        "voice.transcribe model={id} audio_ms={duration_ms} elapsed_ms={} chars={}",
        started.elapsed().as_millis(),
        text.chars().count()
    );
    Ok(Transcript { text, duration_ms, model: id })
}

fn rms(s: &[f32]) -> f32 {
    (s.iter().map(|v| v * v).sum::<f32>() / s.len().max(1) as f32).sqrt()
}
