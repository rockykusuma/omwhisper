mod ffi {
    extern "C" {
        pub fn check_microphone_permission() -> bool;
        pub fn get_microphone_auth_status() -> i32;
        pub fn request_microphone_permission() -> bool;
    }
}

/// Check microphone permission status without requesting it.
/// Returns true only if already authorized.
pub fn check_microphone_permission() -> bool {
    unsafe { ffi::check_microphone_permission() }
}

/// Returns microphone auth status: "authorized", "not_determined", or "denied".
pub fn get_microphone_auth_status() -> &'static str {
    match unsafe { ffi::get_microphone_auth_status() } {
        0 => "authorized",
        1 => "not_determined",
        _ => "denied",
    }
}

/// Request microphone permission via AVCaptureDevice (proper macOS TCC path).
/// Blocks until the user responds to the system dialog.
pub fn request_microphone_permission() -> bool {
    unsafe { ffi::request_microphone_permission() }
}
