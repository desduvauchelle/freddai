//! Static registry of downloadable Whisper models (ggml, pinned HF revision).

pub struct ModelDef {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub language_label: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    pub recommended: bool,
}

#[cfg(test)]
const REV: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";

pub static MODELS: &[ModelDef] = &[
    ModelDef {
        id: "whisper-turbo-q5",
        name: "Whisper Turbo Q5",
        description: "Best balance: near large-model accuracy, fast on Apple silicon",
        language_label: "Multilingual",
        file: "ggml-large-v3-turbo-q5_0.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin",
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        size_bytes: 574_041_195,
        recommended: true,
    },
    ModelDef {
        id: "whisper-turbo-q8",
        name: "Whisper Turbo Q8",
        description: "Slightly more accurate than Q5, larger download and memory use",
        language_label: "Multilingual",
        file: "ggml-large-v3-turbo-q8_0.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q8_0.bin",
        sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
        size_bytes: 874_188_075,
        recommended: false,
    },
    ModelDef {
        id: "whisper-small",
        name: "Whisper Small",
        description: "Faster and lighter, less accurate on accents and rare words",
        language_label: "Multilingual",
        file: "ggml-small.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin",
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        size_bytes: 487_601_967,
        recommended: false,
    },
    ModelDef {
        id: "whisper-base",
        name: "Whisper Base",
        description: "Smallest and quickest, best for clear speech on slower Macs",
        language_label: "Multilingual",
        file: "ggml-base.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin",
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        size_bytes: 147_951_465,
        recommended: false,
    },
];

pub fn find(id: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|m| m.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ids_unique_one_recommended_urls_pinned() {
        let ids: HashSet<_> = MODELS.iter().map(|m| m.id).collect();
        assert_eq!(ids.len(), MODELS.len());
        assert_eq!(MODELS.iter().filter(|m| m.recommended).count(), 1);
        for m in MODELS {
            assert!(m.url.contains(REV), "{} not pinned", m.id);
            assert!(m.url.ends_with(m.file));
            assert_eq!(m.sha256.len(), 64);
            assert!(m.size_bytes > 0);
        }
        assert!(find("whisper-base").is_some() && find("nope").is_none());
    }
}
