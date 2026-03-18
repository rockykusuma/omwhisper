import Foundation
import Speech
import AVFoundation

// MARK: - Authorization

/// Ensures the app has speech recognition authorization.
/// Blocks the calling thread until the user responds (first call only).
/// Returns true if authorized, false if denied or restricted.
private func ensureAuthorized() -> Bool {
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

/// Returns true when Apple on-device speech recognition is available and authorized.
/// Requests authorization on first call if status is not yet determined.
@_cdecl("apple_speech_available")
public func appleSpeechAvailable() -> Bool {
    guard ensureAuthorized() else { return false }
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
