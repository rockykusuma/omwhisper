# OmWhisper Beta Notes

Thanks for testing OmWhisper! This document covers what to expect, known issues, and how to give feedback.

---

## Setup (2 minutes)

1. **Download** `OmWhisper_0.1.0-beta.1_aarch64.dmg` from the link you received
2. Open the DMG and drag OmWhisper to your **Applications** folder
3. Launch OmWhisper from **Applications**
4. Complete the onboarding — grant microphone access and download the `tiny.en` model (~77 MB)

---

## How to Use

- **Start/stop recording**: press `⌘⇧V` from any app, or click the ॐ icon in the menu bar
- Speak naturally — transcription appears in real time
- When you stop, the text is automatically pasted into whatever app was focused before
- All processing is 100% on-device — no audio ever leaves your Mac

---

## What's Included in This Beta

All features are fully unlocked for beta testers:

- **All Whisper models** — tiny.en, base.en, small.en (download from Settings → Models)
- **Transcription history** — search, export, delete
- **Smart Dictation** — AI-powered cleanup via Ollama or Cloud API (Settings → AI)
- **Custom vocabulary** — word replacements and phonetic biasing (Settings → Vocabulary)
- **Push-to-talk mode** — hold hotkey instead of toggle (Settings → General)
- **Recording sound effects** — audio cues on start/stop
- **Auto-paste** — pastes directly into the focused app (requires Accessibility permission)

---

## Known Issues

- **ॐ icon may appear as a square** on some macOS versions — working on it
- **Whisper may hallucinate** on silence (e.g., "Thank you for watching.") — VAD filtering is in place but not perfect
- **Long pauses mid-sentence** may cause the segment to be committed early
- **Intel Macs**: not tested yet — please report any issues
- **Smart Dictation** requires Ollama running locally or a Cloud API key — it does not work out of the box

---

## What Feedback I'm Looking For

Please share your experience in any of these areas:

1. **Transcription accuracy** — How accurate is it compared to what you actually said?
2. **Latency** — Does it feel fast enough? Any noticeable delay?
3. **Paste behaviour** — Did it paste into the right app? Any issues?
4. **UI/UX** — Is anything confusing or hard to find?
5. **Crashes or errors** — Please include the debug info (Settings → About → Copy Debug Info)
6. **Missing features** — What would make you use this every day?
7. **Pricing** — Would you pay for this? What feels fair?

---

## How to Report a Bug

**Option A — In-app (preferred)**
Go to **Settings → About → Send Feedback**. Fill in the category, describe the issue, and submit — it goes directly to the team.

**Option B — Email**
Email: `feedback@omwhisper.in`
Subject: `OmWhisper Beta — [brief description]`
Include: app version, macOS version, what you did, what happened (copy from Settings → About → Copy Debug Info)

---

## Beta Tester Checklist

Try each of these and note any issues:

- [ ] Record a short sentence (5–10 words) — does it transcribe correctly?
- [ ] Record in a noisy environment — how does it handle background sound?
- [ ] Record a long paragraph (30+ seconds) — does it stay accurate?
- [ ] Use the hotkey `⌘⇧V` from: Notes, TextEdit, VS Code, Slack, Chrome
- [ ] Check that text pastes into the focused app automatically
- [ ] Open the app after sleep/wake — does it still work?
- [ ] Download a larger model (base.en or small.en) and compare accuracy
- [ ] Try Smart Dictation (`⌘⇧B`) if you have Ollama or a Cloud API key set up

---

## Roadmap (what's coming)

- Windows support
- Speaker detection for meetings
- Improved VAD to eliminate silence hallucinations

---

*OmWhisper v0.1.0-beta.1 — built by Rakesh Kusuma · feedback@omwhisper.in*
