import Foundation
import Speech
import AVFoundation

// MARK: - Authorization

/// Returns true only when running inside a proper .app bundle that contains
/// NSSpeechRecognitionUsageDescription in its Info.plist.
///
/// Two checks are required:
/// 1. Bundle.main must have a bundle identifier — raw dev binaries have none.
/// 2. The usage description key must be present in the bundle's Info.plist.
///
/// Both are necessary because macOS's TCC daemon (tccd) reads the Info.plist
/// from the .app bundle directory on disk, not from the binary's __info_plist section.
/// Calling requestAuthorization without a bundle causes tccd to crash with
/// __TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__ even if Bundle.main can read the key
/// via an embedded section.
private func hasSpeechUsageDescription() -> Bool {
    guard Bundle.main.bundleIdentifier != nil else { return false }
    return Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") != nil
}

/// Ensures the app has speech recognition authorization.
/// Blocks the calling thread until the user responds (first call only).
/// Returns true if authorized, false if denied, restricted, or usage description is missing.
private func ensureAuthorized() -> Bool {
    guard hasSpeechUsageDescription() else { return false }
    let status = SFSpeechRecognizer.authorizationStatus()
    switch status {
    case .authorized:
        return true
    case .notDetermined:
        let sema = DispatchSemaphore(value: 0)
        var granted = false
        SFSpeechRecognizer.requestAuthorization { newStatus in
            granted = newStatus == .authorized
            sema.signal()
        }
        sema.wait()
        return granted
    case .denied, .restricted:
        return false
    @unknown default:
        return false
    }
}

// MARK: - C-compatible exports

/// Returns true when Apple on-device speech recognition is available.
/// Does NOT request authorization — only checks the current status.
/// Authorization is requested lazily on the first call to apple_transcribe_buffer.
@_cdecl("apple_speech_available")
public func appleSpeechAvailable() -> Bool {
    guard hasSpeechUsageDescription() else { return false }
    // Only report available when the user has already explicitly granted permission.
    // Returning true for .notDetermined would cause "auto" engine selection to pick
    // Apple Speech on first launch, then trigger the TCC dialog from a background
    // thread during the first transcription — before the user has a chance to see
    // or understand the prompt. New users fall through to Whisper instead, and can
    // enable Apple Speech in Settings after granting the permission there.
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else { return false }
    guard let recognizer = SFSpeechRecognizer() else { return false }
    return recognizer.isAvailable
}

/// Transcribes a buffer of 16kHz mono float32 audio samples using Apple's on-device Speech framework.
///
/// - Parameters:
///   - samples: Pointer to f32 PCM audio (16kHz mono)
///   - count: Number of samples
///   - sampleRate: Audio sample rate (should be 16000)
///   - context: Opaque pointer passed through to the callback unchanged
///   - callback: Called once with the final transcription segment (context, text, startMs, endMs, isFinal)
///
/// - Returns: 0 on success, negative on error.
///
/// # Concurrency
/// This function blocks the calling thread until recognition completes. The callback is
/// invoked synchronously from within the DispatchSemaphore.wait() call before this
/// function returns, so `context` is guaranteed valid throughout.
@_cdecl("apple_transcribe_buffer")
public func appleTranscribeBuffer(
    _ samples: UnsafePointer<Float>,
    _ count: Int32,
    _ sampleRate: Int32,
    _ context: UnsafeMutableRawPointer?,
    _ callback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, Int64, Int64, Bool) -> Void
) -> Int32 {
    guard ensureAuthorized() else { return -1 }
    guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { return -2 }

    // Build AVAudioPCMBuffer from the raw f32 samples
    guard let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: Double(sampleRate),
        channels: 1,
        interleaved: false
    ) else { return -3 }

    guard let pcmBuffer = AVAudioPCMBuffer(
        pcmFormat: format,
        frameCapacity: AVAudioFrameCount(count)
    ) else { return -3 }

    pcmBuffer.frameLength = AVAudioFrameCount(count)
    if let channelData = pcmBuffer.floatChannelData {
        channelData[0].update(from: samples, count: Int(count))
    }

    // Configure for on-device, single-shot (non-streaming) recognition
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.append(pcmBuffer)
    request.endAudio()

    // Bridge the async recognition callback to a synchronous return
    let sema = DispatchSemaphore(value: 0)
    var resultCode: Int32 = 0

    recognizer.recognitionTask(with: request) { result, error in
        if let error = error {
            let nsErr = error as NSError
            // Code 203 = "Retry" / no speech detected — treat as empty (success, no callback)
            if nsErr.code != 203 {
                resultCode = -4
            }
            sema.signal()
            return
        }

        guard let result = result, result.isFinal else { return }

        let text = result.bestTranscription.formattedString
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if !text.isEmpty {
            let durationMs = Int64(Double(count) / Double(sampleRate) * 1000)
            text.withCString { cStr in
                callback(context, cStr, 0, durationMs, true)
            }
        }

        sema.signal()
    }

    sema.wait()
    return resultCode
}
