# OmWhisper — Project Blueprint

> ॐ — The primordial sound meets modern voice technology.
> A lightning-fast, privacy-first voice transcription tool for macOS.
> Speak naturally. See your words instantly. Everything stays on your device.

---

## 1. Brand Identity

**Name:** OmWhisper

**Meaning:** "Om" (ॐ) — the sacred syllable in Indian philosophy representing the primordial vibration of the universe, the first sound. Combined with "Whisper" — the technology (OpenAI Whisper) and the act of speaking naturally. Your voice is the origin; OmWhisper captures it.

**Visual Identity:**
- **Logo:** The Om symbol (ॐ) rendered in a warm amber gradient, enclosed in a subtle circular form
- **Primary colors:** Amber (#f59e0b), Saffron (#f97316), Gold (#fbbf24)
- **Background:** Deep warm blacks (#0c0806, #12090a)
- **Typography:** Playfair Display (display), Outfit (body), JetBrains Mono (code/technical)
- **Tone:** Spiritual warmth meets technical precision. Reverent but not religious. Calm, confident, trustworthy.

**Tagline options:**
- "Your voice, transcribed with reverence"
- "The sacred art of listening to your voice"
- "Where sound becomes word"

---

## 2. Product Vision

**What:** A menu-bar app that transcribes speech to text in real-time, entirely on-device.

**For whom:** Developers, writers, professionals, and anyone who wants fast dictation without sending audio to the cloud.

**Why it wins:** Privacy-first (no data leaves the device), no subscription, no internet required, lightweight (~10MB app + model download), and built specifically for macOS with Apple Silicon optimization.

---

## 3. Tech Stack

| Layer             | Technology                | Why                                           |
|-------------------|---------------------------|-----------------------------------------------|
| UI Framework      | Tauri 2.x                 | Tiny binaries, native webview, cross-platform  |
| Frontend          | React + TypeScript         | Fast iteration, huge ecosystem                 |
| Backend/Core      | Rust                       | Performance, safety, Tauri's native language   |
| Transcription     | whisper.cpp via whisper-rs | On-device, fast, MIT licensed                  |
| Audio Capture     | cpal (Rust crate)          | Cross-platform audio I/O                       |
| VAD               | Silero VAD                 | Detect speech vs. silence                      |
| Styling           | Tailwind CSS               | Rapid UI development                           |
| Distribution      | Direct download (.dmg)     | No Apple Developer Program needed initially    |
| Payments          | Lemon Squeezy              | Low fees, license key API                      |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────┐
│                  Tauri Shell                 │
│  ┌──────────────────┐  ┌─────────────────┐  │
│  │   React Frontend │  │   System Tray   │  │
│  │   (Webview)      │  │   (Native)      │  │
│  └────────┬─────────┘  └────────┬────────┘  │
│           │                     │            │
│  ┌────────▼─────────────────────▼────────┐  │
│  │           Tauri Commands (IPC)         │  │
│  └────────┬──────────┬──────────┬────────┘  │
│           │          │          │            │
│  ┌────────▼───┐ ┌────▼────┐ ┌──▼─────────┐ │
│  │ Audio      │ │Whisper  │ │ License    │  │
│  │ Pipeline   │ │Engine   │ │ Manager    │  │
│  │ (cpal+VAD) │ │(whisper │ │ (Lemon     │  │
│  │            │ │  -rs)   │ │  Squeezy)  │  │
│  └────────────┘ └─────────┘ └────────────┘  │
└─────────────────────────────────────────────┘
```

### Data Flow
1. User presses global hotkey (Cmd+Shift+V)
2. Audio pipeline captures mic via `cpal`
3. VAD (Silero) filters silence, detects speech
4. Speech chunks → whisper-rs in ~3-second windows
5. Text returned to frontend via Tauri IPC
6. Displayed in overlay + pasted into focused app
7. Hotkey again to stop

---

## 5. Pricing & Licensing

### Free Tier
- 30 minutes / day
- tiny.en model only
- Basic features

### Full License — $12 one-time
- Unlimited transcription
- All model sizes
- Custom vocabulary, export, history
- 1 year of updates
- Priority email support

### Major Version Upgrades — $6 (50% off for existing users)
- ~Once per year
- Major features (Windows, speaker diarization, etc.)

### Implementation
- License keys via Lemon Squeezy API
- Offline validation with periodic check (7 days)
- 30-day grace period for offline
- Stored in macOS Keychain

---

## 6. Feature Roadmap

### v0.1 — Proof of Concept (Week 1-2)
- [ ] Tauri + React project scaffolded
- [ ] Rust audio capture (cpal)
- [ ] whisper-rs transcribing a .wav file
- [ ] Basic UI showing output

### v0.2 — Real-time Pipeline (Week 3-5)
- [ ] Live mic → VAD → Whisper pipeline
- [ ] Streaming results in UI
- [ ] Global hotkey start/stop
- [ ] Menu bar / system tray

### v0.3 — Core Product (Week 6-9)
- [ ] Floating overlay window
- [ ] Paste-to-focused-app
- [ ] Model download manager
- [ ] Transcription history
- [ ] Settings panel

### v0.4 — Licensing & Polish (Week 10-13)
- [ ] Lemon Squeezy integration
- [ ] Free tier tracking
- [ ] Onboarding flow
- [ ] Auto-launch at login
- [ ] Mic permission handling

### v0.5 — Launch Prep (Week 14-16)
- [ ] Landing page (omwhisper.com)
- [ ] .dmg packaging
- [ ] Privacy policy, terms
- [ ] Beta with 20-50 users
- [ ] Performance optimization

### v1.0 — Public Launch (Week 17-18)
- [ ] Product Hunt
- [ ] Hacker News Show HN
- [ ] r/macapps, Twitter/X

### v1.x — Post-Launch
- [ ] Custom vocabulary
- [ ] Speaker diarization
- [ ] Meeting recording mode
- [ ] macOS Shortcuts integration
- [ ] Export formats (SRT, TXT, MD)

### v2.0 — Windows Support
- [ ] Windows audio (WASAPI via cpal)
- [ ] Windows system tray + installer
- [ ] Cross-platform licensing

---

## 7. Project Structure

```
omwhisper/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── audio/
│   │   │   ├── mod.rs
│   │   │   ├── capture.rs
│   │   │   └── vad.rs
│   │   ├── whisper/
│   │   │   ├── mod.rs
│   │   │   ├── engine.rs
│   │   │   └── models.rs
│   │   ├── license/
│   │   │   ├── mod.rs
│   │   │   └── validator.rs
│   │   └── commands.rs
│   └── icons/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── TranscriptionView.tsx
│   │   ├── FloatingOverlay.tsx
│   │   ├── Settings.tsx
│   │   ├── ModelManager.tsx
│   │   ├── Onboarding.tsx
│   │   └── LicenseActivation.tsx
│   ├── hooks/
│   │   ├── useTranscription.ts
│   │   ├── useAudio.ts
│   │   └── useLicense.ts
│   ├── stores/
│   │   └── appStore.ts
│   └── styles/
│       └── globals.css
├── docs/
│   ├── PROJECT_BLUEPRINT.md
│   ├── SETUP_GUIDE.md
│   └── ARCHITECTURE.md
├── landing/
├── models/                     # .gitignore'd, downloaded locally
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── README.md
```

---

## 8. Distribution (No Apple Developer Program)

### Building
```bash
cargo tauri build
# → src-tauri/target/release/bundle/dmg/OmWhisper_x.x.x_aarch64.dmg
```

### First Launch Instructions for Users
1. Download OmWhisper.dmg
2. Drag OmWhisper to Applications
3. Right-click → Open (first time only)
4. Click "Open" in the Gatekeeper dialog

### When to Get Apple Developer Program ($99/yr)
- Revenue exceeds $500/month consistently
- Enables code signing + notarization
- Removes Gatekeeper friction

---

## 9. Legal Checklist

- [ ] Privacy Policy (no audio stored, no data transmitted)
- [ ] Terms of Service
- [ ] MIT license acknowledgment (whisper.cpp, cpal, etc.)
- [ ] EULA
- [ ] Lemon Squeezy merchant agreement
- [ ] Domain: omwhisper.com (or .app)

---

## 10. Logo Concepts

The OmWhisper logo combines the Om symbol (ॐ) with audio/voice motifs:

**Primary Logo:**
- The ॐ character in a warm amber-to-saffron gradient
- Enclosed in a thin circular ring (representing wholeness/sound waves)
- Subtle glow effect for digital use

**Icon (menu bar / app icon):**
- Simplified ॐ in amber on dark background
- Recognizable at 16x16px for menu bar

**Color palette:**
- Amber: #f59e0b (primary)
- Saffron: #f97316 (accent)
- Gold: #fbbf24 (highlight)
- Deep brown-black: #0c0806 (background)
- Warm white: rgba(255,255,255,0.9) (text)

---

*This is a living document. Update as the project evolves.*
*ॐ*
