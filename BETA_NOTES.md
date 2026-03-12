# OmWhisper Beta Notes

Thanks for testing OmWhisper! This document covers what to expect, known issues, and how to give feedback.

---

## Setup (2 minutes)

1. **Download** `OmWhisper.dmg` from the link you received
2. Open the DMG and drag OmWhisper to your **Applications** folder
3. Launch from **Applications** (not from the DMG)
4. First launch: right-click → **Open** to bypass the Gatekeeper warning (app is unsigned for beta)
5. Complete the onboarding — grant microphone access and download the `tiny.en` model (~77 MB)
6. **Activate your beta license key** in Settings → License

---

## How to Use

- **Start/stop recording**: press `⌘⇧V` from any app, or click the ॐ icon in the menu bar
- Speak naturally — transcription appears in real time
- When you stop, the text is automatically pasted into whatever app was focused before
- All processing is 100% on-device — no audio ever leaves your Mac

---

## Known Issues

- **App is unsigned** — you must right-click → Open on first launch (Gatekeeper warning)
- **ॐ icon may appear as a square** on some macOS versions — working on it
- **Whisper may hallucinate** on silence (e.g., "Thank you for watching.") — VAD filtering is in place but not perfect
- **tiny.en model** is the only model available on the free tier; `base.en` and `small.en` require a license
- **Long pauses mid-sentence** may cause the segment to be committed early
- **Intel Macs**: not tested yet — please report any issues

---

## What Feedback I'm Looking For

Please share your experience in any of these areas:

1. **Transcription accuracy** — How accurate is it compared to what you actually said?
2. **Latency** — Does it feel fast enough? Any noticeable delay?
3. **Paste behaviour** — Did it paste into the right app? Any issues?
4. **UI/UX** — Is anything confusing or hard to find?
5. **Crashes or errors** — Please include the debug info (Settings → About → Copy)
6. **Missing features** — What would make you use this every day?
7. **Pricing** — Would you pay $12 for this? Too much / too little?

---

## How to Report a Bug

**Option A — Email (preferred)**
Go to Settings → About → **Send Feedback**. This opens your email client with a pre-filled template including your system info. Just add your message and send.

**Option B — Manual**
Email: feedback@omwhisper.com
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
- [ ] Try transcribing an audio file (Settings → Transcribe file)
- [ ] Open the app after sleep/wake — does it still work?
- [ ] Download a larger model (base.en or small.en) and compare accuracy

---

## Roadmap (what's coming)

- Code signing (no more Gatekeeper warning)
- Custom vocabulary / word replacements
- AI-powered cleanup (grammar, formatting, translate)
- Push-to-talk mode
- Speaker detection for meetings

---

*OmWhisper v0.1.0 beta — built by Rakesh Kusuma*
