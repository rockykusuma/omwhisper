import Foundation
import AVFoundation

// MARK: - Microphone permission

/// Checks microphone permission status WITHOUT requesting it.
/// Returns true only if already authorized; false for denied, restricted, or not determined.
@_cdecl("check_microphone_permission")
public func checkMicrophonePermission() -> Bool {
    return AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
}

/// Returns the microphone authorization status as an integer.
/// 0 = authorized, 1 = notDetermined, 2 = denied/restricted
@_cdecl("get_microphone_auth_status")
public func getMicrophoneAuthStatus() -> Int32 {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:              return 0
    case .notDetermined:           return 1
    case .denied, .restricted:     return 2
    @unknown default:              return 2
    }
}

/// Requests microphone access via AVCaptureDevice (the proper macOS TCC path).
/// Blocks the calling thread until the user responds.
/// Returns true if granted, false if denied or restricted.
@_cdecl("request_microphone_permission")
public func requestMicrophonePermission() -> Bool {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    switch status {
    case .authorized:
        return true
    case .notDetermined:
        let sema = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .audio) { result in
            granted = result
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
