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
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}

#[cfg(target_os = "windows")]
pub fn has_accessibility_permission() -> bool {
    true // Windows does not require Accessibility permission for SendInput
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn has_accessibility_permission() -> bool {
    false
}

/// Returns true if an app name is safe to use (printable ASCII, no shell metacharacters).
#[cfg(target_os = "macos")]
fn is_safe_app_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name.chars().all(|c| c.is_ascii() && !matches!(c, '"' | '\'' | '\\' | '`' | '$' | '\n' | '\r' | '\0'))
}

/// Capture the name of the currently frontmost application (macOS only).
#[cfg(target_os = "macos")]
pub fn get_frontmost_app() -> Option<String> {
    let output = std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get name of first process whose frontmost is true"])
        .output()
        .ok()?;
    if output.status.success() {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if is_safe_app_name(&name) { Some(name) } else { None }
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
pub fn get_frontmost_app() -> Option<String> {
    Some("Windows".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
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

    // Activate target app via System Events — set frontmost by process name.
    // Using "tell application System Events to set frontmost of process" avoids
    // the macOS "Choose Application" dialog that appears when AppleScript's
    // "tell application <variable>" cannot resolve a name to an installed app.
    let _ = std::process::Command::new("osascript")
        .args([
            "-e", &format!("set appName to \"{}\"", app_name.replace('\\', "\\\\").replace('"', "\\\"")),
            "-e", "tell application \"System Events\" to set frontmost of process appName to true",
        ])
        .output();

    // Wait for the app to come to front
    std::thread::sleep(std::time::Duration::from_millis(300));

    // Check if Accessibility is actually granted for this process
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    let trusted = unsafe { AXIsProcessTrusted() };
    tracing::info!("paste_to_app: AXIsProcessTrusted={}", trusted);
    if !trusted {
        return Err(anyhow::anyhow!("OmWhisper does not have Accessibility permission — grant it in System Settings → Privacy → Accessibility"));
    }

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

#[cfg(target_os = "windows")]
pub fn paste_to_app(_app_name: &str) -> Result<()> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VK_CONTROL,
    };

    // Brief pause to allow recording to fully stop before paste
    std::thread::sleep(std::time::Duration::from_millis(200));

    let make_key = |vk: u16, flags: u32| -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    };

    let inputs: [INPUT; 4] = [
        make_key(VK_CONTROL, 0),              // Ctrl down
        make_key(0x56, 0),                    // V down
        make_key(0x56, KEYEVENTF_KEYUP),      // V up
        make_key(VK_CONTROL, KEYEVENTF_KEYUP), // Ctrl up
    ];

    unsafe {
        let sent = SendInput(4, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(anyhow::anyhow!("SendInput failed: only {} of 4 events sent", sent));
        }
    }

    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
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

#[cfg(target_os = "windows")]
pub fn open_accessibility_settings() {
    // No accessibility settings needed on Windows
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn open_accessibility_settings() {}
