use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct WhisperEngine {
    ctx: WhisperContext,
    #[allow(dead_code)]
    model_path: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Segment {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub is_final: bool,
}

impl WhisperEngine {
    pub fn new(model_path: &Path) -> Result<Self> {
        let mut ctx_params = WhisperContextParameters::default();
        #[cfg(target_os = "macos")]
        ctx_params.use_gpu(true);
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().context("invalid model path")?,
            ctx_params,
        )
        .context("failed to load whisper model")?;

        Ok(Self {
            ctx,
            model_path: model_path.to_path_buf(),
        })
    }

    pub fn transcribe(
        &self,
        audio: &[f32],
        language: &str,
        translate_to_english: bool,
        initial_prompt: Option<&str>,
        word_replacements: &HashMap<String, String>,
    ) -> Result<Vec<Segment>> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        let lang = if language == "auto" { None } else { Some(language) };
        params.set_language(lang);
        if translate_to_english {
            params.set_translate(true);
        }
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        if let Some(prompt) = initial_prompt {
            if !prompt.is_empty() {
                params.set_initial_prompt(prompt);
            }
        }

        let mut state = self.ctx.create_state().context("failed to create whisper state")?;
        state.full(params, audio).context("whisper inference failed")?;

        let num_segments = state.full_n_segments().context("failed to get segment count")?;
        let mut segments = Vec::new();

        for i in 0..num_segments {
            let text = state.full_get_segment_text(i).context("failed to get segment text")?;
            let start_ms = state.full_get_segment_t0(i).context("failed to get t0")? * 10;
            let end_ms = state.full_get_segment_t1(i).context("failed to get t1")? * 10;

            let text = apply_replacements(text.trim(), word_replacements);
            segments.push(Segment {
                text,
                start_ms,
                end_ms,
                is_final: true,
            });
        }

        Ok(segments)
    }
}

fn apply_replacements(text: &str, replacements: &HashMap<String, String>) -> String {
    if replacements.is_empty() {
        return text.to_string();
    }
    let mut result = text.to_string();
    for (from, to) in replacements {
        // Case-insensitive whole-word replacement
        let pattern = format!("(?i)\\b{}\\b", regex_escape(from));
        if let Ok(re) = regex::Regex::new(&pattern) {
            result = re.replace_all(&result, to.as_str()).to_string();
        }
    }
    result
}

fn regex_escape(s: &str) -> String {
    s.chars().fold(String::new(), |mut acc, c| {
        if "\\^$.|?*+()[]{}".contains(c) {
            acc.push('\\');
        }
        acc.push(c);
        acc
    })
}

/// Read a WAV file and return 16kHz mono f32 samples.
pub fn load_wav_as_f32(path: &Path) -> Result<Vec<f32>> {
    let mut reader = hound::WavReader::open(path).context("failed to open wav file")?;
    let spec = reader.spec();

    let samples_i16: Vec<i16> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.context("wav read error"))
            .collect::<Result<Vec<_>>>()?,
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|s| s.map(|v| (v * 32767.0) as i16).context("wav read error"))
            .collect::<Result<Vec<_>>>()?,
    };

    // Convert to mono
    let channels = spec.channels as usize;
    let mono: Vec<i16> = if channels == 1 {
        samples_i16
    } else {
        samples_i16
            .chunks(channels)
            .map(|ch| (ch.iter().map(|&s| s as i32).sum::<i32>() / channels as i32) as i16)
            .collect()
    };

    // Convert to f32 in [-1, 1]
    let mut f32_samples: Vec<f32> = mono.iter().map(|&s| s as f32 / 32767.0).collect();

    // Resample to 16kHz if needed
    let src_rate = spec.sample_rate;
    if src_rate != 16000 {
        f32_samples = resample_to_16k(&f32_samples, src_rate, 16000);
    }

    Ok(f32_samples)
}

fn resample_to_16k(samples: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    let ratio = src_rate as f64 / dst_rate as f64;
    let new_len = (samples.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let pos = i as f64 * ratio;
        let idx = pos as usize;
        let frac = (pos - idx as f64) as f32;
        let a = samples.get(idx).copied().unwrap_or(0.0);
        let b = samples.get(idx + 1).copied().unwrap_or(0.0);
        out.push(a + frac * (b - a));
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── regex_escape ──────────────────────────────────────────────────────────

    #[test]
    fn regex_escape_plain_word_unchanged() {
        assert_eq!(regex_escape("hello"), "hello");
    }

    #[test]
    fn regex_escape_dot_escaped() {
        assert_eq!(regex_escape("e.g"), "e\\.g");
    }

    #[test]
    fn regex_escape_parens_escaped() {
        assert_eq!(regex_escape("(ok)"), "\\(ok\\)");
    }

    #[test]
    fn regex_escape_multiple_specials() {
        let escaped = regex_escape("a+b*c?");
        assert_eq!(escaped, "a\\+b\\*c\\?");
    }

    // ── apply_replacements ────────────────────────────────────────────────────

    #[test]
    fn empty_map_returns_text_unchanged() {
        let result = apply_replacements("hello world", &HashMap::new());
        assert_eq!(result, "hello world");
    }

    #[test]
    fn simple_whole_word_replacement() {
        let mut map = HashMap::new();
        map.insert("okay".to_string(), "OK".to_string());
        let result = apply_replacements("That is okay with me", &map);
        assert_eq!(result, "That is OK with me");
    }

    #[test]
    fn partial_word_not_replaced() {
        let mut map = HashMap::new();
        map.insert("ok".to_string(), "OK".to_string());
        // "okay" should NOT be replaced — "ok" is not a whole word here
        let result = apply_replacements("That is okay", &map);
        assert_eq!(result, "That is okay");
    }

    #[test]
    fn replacement_is_case_insensitive() {
        let mut map = HashMap::new();
        map.insert("hello".to_string(), "Hi".to_string());
        let result = apply_replacements("HELLO world", &map);
        assert_eq!(result, "Hi world");
    }

    #[test]
    fn multiple_replacements_applied() {
        let mut map = HashMap::new();
        map.insert("um".to_string(), "".to_string());
        map.insert("uh".to_string(), "".to_string());
        let result = apply_replacements("um this is uh great", &map);
        assert!(!result.contains("um"));
        assert!(!result.contains("uh"));
    }

    #[test]
    fn replacement_with_internal_special_chars_escaped() {
        let mut map = HashMap::new();
        // Key starts and ends with word chars so \b works.
        // The dot in the middle must be regex-escaped to match literally.
        map.insert("v1.0".to_string(), "version one".to_string());
        let result = apply_replacements("Running v1.0 of the app", &map);
        assert_eq!(result, "Running version one of the app");
    }

    #[test]
    fn no_match_returns_text_unchanged() {
        let mut map = HashMap::new();
        map.insert("xyz".to_string(), "replaced".to_string());
        let result = apply_replacements("hello world", &map);
        assert_eq!(result, "hello world");
    }

    // ── resample_to_16k ──────────────────────────────────────────────────────

    #[test]
    fn resample_same_rate_is_identity_length() {
        let samples: Vec<f32> = (0..160).map(|i| i as f32 / 160.0).collect();
        let out = resample_to_16k(&samples, 16000, 16000);
        assert_eq!(out.len(), samples.len());
    }

    #[test]
    fn resample_downsample_halves_length() {
        let samples = vec![0.5f32; 320];
        let out = resample_to_16k(&samples, 32000, 16000);
        assert_eq!(out.len(), 160);
    }

    #[test]
    fn resample_upsample_doubles_length() {
        let samples = vec![0.5f32; 80];
        let out = resample_to_16k(&samples, 8000, 16000);
        assert_eq!(out.len(), 160);
    }

    #[test]
    fn resample_dc_signal_preserved() {
        // A constant signal should stay constant after resampling
        let samples = vec![0.5f32; 320];
        let out = resample_to_16k(&samples, 32000, 16000);
        for sample in &out {
            assert!((*sample - 0.5).abs() < 1e-4, "expected ~0.5, got {sample}");
        }
    }

    #[test]
    fn resample_empty_returns_empty() {
        let out = resample_to_16k(&[], 44100, 16000);
        assert!(out.is_empty());
    }
}
