//! Raw FFI bindings to Moonshine Voice C API.
//! Sourced directly from moonshine-c-api.h (version 2.0.0, MOONSHINE_HEADER_VERSION = 20000).
//!
//! The API uses integer handles (i32) rather than raw pointers — all calls are
//! thread-safe per the header docs, and handle lifetime is managed by
//! moonshine_load_transcriber_from_files / moonshine_free_transcriber.

use std::os::raw::{c_char, c_float, c_int};

/* ─── Constants ─────────────────────────────────────────────────────────── */

pub const MOONSHINE_HEADER_VERSION: c_int = 20000;

pub const MOONSHINE_MODEL_ARCH_TINY: c_int = 0;
pub const MOONSHINE_MODEL_ARCH_BASE: c_int = 1;
pub const MOONSHINE_MODEL_ARCH_TINY_STREAMING: c_int = 2;
pub const MOONSHINE_MODEL_ARCH_BASE_STREAMING: c_int = 3;
pub const MOONSHINE_MODEL_ARCH_SMALL_STREAMING: c_int = 4;
pub const MOONSHINE_MODEL_ARCH_MEDIUM_STREAMING: c_int = 5;

pub const MOONSHINE_ERROR_NONE: c_int = 0;
pub const MOONSHINE_FLAG_NONE: u32 = 0;

/* ─── Data structures ────────────────────────────────────────────────────── */

/// A single word with timing information (only populated when word_timestamps
/// option is enabled — we don't use this in the spike).
#[repr(C)]
pub struct TranscriptWord {
    pub text: *const c_char,
    pub start: c_float,
    pub end: c_float,
    pub confidence: c_float,
}

/// A single "line" of a transcript — roughly a sentence or phrase.
/// Memory is owned by the transcriber and valid until the next call or free.
#[repr(C)]
pub struct TranscriptLine {
    pub text: *const c_char,
    pub audio_data: *const c_float,
    pub audio_data_count: usize,
    pub start_time: c_float,
    pub duration: c_float,
    pub id: u64,
    pub is_complete: i8,
    pub is_updated: i8,
    pub is_new: i8,
    pub has_text_changed: i8,
    pub has_speaker_id: i8,
    pub speaker_id: u64,
    pub speaker_index: u32,
    pub last_transcription_latency_ms: u32,
    pub words: *const TranscriptWord,
    pub word_count: u64,
}

/// The full transcript returned from a transcription call.
#[repr(C)]
pub struct Transcript {
    pub lines: *mut TranscriptLine,
    pub line_count: u64,
}

/// Name/value option pair for advanced transcriber configuration.
#[repr(C)]
pub struct MoonshineOption {
    pub name: *const c_char,
    pub value: *const c_char,
}

/* ─── Functions ─────────────────────────────────────────────────────────── */

extern "C" {
    /// Returns the loaded moonshine library version.
    pub fn moonshine_get_version() -> c_int;

    /// Converts an error code to a human-readable string.
    pub fn moonshine_error_to_string(error: c_int) -> *const c_char;

    /// Loads models from the file system. Returns a non-negative handle on
    /// success, or a negative error code on failure.
    ///
    /// Expects the following files in `path`:
    ///   - encoder_model.ort / encoder.ort  (depends on model arch)
    ///   - decoder_model_merged.ort / decoder_kv.ort + others
    ///   - tokenizer.bin
    pub fn moonshine_load_transcriber_from_files(
        path: *const c_char,
        model_arch: u32,
        options: *const MoonshineOption,
        options_count: u64,
        moonshine_version: c_int,
    ) -> c_int;

    /// Releases all resources used by a transcriber.
    pub fn moonshine_free_transcriber(transcriber_handle: c_int);

    /// Transcribes a complete audio buffer (non-streaming). Best for
    /// pre-segmented chunks — exactly what OmWhisper's VAD produces.
    ///
    /// `audio_data`: 16 kHz mono PCM f32, values in [-1.0, 1.0].
    /// `out_transcript`: filled with a pointer owned by the transcriber;
    ///   valid until the next call to this transcriber or until freed.
    pub fn moonshine_transcribe_without_streaming(
        transcriber_handle: c_int,
        audio_data: *mut c_float,
        audio_length: u64,
        sample_rate: c_int,
        flags: u32,
        out_transcript: *mut *mut Transcript,
    ) -> c_int;
}
