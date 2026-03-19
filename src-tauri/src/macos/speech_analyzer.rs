mod ffi {
    use std::os::raw::c_char;
    extern "C" {
        pub fn apple_speech_available() -> bool;
        pub fn apple_speech_auth_status() -> i32;
        pub fn request_speech_recognition_permission() -> bool;
        pub fn check_microphone_permission() -> bool;
        pub fn request_microphone_permission() -> bool;
        pub fn apple_transcribe_buffer(
            samples: *const f32,
            count: i32,
            sample_rate: i32,
            context: *mut std::os::raw::c_void,
            callback: extern "C" fn(*mut std::os::raw::c_void, *const c_char, i64, i64, bool),
        ) -> i32;
    }
}

/// Zero-sized engine — holds no state. Safe to send across threads.
pub struct SpeechAnalyzerEngine;

unsafe impl Send for SpeechAnalyzerEngine {}

/// Check microphone permission status without requesting it.
/// Returns true only if already authorized.
pub fn check_microphone_permission() -> bool {
    unsafe { ffi::check_microphone_permission() }
}

/// Request microphone permission via AVCaptureDevice (proper macOS TCC path).
/// Blocks until the user responds to the system dialog.
pub fn request_microphone_permission() -> bool {
    unsafe { ffi::request_microphone_permission() }
}

/// Returns the current Speech Recognition auth status:
/// "authorized" | "not_determined" | "denied"
pub fn apple_speech_auth_status() -> &'static str {
    match unsafe { ffi::apple_speech_auth_status() } {
        0 => "authorized",
        1 => "not_determined",
        _ => "denied",
    }
}

/// Request the Speech Recognition system permission dialog.
/// Blocks until the user responds. Returns true if granted.
pub fn request_speech_recognition_permission() -> bool {
    unsafe { ffi::request_speech_recognition_permission() }
}

impl SpeechAnalyzerEngine {
    /// Returns true when Apple Speech permission is authorized and a recognizer is available.
    pub fn is_available() -> bool {
        unsafe { ffi::apple_speech_available() }
    }

    /// Transcribe 16kHz mono Float32 PCM audio.
    /// Blocks until all segments are returned via the Swift callback.
    ///
    /// # Concurrency
    /// This function is sound only because `apple_transcribe_buffer` is synchronous:
    /// the Swift shim uses `DispatchSemaphore.wait()` to block the calling thread until
    /// all callbacks have fired before returning. The raw `segments_ptr` passed as
    /// context is a live exclusive borrow — no other reference to `segments` exists
    /// while callbacks can fire.
    ///
    /// **Do not change the Swift shim to call back asynchronously** — that would
    /// allow `segment_callback` to write through `segments_ptr` after `transcribe`
    /// returns, causing undefined behaviour.
    ///
    /// DispatchSemaphore also provides acquire/release semantics on Apple platforms,
    /// so after the FFI call returns, all callback writes are visible without an
    /// additional fence.
    pub fn transcribe(&self, audio: &[f32]) -> anyhow::Result<Vec<crate::whisper::engine::Segment>> {
        use std::os::raw::c_void;
        use std::ffi::CStr;

        let mut segments: Vec<crate::whisper::engine::Segment> = Vec::new();
        let segments_ptr: *mut Vec<_> = &mut segments;

        extern "C" fn segment_callback(
            context: *mut c_void,
            text: *const std::os::raw::c_char,
            start_ms: i64,
            end_ms: i64,
            is_final: bool,
        ) {
            if text.is_null() || context.is_null() { return; }
            let text = unsafe { CStr::from_ptr(text) }
                .to_string_lossy()
                .into_owned();
            let out = unsafe { &mut *(context as *mut Vec<crate::whisper::engine::Segment>) };
            out.push(crate::whisper::engine::Segment { text, start_ms, end_ms, is_final });
        }

        let count = i32::try_from(audio.len())
            .map_err(|_| anyhow::anyhow!("audio buffer too large for Apple speech API"))?;
        let result = unsafe {
            ffi::apple_transcribe_buffer(
                audio.as_ptr(),
                count,
                16000,
                segments_ptr as *mut c_void,
                segment_callback,
            )
        };

        if result == 0 {
            Ok(segments)
        } else {
            anyhow::bail!("Apple speech transcription failed (error code {})", result)
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn is_available_returns_bool_without_panic() {
        // On macOS < 26 this returns false without crashing.
        // Either result is acceptable — the test verifies no panic.
        // NOTE: This test requires the Swift shim to be linked.
        // It will fail at link time until speech_analyzer.swift is compiled (Task 6).
        // That is expected — this test is verified end-to-end in Task 8.
        let _result = super::SpeechAnalyzerEngine::is_available();
    }
}
