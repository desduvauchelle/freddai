//! Decode WAV / AAC-in-M4A files to 16 kHz mono f32.

use super::resample::resample_to_16k_mono;
use std::{fs::File, path::Path};
use symphonia::core::{
    audio::SampleBuffer, codecs::{DecoderOptions, CODEC_TYPE_NULL}, errors::Error,
    formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

pub fn decode_to_16k_mono(path: &Path) -> Result<Vec<f32>, String> {
    let file = File::open(path).map_err(|e| format!("Could not open audio file: {e}"))?;
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, MediaSourceStream::new(Box::new(file), Default::default()), &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Unsupported or unreadable audio file: {e}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("Audio file has no decodable track")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Unsupported audio codec: {e}"))?;
    let (mut rate, mut channels) = (0u32, 0u16);
    let mut samples: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(format!("Audio read failed: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(buf) => {
                let spec = *buf.spec();
                rate = spec.rate;
                channels = spec.channels.count() as u16;
                let mut sb = SampleBuffer::<f32>::new(buf.capacity() as u64, spec);
                sb.copy_interleaved_ref(buf);
                samples.extend_from_slice(sb.samples());
            }
            Err(Error::DecodeError(_)) => continue, // skip a corrupt packet
            Err(e) => return Err(format!("Audio decode failed: {e}")),
        }
    }
    if samples.is_empty() || rate == 0 || channels == 0 {
        return Err("Audio file contained no audio".into());
    }
    Ok(resample_to_16k_mono(&samples, rate, channels))
}

#[cfg(test)]
pub(crate) fn wav_bytes(rate: u32, channels: u16, samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut b = Vec::new();
    b.extend(b"RIFF");
    b.extend((36 + data_len).to_le_bytes());
    b.extend(b"WAVEfmt ");
    b.extend(16u32.to_le_bytes());
    b.extend(1u16.to_le_bytes());
    b.extend(channels.to_le_bytes());
    b.extend(rate.to_le_bytes());
    b.extend((rate * channels as u32 * 2).to_le_bytes());
    b.extend((channels * 2).to_le_bytes());
    b.extend(16u16.to_le_bytes());
    b.extend(b"data");
    b.extend(data_len.to_le_bytes());
    for s in samples { b.extend(s.to_le_bytes()); }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_small_wav_to_16k_mono() {
        let root = super::super::settings::test_root("wav");
        let p = root.join("a.wav");
        let samples: Vec<i16> = (0..8000).map(|i| ((i as f32 / 20.0).sin() * 8000.0) as i16).collect();
        std::fs::write(&p, wav_bytes(8000, 1, &samples)).unwrap();
        let out = decode_to_16k_mono(&p).unwrap();
        assert!((out.len() as i64 - 16_000).abs() < 512, "got {}", out.len());
        assert!(out.iter().any(|s| s.abs() > 0.1));
        std::fs::write(root.join("bad.wav"), b"nope").unwrap();
        assert!(decode_to_16k_mono(&root.join("bad.wav")).is_err());
    }
}
