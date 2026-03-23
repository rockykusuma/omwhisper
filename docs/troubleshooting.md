---
layout: default
title: Troubleshooting
nav_order: 5
---
layout: default

# Troubleshooting

---
layout: default

## Auto-Paste Not Working (macOS)

**Symptom:** Transcription copies to clipboard but doesn't paste into the focused app.

**Cause:** macOS Accessibility permission is tied to the binary's code signature. After an app update or reinstall, the old permission entry becomes stale.

**Fix:**
1. Open **System Settings → Privacy & Security → Accessibility**
2. Find OmWhisper in the list — if present, remove it (click `-`)
3. Re-add OmWhisper (click `+`, navigate to Applications, select OmWhisper)
4. Make sure the toggle is **on**
5. Restart OmWhisper

If the issue persists after an update, the new binary may need to be re-granted. This is a one-time step per installation.

---
layout: default

## Microphone Not Detected

**Symptom:** Recording starts but no transcription appears, or you see "No audio input" in the overlay.

**Fix:**
1. Open **System Settings → Privacy & Security → Microphone** (macOS) or **Settings → Privacy → Microphone** (Windows)
2. Ensure OmWhisper has permission
3. Check **Settings → Audio → Input Device** — make sure the correct mic is selected
4. If using an external mic, plug it in before launching OmWhisper

---
layout: default

## Whisper Hallucinations (Random Words on Silence)

**Symptom:** Whisper outputs random text like "Thank you for watching." or "And so..." when you weren't speaking.

**Fix:** Enable Silero VAD in **Settings → Audio → VAD Engine → Silero (Neural)**. This filters silence before sending audio to Whisper, eliminating hallucinations.

If Silero VAD is already enabled, try increasing **VAD Sensitivity** slightly.

---
layout: default

## Hotkey Not Working

**Symptom:** Pressing `Cmd+Shift+V` (or your custom hotkey) does nothing.

**Fixes:**
- Another app may be using the same shortcut. Change yours in **Settings → General → Hotkey**
- Make sure OmWhisper is running (check for the ॐ icon in the menu bar / system tray)
- On macOS: some apps capture global shortcuts inside their own window. Try clicking elsewhere first, then using the hotkey

---
layout: default

## Smart Dictation Shows "AI Error"

**Symptom:** Smart Dictation transcribes correctly but polish fails with an error.

**Fixes by backend:**

- **Ollama:** Make sure Ollama is running (`ollama serve` in terminal). Check that the selected model is downloaded (`ollama list`).
- **Cloud API:** Verify your API key in **Settings → AI**. Test the connection with the **Test Connection** button.
- **On-Device (macOS):** Make sure the LLM model finished downloading in **Settings → AI → On-Device**.

OmWhisper always falls back to pasting the raw transcription if AI polish fails.

---
layout: default

## App Doesn't Open / No Menu Bar Icon

**Symptom:** App appears to launch (Dock bounce) but no menu bar icon appears.

**Fix:** OmWhisper is a menu-bar-only app — it has no Dock icon by default. Look for the ॐ symbol in the menu bar (top-right area on macOS). If it's not there:
1. Check Activity Monitor to see if `omwhisper` is running
2. If it's running but invisible, try restarting the app
3. On macOS with notch displays, the icon may be hidden — try reducing menu bar items

---
layout: default

## Viewing Logs

If you're seeing unexpected behaviour and want to dig deeper:

**macOS:**
```
~/Library/Application Support/com.omwhisper.app/logs/
```

**Windows:**
```
%APPDATA%\com.omwhisper.app\logs\
```

You can also copy debug info from **Settings → About → Copy Debug Info** and share it when reporting a bug.

---
layout: default

## Still Stuck?

Open an issue on [GitHub](https://github.com/rockykusuma/omwhisper/issues) and include the debug info from **Settings → About → Copy Debug Info**.
