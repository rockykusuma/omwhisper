use std::collections::HashMap;
use std::path::Path;
use crate::whisper::engine::{WhisperEngine, Segment};

pub enum TranscriptionEngine {
    Whisper(WhisperEngine),
    #[cfg(target_os = "macos")]
    Moonshine(crate::moonshine::engine::MoonshineEngine),
}

impl TranscriptionEngine {
    /// Returns the best available engine for this platform.
    /// `engine_preference` is "whisper" | "moonshine".
    /// Falls back to Whisper if the preferred engine is unavailable.
    pub fn select(model_path: &Path, engine_preference: &str, settings: &crate::settings::Settings) -> anyhow::Result<Self> {
        #[cfg(target_os = "macos")]
        if engine_preference == "moonshine" {
            let variant = &settings.moonshine_model;
            let model_dir = crate::moonshine::models::moonshine_model_dir(variant);
            if !model_dir.exists() {
                tracing::warn!(
                    "Moonshine model '{}' not downloaded — falling back to Whisper. Download it in Settings → AI Models.",
                    variant
                );
            } else {
                let arch = crate::moonshine::models::moonshine_model_arch(variant)
                    .unwrap_or(crate::moonshine::ffi::MOONSHINE_MODEL_ARCH_TINY_STREAMING);
                match crate::moonshine::engine::MoonshineEngine::new(&model_dir, arch) {
                    Ok(engine) => {
                        tracing::info!("Using Moonshine engine ({})", variant);
                        return Ok(TranscriptionEngine::Moonshine(engine));
                    }
                    Err(e) => {
                        tracing::warn!("Moonshine engine failed to load: {e}, falling back to Whisper");
                    }
                }
            }
        }

        tracing::info!("Using Whisper engine");
        Ok(TranscriptionEngine::Whisper(WhisperEngine::new(model_path)?))
    }

    pub fn transcribe(
        &self,
        audio: &[f32],
        language: &str,
        translate_to_english: bool,
        initial_prompt: Option<&str>,
        word_replacements: &HashMap<String, String>,
    ) -> anyhow::Result<Vec<Segment>> {
        match self {
            TranscriptionEngine::Whisper(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Moonshine(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            TranscriptionEngine::Whisper(_) => "whisper",
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Moonshine(_) => "moonshine",
        }
    }
}

// SAFETY: WhisperEngine and MoonshineEngine are Send.
unsafe impl Send for TranscriptionEngine {}
