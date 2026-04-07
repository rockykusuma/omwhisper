//! Safe Rust wrapper around the Moonshine Voice C API.
//!
//! Exposes `MoonshineEngine` with the same `transcribe()` signature as
//! `WhisperEngine` so it can be used as a drop-in alternative via the
//! `TranscriptionEngine` enum.

use super::ffi;
use crate::whisper::engine::Segment;
use anyhow::{Context, Result, bail};
use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::path::Path;

pub struct MoonshineEngine {
    handle: i32,
}

// SAFETY: MoonshineEngine is used single-threaded within the transcription
// thread, matching the same pattern as WhisperEngine.  The Moonshine C API
// is documented as thread-safe for concurrent transcribers; we use only one
// handle per instance and never share it across threads simultaneously.
unsafe impl Send for MoonshineEngine {}

impl MoonshineEngine {
    /// Create a new engine by loading models from `model_path`.
    ///
    /// `model_arch` should be one of the `MOONSHINE_MODEL_ARCH_*` constants,
    /// e.g. `ffi::MOONSHINE_MODEL_ARCH_TINY` or
    /// `ffi::MOONSHINE_MODEL_ARCH_MEDIUM_STREAMING`.
    pub fn new(model_path: &Path, model_arch: i32) -> Result<Self> {
        let path_str = model_path
            .to_str()
            .context("moonshine model path is not valid UTF-8")?;
        let path_cstr = CString::new(path_str).context("model path contains null byte")?;

        let handle = unsafe {
            ffi::moonshine_load_transcriber_from_files(
                path_cstr.as_ptr(),
                model_arch as u32,
                std::ptr::null(), // no custom options for spike
                0,
                ffi::MOONSHINE_HEADER_VERSION,
            )
        };

        if handle < 0 {
            let msg = unsafe {
                let ptr = ffi::moonshine_error_to_string(handle);
                if ptr.is_null() {
                    format!("error code {handle}")
                } else {
                    CStr::from_ptr(ptr).to_string_lossy().into_owned()
                }
            };
            bail!("Failed to load Moonshine transcriber: {msg}");
        }

        tracing::info!(
            "Moonshine transcriber loaded (handle={handle}, arch={model_arch}, path={})",
            path_str
        );

        Ok(Self { handle })
    }

    /// Transcribe a chunk of 16 kHz mono f32 audio.
    ///
    /// Signature matches `WhisperEngine::transcribe` for drop-in compatibility
    /// with `TranscriptionEngine`. `language`, `translate_to_english`,
    /// `initial_prompt` and `word_replacements` are accepted but ignored —
    /// Moonshine handles language internally and the spike doesn't wire those.
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

        let mut transcript_ptr: *mut ffi::Transcript = std::ptr::null_mut();

        // moonshine_transcribe_without_streaming takes a *mut float, but the
        // C API only reads the data — the mut is a quirk of the C signature.
        let audio_mut_ptr = audio.as_ptr() as *mut f32;

        let err = unsafe {
            ffi::moonshine_transcribe_without_streaming(
                self.handle,
                audio_mut_ptr,
                audio.len() as u64,
                16000, // OmWhisper always feeds 16 kHz mono
                ffi::MOONSHINE_FLAG_NONE,
                &mut transcript_ptr,
            )
        };

        if err != ffi::MOONSHINE_ERROR_NONE {
            let msg = unsafe {
                let ptr = ffi::moonshine_error_to_string(err);
                if ptr.is_null() {
                    format!("error code {err}")
                } else {
                    CStr::from_ptr(ptr).to_string_lossy().into_owned()
                }
            };
            bail!("Moonshine transcription failed: {msg}");
        }

        if transcript_ptr.is_null() {
            return Ok(vec![]);
        }

        let transcript = unsafe { &*transcript_ptr };
        let mut segments = Vec::with_capacity(transcript.line_count as usize);

        for i in 0..transcript.line_count as isize {
            let line = unsafe { &*transcript.lines.offset(i) };

            if line.text.is_null() {
                continue;
            }

            let text = unsafe { CStr::from_ptr(line.text) }
                .to_string_lossy()
                .trim()
                .to_string();

            if text.is_empty() {
                continue;
            }

            let start_ms = (line.start_time * 1000.0) as i64;
            let end_ms = ((line.start_time + line.duration) * 1000.0) as i64;

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

impl Drop for MoonshineEngine {
    fn drop(&mut self) {
        if self.handle >= 0 {
            unsafe {
                ffi::moonshine_free_transcriber(self.handle);
            }
            tracing::debug!("Moonshine transcriber freed (handle={})", self.handle);
        }
    }
}
