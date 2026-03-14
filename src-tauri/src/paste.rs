use anyhow::Result;

/// Read the current clipboard text (returns None if empty or non-text).
pub fn read_clipboard() -> Option<String> {
    arboard::Clipboard::new().ok()?.get_text().ok().filter(|s| !s.is_empty())
}

/// Copy text to the system clipboard.
pub fn copy_to_clipboard(text: &str) -> Result<()> {
    let mut clipboard = arboard::Clipboard::new()?;
    clipboard.set_text(text)?;
    Ok(())
}

/// Check if Accessibility permission is granted (macOS only).
#[cfg(target_os = "macos")]
pub fn has_accessibility_permission() -> bool {
    // Use AXIsProcessTrustedWithOptions to check without prompting
    let output = std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get name of first process whose frontmost is true"])
        .output();
    output.map(|o| o.status.success()).unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
pub fn has_accessibility_permission() -> bool {
    false
}

/// Capture the name of the currently frontmost application (macOS only).
#[cfg(target_os = "macos")]
pub fn get_frontmost_app() -> Option<String> {
    let output = std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get name of first process whose frontmost is true"])
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_frontmost_app() -> Option<String> {
    None
}

/// Bring an app to front and paste from clipboard (macOS only).
#[cfg(target_os = "macos")]
pub fn paste_to_app(app_name: &str) -> Result<()> {
    use std::os::raw::{c_int, c_uint, c_void};

    // CoreGraphics types and constants
    type CGEventRef = *mut c_void;
    type CGEventSourceRef = *mut c_void;
    type CGKeyCode = u16;
    type CGEventFlags = u64;
    type CGEventTapLocation = c_uint;

    const K_VK_ANSI_V: CGKeyCode = 0x09;
    const K_CG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 0x00100000;
    const K_CG_HID_EVENT_TAP: CGEventTapLocation = 0;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            virtualKey: CGKeyCode,
            keyDown: c_int,
        ) -> CGEventRef;
        fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
        fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    // Give a brief moment for the recording to fully stop
    std::thread::sleep(std::time::Duration::from_millis(200));

    // Activate target app via osascript (no Accessibility needed for activation)
    let activate_script = format!(
        r#"tell application "{}" to activate"#,
        app_name.replace('"', "\\\"")
    );
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&activate_script)
        .output();

    // Wait for the app to come to front
    std::thread::sleep(std::time::Duration::from_millis(300));

    // Send Cmd+V via raw CGEventPost — works from any thread, no HIToolbox query
    unsafe {
        // Key down
        let event_down = CGEventCreateKeyboardEvent(
            std::ptr::null_mut(),
            K_VK_ANSI_V,
            1, // keyDown = true
        );
        if event_down.is_null() {
            return Err(anyhow::anyhow!("CGEventCreateKeyboardEvent (down) returned null"));
        }
        CGEventSetFlags(event_down, K_CG_EVENT_FLAG_MASK_COMMAND);
        CGEventPost(K_CG_HID_EVENT_TAP, event_down);
        CFRelease(event_down);

        // Key up
        let event_up = CGEventCreateKeyboardEvent(
            std::ptr::null_mut(),
            K_VK_ANSI_V,
            0, // keyDown = false
        );
        if event_up.is_null() {
            return Err(anyhow::anyhow!("CGEventCreateKeyboardEvent (up) returned null"));
        }
        CGEventSetFlags(event_up, K_CG_EVENT_FLAG_MASK_COMMAND);
        CGEventPost(K_CG_HID_EVENT_TAP, event_up);
        CFRelease(event_up);
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn paste_to_app(_app_name: &str) -> Result<()> {
    Ok(())
}

/// Open System Settings to the Accessibility pane.
#[cfg(target_os = "macos")]
pub fn open_accessibility_settings() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

#[cfg(not(target_os = "macos"))]
pub fn open_accessibility_settings() {}
