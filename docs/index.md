---
layout: default
title: Getting Started
nav_order: 1
---

# Getting Started with OmWhisper

OmWhisper is a privacy-first voice transcription app for macOS and Windows. Everything runs on your device — no audio ever leaves your machine.

---
layout: default

## Installation

### macOS

1. Download the `.dmg` from [omwhisper.in](https://www.omwhisper.in) or [GitHub Releases](https://github.com/rockykusuma/omwhisper/releases)
2. Open the `.dmg` and drag OmWhisper to your Applications folder
3. Launch OmWhisper — it will appear in your menu bar (ॐ icon)
4. Follow the onboarding steps to grant Microphone and Accessibility permissions

> The app ships with the `tiny.en` Whisper model bundled — no download needed to get started.

### Windows

1. Download the `.exe` installer from [GitHub Releases](https://github.com/rockykusuma/omwhisper/releases)
2. Run the installer (current user install, no admin required)
3. Launch OmWhisper from the Start menu — it will appear in the system tray

---

## First Run

On first launch, OmWhisper walks you through a 5-step setup:

1. **Welcome** — Overview of the app
2. **Microphone** — Grant mic access
3. **Model** — The bundled `tiny.en` model is ready; optionally download a larger model
4. **Try it out** — Test your first transcription
5. **Ready** — Set your hotkey preference and start using the app

---
layout: default

## Basic Usage

| Action | macOS | Windows |
|--------|-------|---------|
| Toggle recording | `Cmd+Shift+V` | `Ctrl+Shift+V` |
| Smart Dictation (AI polish) | `Cmd+Shift+B` | `Ctrl+Shift+B` |
| Open settings | Click ॐ in menu bar → Settings | Click tray icon → Settings |

1. Press the hotkey to **start recording**
2. Speak naturally
3. Press again to **stop** — transcription is copied to your clipboard and pasted into the focused app automatically

---

## Permissions (macOS)

OmWhisper requires two permissions:

- **Microphone** — to capture your voice
- **Accessibility** — to auto-paste transcription into other apps

Both are requested during onboarding. If auto-paste stops working after an app update, go to **System Settings → Privacy & Security → Accessibility**, remove OmWhisper, and re-add it.

---
layout: default

## Next Steps

- [Keyboard Shortcuts](./shortcuts) — full shortcut reference
- [Recording Modes](./recording-modes) — toggle vs push-to-talk, VAD settings
- [Smart Dictation](./smart-dictation) — AI-powered voice-to-text polish
- [Troubleshooting](./troubleshooting) — common issues and fixes
