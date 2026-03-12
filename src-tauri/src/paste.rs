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
    // Give a brief moment for the recording to fully stop
    std::thread::sleep(std::time::Duration::from_millis(200));

    let script = format!(
        r#"tell application "{}" to activate
delay 0.15
tell application "System Events"
    keystroke "v" using command down
end tell"#,
        app_name.replace('"', "\\\"")
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("AppleScript error: {}", err);
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
