import Foundation

// MARK: - C-compatible exports

/// Returns true when the Apple speech APIs are available on this OS.
/// On macOS 26+, this returns true. On older systems, returns false.
@_cdecl("apple_speech_available")
public func appleSpeechAvailable() -> Bool {
    if #available(macOS 26, *) {
        return true
    }
    return false
}

/// Transcribes a buffer of 16kHz mono float32 audio samples using the Apple speech framework.
///
/// - Parameters:
///   - samples: Pointer to the audio buffer (f32, 16kHz mono)
///   - count: Number of samples in the buffer
///   - sampleRate: Audio sample rate (should be 16000)
///   - context: Opaque pointer passed through to the callback
///   - callback: Called once per recognized segment with (context, text, startMs, endMs, isFinal)
///
/// - Returns: 0 on success, non-zero on error.
@_cdecl("apple_transcribe_buffer")
public func appleTranscribeBuffer(
    _ samples: UnsafePointer<Float>,
    _ count: Int32,
    _ sampleRate: Int32,
    _ context: UnsafeMutableRawPointer?,
    _ callback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, Int64, Int64, Bool) -> Void
) -> Int32 {
    // TODO(macOS26): Replace this stub with real SpeechAnalyzer API calls once
    // Xcode 26 beta SDK headers are verified. The actual class/method names from
    // the SpeechAnalyzer framework need to be confirmed via:
    //   xcrun --sdk macosx --show-sdk-path
    // then inspect: $SDK/System/Library/Frameworks/SpeechAnalyzer.framework/Headers/
    //
    // Expected implementation pattern:
    //   let analyzer = SpeechAnalyzer(...)
    //   let sema = DispatchSemaphore(value: 0)
    //   analyzer.transcribe(buffer) { result in
    //       // call callback for each segment
    //       sema.signal()
    //   }
    //   sema.wait()
    //   return 0

    // Stub: always report unavailable so Rust falls back to Whisper
    return -1
}
