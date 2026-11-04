//! Downmix + resample to 16 kHz mono f32 (rubato sinc).

use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

const TARGET: u32 = 16_000;

pub fn resample_to_16k_mono(samples: &[f32], from_rate: u32, channels: u16) -> Vec<f32> {
    let mono: Vec<f32> = if channels <= 1 {
        samples.to_vec()
    } else {
        let ch = channels as usize;
        samples.chunks_exact(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect()
    };
    if from_rate == TARGET || mono.is_empty() {
        return mono;
    }
    let params = SincInterpolationParameters {
        sinc_len: 64,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };
    let ratio = TARGET as f64 / from_rate as f64;
    match SincFixedIn::<f32>::new(ratio, 1.0, params, mono.len(), 1)
        .map_err(|e| e.to_string())
        .and_then(|mut r| r.process(&[mono.clone()], None).map_err(|e| e.to_string()))
    {
        Ok(mut out) => out.remove(0),
        Err(e) => {
            eprintln!("voice.resample.failed error={e}");
            mono
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereo_48k_one_second_gives_about_16000_samples() {
        let input: Vec<f32> = (0..48_000).flat_map(|i| { let v = (i as f32 / 100.0).sin() * 0.5; [v, v] }).collect();
        let out = resample_to_16k_mono(&input, 48_000, 2);
        assert!((out.len() as i64 - 16_000).abs() < 512, "got {}", out.len());
    }

    #[test]
    fn passthrough_at_16k_mono() {
        let input = vec![0.1f32; 100];
        assert_eq!(resample_to_16k_mono(&input, 16_000, 1), input);
    }
}
