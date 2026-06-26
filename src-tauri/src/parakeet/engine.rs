//! Safe Rust wrapper around `parakeet-rs` (NVIDIA Parakeet TDT, ONNX/CPU).
//!
//! Exposes `ParakeetEngine` with the same `transcribe()` signature as
//! `WhisperEngine`/`MoonshineEngine` so it drops into `TranscriptionEngine`.

use crate::whisper::engine::Segment;
use anyhow::{Context, Result};
use parakeet_rs::{ParakeetTDT, TimestampMode, Transcriber};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

pub struct ParakeetEngine {
    // `transcribe_samples` needs `&mut self`; the shared engine API is `&self`,
    // so we guard the model with a Mutex (also makes the type Send + Sync).
    tdt: Mutex<ParakeetTDT>,
}

// SAFETY: ParakeetTDT wraps `ort` sessions (Send). Used single-threaded within
// the transcription thread; the Mutex serialises access. Mirrors the Send impls
// on WhisperEngine/MoonshineEngine.
unsafe impl Send for ParakeetEngine {}

/// Convert decoded text + sample count into the shared `Segment` shape.
/// Pure helper so the mapping is unit-testable without loading a model.
fn segments_from_text(text: &str, sample_count: usize) -> Vec<Segment> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    // 16kHz mono → 16 samples per millisecond.
    let end_ms = (sample_count / 16) as i64;
    vec![Segment {
        text: text.to_string(),
        start_ms: 0,
        end_ms,
        is_final: true,
    }]
}

impl ParakeetEngine {
    /// Load the model directory (contains `encoder-model.onnx`,
    /// `decoder_joint-model.onnx`, `vocab.txt`). CPU execution provider.
    pub fn new(model_dir: &Path) -> Result<Self> {
        let tdt = ParakeetTDT::from_pretrained(model_dir, None)
            .map_err(|e| anyhow::anyhow!("Failed to load Parakeet model at {model_dir:?}: {e}"))?;
        tracing::info!("Parakeet engine loaded ({model_dir:?})");
        Ok(Self {
            tdt: Mutex::new(tdt),
        })
    }

    /// Transcribe 16kHz mono f32 audio. `language`, `translate_to_english`,
    /// `initial_prompt`, `word_replacements` are accepted for signature
    /// compatibility but unused — Parakeet auto-detects language and does not
    /// translate or accept a prompt.
    pub fn transcribe(
        &self,
        audio: &[f32],
        _language: &str,
        _translate_to_english: bool,
        _initial_prompt: Option<&str>,
        _word_replacements: &HashMap<String, String>,
    ) -> Result<Vec<Segment>> {
        if audio.is_empty() {
            return Ok(vec![]);
        }
        let mut tdt = self.tdt.lock().unwrap_or_else(|e| e.into_inner());
        let result = tdt
            // parakeet-rs takes an owned Vec<f32>.
            .transcribe_samples(audio.to_vec(), 16000, 1, Some(TimestampMode::Sentences))
            .context("Parakeet transcription failed")?;
        Ok(segments_from_text(&result.text, audio.len()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_returns_no_segments() {
        assert!(segments_from_text("", 16_000).is_empty());
        assert!(segments_from_text("   ", 16_000).is_empty());
    }

    #[test]
    fn text_becomes_single_segment_with_duration() {
        let segs = segments_from_text("Hello world.", 32_000); // 2s @16kHz
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].text, "Hello world.");
        assert_eq!(segs[0].start_ms, 0);
        assert_eq!(segs[0].end_ms, 2000);
        assert!(segs[0].is_final);
    }

    #[test]
    fn text_is_trimmed() {
        let segs = segments_from_text("  hi  ", 16_000);
        assert_eq!(segs[0].text, "hi");
    }
}
