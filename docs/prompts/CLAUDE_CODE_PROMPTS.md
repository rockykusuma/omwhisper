# OmWhisper — Claude Code Prompts (All Phases)

All implementation prompts for building OmWhisper, organized by phase.

---

## Phase 1 — Foundation (Prompts 1–4)

> Goal: Get a working skeleton that compiles, transcribes files, captures live audio, and has a system tray + global hotkey.

---

### Prompt 1: Project Scaffold

```
Read all files in ./docs/ to understand the project. Then:

1. Initialize a Tauri 2 project with React + TypeScript frontend:
   - Use Vite as the bundler
   - Set app name to "omwhisper", window title to "OmWhisper"
   - Enable these Tauri features: tray-icon, global-shortcut

2. Set up the Rust backend (src-tauri/):
   - Add these dependencies to Cargo.toml: whisper-rs = "0.15", cpal = "0.15",
     serde with derive feature, serde_json, tokio with full features, anyhow,
     tracing
   - Create the module structure from ARCHITECTURE.md:
     src/audio/mod.rs, src/audio/capture.rs
     src/whisper/mod.rs, src/whisper/engine.rs, src/whisper/models.rs
     src/commands.rs

3. Set up the React frontend (src/):
   - Install: zustand, lucide-react
   - Install dev: tailwindcss, @tailwindcss/vite
   - Configure Tailwind
   - Create the component stubs from ARCHITECTURE.md:
     components/TranscriptionView.tsx
     hooks/useTranscription.ts
     stores/appStore.ts

4. Make sure `cargo tauri dev` compiles and opens a window showing
   "OmWhisper — Ready" with the app name.

Do NOT implement transcription yet. Just get the skeleton compiling and running.
```

---

### Prompt 2: Basic Whisper Transcription

```
Now implement basic whisper-rs transcription:

1. In src-tauri/src/whisper/engine.rs:
   - Create a WhisperEngine struct that loads a GGML model file
   - Implement a transcribe() method that takes a file path to a .wav file,
     reads it, converts to 16kHz mono f32, runs whisper-rs, and returns
     the transcribed text with timestamps

2. In src-tauri/src/commands.rs:
   - Create a Tauri command `transcribe_file` that takes a file path string,
     uses WhisperEngine to transcribe it, and returns the text

3. In the React frontend:
   - Add a simple UI with a "Select Audio File" button
   - Use Tauri's dialog API to pick a .wav file
   - Call the transcribe_file command and display the result

Test with: models/ggml-tiny.en.bin model
Download a sample wav from whisper.cpp repo if needed.
```

---

### Prompt 3: Live Microphone Capture

```
Add real-time microphone capture:

1. In src-tauri/src/audio/capture.rs:
   - Use cpal to capture audio from the default input device
   - Resample to 16kHz mono f32 (whisper-rs requirement)
   - Buffer audio in chunks of ~3 seconds
   - Send chunks via a channel to the transcription engine

2. In src-tauri/src/commands.rs:
   - Add start_transcription and stop_transcription commands
   - start_transcription should begin mic capture and pipe audio to WhisperEngine
   - Emit "transcription-update" events to the frontend with each new segment

3. In the React frontend:
   - Add a Record/Stop button
   - Listen to "transcription-update" events
   - Display transcribed text in real time

Handle microphone permissions gracefully — show a clear message if denied.
```

---

### Prompt 4: Global Hotkey + System Tray

```
Add system tray and global hotkey:

1. Configure Tauri system tray:
   - Show OmWhisper icon in the menu bar
   - Right-click menu: Start/Stop, Settings, Quit
   - Left-click toggles recording

2. Register global hotkey (Cmd+Shift+V):
   - Toggle transcription on/off from anywhere
   - Show a small floating indicator when recording

3. Keep the main window hidden by default — the app should live in the
   menu bar. Show window only from tray menu or when there's transcription
   to display.
```

---

## Phase 2 — Product Polish (Prompts 5–12)

> Goal: Turn the working skeleton into a product people will pay for.

---

### Prompt 5: Voice Activity Detection (VAD)

```
The transcription currently processes all audio including silence, which causes
Whisper to hallucinate text. Add Voice Activity Detection:

1. Integrate Silero VAD into the audio pipeline:
   - Download the Silero VAD ONNX model on first launch
   - Process audio through VAD before sending to Whisper
   - Only send speech segments to the transcription engine
   - Drop silence/noise segments entirely

2. If integrating Silero directly is complex, implement a simpler energy-based
   VAD as a starting point:
   - Calculate RMS energy of each audio chunk
   - Only forward chunks above a configurable threshold
   - Add a "silence timeout" — if no speech for 1.5 seconds, finalize
     the current utterance

3. Emit audio-level events to the frontend so we can show a volume indicator.

The key outcome: no more ghost text appearing when nobody is speaking.
```

---

### Prompt 6: Model Download Manager

```
Users need to download Whisper models. Build the model manager:

1. In src-tauri/src/whisper/models.rs:
   - Define a list of available models with metadata:
     name, size_bytes, description, download_url (from Hugging Face), sha256
   - Include: tiny.en, base.en, small.en, medium.en, large-v3
   - Implement download_model() that:
     - Downloads from Hugging Face with progress reporting
     - Verifies SHA256 checksum after download
     - Stores in ~/Library/Application Support/com.omwhisper.app/models/
   - Implement list_models() returning which are available vs downloaded
   - Implement delete_model() to free disk space

2. Add Tauri commands:
   - get_models → returns list with download status
   - download_model → starts download, emits progress events
   - delete_model → removes a downloaded model
   - get_active_model / set_active_model

3. In the React frontend, create components/ModelManager.tsx:
   - Show a list of models with name, size, accuracy description
   - Downloaded models show a checkmark and "Active" / "Set Active" button
   - Not-downloaded models show a "Download" button with progress bar
   - Add a delete option for downloaded models (except the active one)
   - Show total disk space used by models

The app should ship with no models bundled — download tiny.en on first launch
via the onboarding flow (Prompt 8).
```

---

### Prompt 7: Settings Panel

```
Build a settings panel accessible from the system tray menu:

1. Create a Settings struct in Rust that persists to a JSON file at
   ~/Library/Application Support/com.omwhisper.app/settings.json

   Settings should include:
   - hotkey: String (default "CmdOrCtrl+Shift+V")
   - active_model: String (default "tiny.en")
   - language: String (default "en")
   - auto_launch: bool (default false)
   - auto_paste: bool (default true) — paste into focused app after transcription
   - show_overlay: bool (default true) — show floating overlay while recording
   - audio_input_device: Option<String> — specific mic or None for default
   - vad_sensitivity: f32 (default 0.5) — VAD threshold 0.0 to 1.0

2. Add Tauri commands: get_settings, update_settings

3. In the React frontend, create components/Settings.tsx:
   - Organized sections: General, Audio, Transcription, About
   - General: hotkey configuration, auto-launch toggle, auto-paste toggle
   - Audio: microphone selection dropdown (list available devices),
     VAD sensitivity slider, show a live audio level meter to test mic
   - Transcription: model selection (link to Model Manager), language
   - About: version, links to website/github, "Made with ॐ"
   - All changes save immediately (no save button needed)

4. When hotkey changes, re-register the global shortcut immediately.
```

---

### Prompt 8: First-Run Onboarding

```
Create a beautiful onboarding flow for first-time users:

1. Detect first launch (no settings.json exists)

2. Build components/Onboarding.tsx as a multi-step flow:

   Step 1 — Welcome:
   - Show OmWhisper logo (the ॐ symbol)
   - "Welcome to OmWhisper" headline
   - Brief one-liner about what it does
   - "Get Started" button

   Step 2 — Microphone Permission:
   - Explain why mic access is needed
   - "Grant Microphone Access" button that triggers the macOS permission dialog
   - Show success state when granted
   - If denied, show instructions to enable in System Settings

   Step 3 — Download Model:
   - "Let's download your first AI model"
   - Recommend tiny.en for quick start (75MB)
   - Show download progress bar
   - Mention they can download larger models later in Settings

   Step 4 — Try It Out:
   - "Say something!" — activate mic and show live transcription
   - Let user experience the magic immediately
   - "Looks good!" button to continue

   Step 5 — Ready:
   - Show the global hotkey (Cmd+Shift+V)
   - "OmWhisper lives in your menu bar"
   - Mention free tier: 30 min/day
   - "Start Using OmWhisper" button that closes onboarding

3. After onboarding, don't show it again. Set a flag in settings.
```

---

### Prompt 9: Floating Overlay

```
Create a small floating window that appears while recording:

1. Create a secondary Tauri window called "overlay":
   - Small size: ~300px wide, ~60px tall
   - Always on top
   - No title bar, transparent background
   - Positioned near the top-center of the screen
   - Draggable by the user

2. The overlay should show:
   - A pulsing ॐ icon or dot indicating "listening"
   - The current interim transcription text (truncated if long)
   - A subtle waveform or audio level indicator
   - Click on it to stop recording

3. Show overlay when recording starts, hide when recording stops.
   Respect the show_overlay setting from Settings.

4. Style it to feel native and unobtrusive — dark rounded rectangle
   with slight blur/transparency. Think macOS notification style.
```

---

### Prompt 10: Paste-to-Focused-App

```
When transcription completes, automatically paste the text into whatever
app the user was focused on before they started recording:

1. Before starting recording, capture the currently focused app/window

2. When recording stops and final transcription is ready:
   - Copy the transcribed text to the clipboard
   - If auto_paste is enabled in settings:
     - Bring the previously focused app back to front
     - Simulate Cmd+V keystroke to paste
   - If auto_paste is disabled, just copy to clipboard and show a
     notification that text is ready to paste

3. Use macOS accessibility APIs for this — will need the accessibility
   permission. Handle the permission request gracefully:
   - Detect if accessibility permission is granted
   - If not, show a dialog explaining why it's needed with a button
     that opens System Settings > Privacy > Accessibility

4. This is a macOS-specific feature. Use conditional compilation
   (#[cfg(target_os = "macos")]) so it doesn't break the Windows build later.
```

---

### Prompt 11: Transcription History

```
Add a history panel so users can review past transcriptions:

1. Store transcriptions in a local SQLite database at
   ~/Library/Application Support/com.omwhisper.app/history.db
   - Table: transcriptions (id, text, duration_seconds, model_used,
     created_at, word_count)
   - Add the rusqlite crate to Cargo.toml

2. Add Tauri commands:
   - get_history(limit, offset) → paginated list
   - search_history(query) → full-text search
   - delete_transcription(id)
   - export_history(format) → export as TXT, Markdown, or JSON
   - clear_history → delete all

3. In React, create components/TranscriptionHistory.tsx:
   - Scrollable list of past transcriptions
   - Each entry shows: text preview, date/time, duration, model used
   - Click to expand and see full text
   - Copy button on each entry
   - Search bar at the top
   - Export button in the header
   - "Clear All" with confirmation dialog

4. Accessible from the system tray menu and from the main window.
```

---

### Prompt 12: Free Tier Usage Tracking

```
Implement the free tier (30 minutes/day) and license gating:

1. Track daily usage in the SQLite database:
   - Table: daily_usage (date TEXT PRIMARY KEY, seconds_used INTEGER)
   - Increment seconds_used while transcription is active
   - Reset at midnight local time

2. Add Tauri commands:
   - get_usage_today → returns { seconds_used, seconds_remaining, is_free_tier }
   - get_license_status → returns Free/Licensed/Expired

3. In the audio pipeline:
   - Check usage before starting transcription
   - If free tier and 30 minutes exceeded, stop and notify the user
   - Emit usage-update events every 10 seconds while recording

4. In the React frontend:
   - Show remaining time in the main window/overlay for free users
   - When limit is reached, show a friendly upgrade prompt:
     "You've used your 30 free minutes today. Upgrade for unlimited
      transcription — just $12, one time."
   - Add a license activation button/link

5. For now, stub the license validation — just check if a license key
   exists in the local store. We'll integrate Lemon Squeezy in the next phase.

6. Free tier restrictions:
   - 30 min/day transcription
   - tiny.en model only (gray out other models with "Upgrade to unlock")
   - No export functionality
```

---

## Phase 3 — Launch (Prompts 13–22)

> Goal: Add payments, polish everything, package it, and ship.

---

### Prompt 13: Lemon Squeezy License Integration

```
Replace the stubbed license system with real Lemon Squeezy validation.

Before starting: You'll need a Lemon Squeezy account set up with:
- A store created
- A product called "OmWhisper Full License" priced at $12
- A license key activation enabled on the product
Keep your API key ready.

1. In src-tauri/src/license/mod.rs and validator.rs:

   Create a LicenseManager that handles the full lifecycle:

   a) activate_license(key: String):
      - POST to https://api.lemonsqueezy.com/v1/licenses/activate
        with { license_key: key, instance_name: "omwhisper-{machine_id}" }
      - On success, store in macOS Keychain using the keyring crate:
        - license_key
        - license_id
        - activation_date
        - last_validated_date
        - customer_email (from response)
      - Return LicenseStatus::Licensed

   b) validate_license():
      - POST to https://api.lemonsqueezy.com/v1/licenses/validate
        with { license_key, instance_name }
      - Update last_validated_date on success
      - If network fails, check grace period:
        - If last_validated < 30 days ago → still valid (grace period)
        - If last_validated > 30 days ago → expired
      - Call this on app launch and every 7 days while running

   c) deactivate_license():
      - POST to https://api.lemonsqueezy.com/v1/licenses/deactivate
      - Clear Keychain entries
      - Revert to free tier

   d) get_license_status():
      - Check Keychain for stored license
      - If found, check if validation is current
      - Return Free / Licensed / Expired / GracePeriod

2. Add Tauri commands:
   - activate_license(key) → Result<LicenseStatus>
   - deactivate_license() → Result<()>
   - get_license_status() → LicenseStatus
   - get_license_info() → { email, activated_on, valid_until }

3. Generate a unique machine_id:
   - Use a hash of the Mac's hardware UUID
   - Store it so it's consistent across launches
   - This prevents one key being used on unlimited machines

4. Handle edge cases:
   - Invalid key → clear error message
   - Already activated on max instances → show "deactivate on other device first"
   - Network timeout → fall back to cached status with grace period
   - Keychain access denied → fall back to file-based storage in app data dir

Do NOT hardcode any API keys in the source. Read the Lemon Squeezy API key
from an environment variable or a config file that's in .gitignore.
Actually, for license validation we only need the license key from the user,
not our API key — the activate/validate/deactivate endpoints are public.
So no API key is needed in the app binary.
```

---

### Prompt 14: License Activation UI

```
Build the license activation experience:

1. Create components/LicenseActivation.tsx:
   - Clean modal/page with the ॐ logo at top
   - Text field for pasting a license key
   - "Activate" button
   - Loading state while validating
   - Success state: "Welcome! OmWhisper is fully unlocked." with confetti
     or a subtle celebration animation
   - Error states: invalid key, already used, network error — each with
     a helpful message
   - Link: "Don't have a key? Buy one for $12" → opens purchase URL in browser

2. Create components/UpgradePrompt.tsx:
   - A reusable prompt shown when free tier users try to:
     - Use a model other than tiny.en
     - Export transcriptions
     - Continue after 30 min daily limit
   - Shows what they're missing and the $12 price
   - "Buy Now" opens purchase URL in browser
   - "I have a key" opens LicenseActivation
   - Dismissable but not annoying — show max once per session per trigger

3. Add license status indicator to the main UI:
   - Free users: subtle "Free · 14:32 remaining" in the footer
   - Licensed users: small "Pro" badge or nothing (don't rub it in)

4. Add to Settings panel:
   - License section showing current status
   - If licensed: email, activation date, "Deactivate" button
   - If free: "Activate License" button, "Buy License" link

5. Wire up the free tier gating from Prompt 12 to actually use
   the real license status from the Lemon Squeezy integration.
```

---

### Prompt 15: App Polish and Edge Cases

```
Go through the entire app and polish everything:

1. Error handling audit:
   - Every Tauri command should return proper Result types
   - Frontend should show user-friendly error messages, never raw errors
   - Add a global error boundary in React
   - Whisper engine crashes should not crash the app — catch and recover
   - Model download failures should resume where they left off (or restart cleanly)

2. Performance optimization:
   - Profile memory usage while transcribing — ensure it's under 500MB
     with small.en model
   - Ensure the app uses < 1% CPU when idle (not recording)
   - Lazy-load the Whisper model only when first transcription starts
   - Release the model from memory when not recording for > 5 minutes

3. Accessibility:
   - All buttons should have proper aria labels
   - Keyboard navigation should work throughout the app
   - High contrast mode should be readable
   - Screen reader friendly labels on status indicators

4. Edge cases to handle:
   - App launched with no internet → should work fine (offline-first)
   - Microphone disconnected while recording → graceful stop + notification
   - Disk full during model download → clear error message
   - Multiple instances of the app → prevent with a lock file
   - System sleep/wake → reconnect audio stream
   - macOS audio route change (plug in headphones) → handle gracefully
   - Very long recording sessions (1+ hour) → memory management

5. Logging:
   - Add structured logging with the tracing crate
   - Log to ~/Library/Application Support/com.omwhisper.app/logs/
   - Rotate logs — keep last 7 days
   - Include log level in Settings (Normal / Debug)
   - Add "Copy Debug Info" button in Settings > About for bug reports

6. Auto-update groundwork:
   - Add current version number to the app (read from Cargo.toml)
   - On launch, check a simple JSON file hosted at your domain:
     GET https://omwhisper.com/api/version.json
     → { "latest": "1.0.1", "download_url": "...", "release_notes": "..." }
   - If newer version available, show a non-intrusive banner:
     "OmWhisper v1.0.1 is available" with a download link
   - Don't auto-download or auto-install — just notify
```

---

### Prompt 16: App Icon and Branding Assets

```
Set up proper app icons and branding:

1. We have SVG logos in the assets/ folder. Generate the required icon sizes
   for Tauri from the ॐ logo concept:
   - Create a simple icon: dark background (#0a0f0d) with the ॐ symbol
     in emerald gradient, inside a rounded square
   - Generate PNG files at required sizes:
     - 32x32, 128x128, 256x256 (for macOS app icon)
     - 32x32 for menu bar icon (template icon — single color white)
     - icon.icns for macOS bundle (if not auto-generated by Tauri)

2. If generating PNGs programmatically is complex, create an SVG at
   1024x1024 and let Tauri's build process handle the conversion.
   Place the source icon at src-tauri/icons/icon.png (1024x1024)

3. For the menu bar / system tray:
   - Use a simplified monochrome icon (just ॐ outline in white/black)
   - macOS menu bar icons should be "template images" — single color
     that adapts to light/dark menu bar automatically
   - Name it icon-Template.png for macOS template image convention

4. Update tauri.conf.json with the correct icon paths.

5. Set the app metadata in tauri.conf.json:
   - identifier: "com.omwhisper.app"
   - description: "Your voice, transcribed instantly. Private by design."
   - copyright: "© 2026 OmWhisper"
   - category: "Productivity"
```

---

### Prompt 17: DMG Packaging and Distribution

```
Package OmWhisper as a distributable .dmg file:

1. Configure Tauri's bundle settings in tauri.conf.json:
   - macOS bundle identifier: com.omwhisper.app
   - Set minimum system version: 14.0 (macOS Sonoma)
   - Configure DMG settings:
     - Background image (optional — skip if complex)
     - Window size and icon positions
     - App icon on left, Applications folder alias on right

2. Build the release binary:
   - Run: cargo tauri build
   - This produces:
     - .app bundle in src-tauri/target/release/bundle/macos/
     - .dmg in src-tauri/target/release/bundle/dmg/
   - The binary should target aarch64-apple-darwin (Apple Silicon)
   - Optionally also build for x86_64-apple-darwin (Intel Macs)

3. Create a universal binary if targeting both architectures:
   - Build for both targets
   - Use lipo to combine them
   - This adds to the binary size but supports all Macs

4. Test the .dmg:
   - Mount it
   - Drag to Applications
   - Launch from Applications
   - Verify right-click → Open works for unsigned app
   - Verify all features work in the release build
   - Check that models download to the correct location
   - Verify Keychain access works for license storage

5. Add a simple install checker:
   - On first launch from Applications, check if running from .dmg
   - If yes, prompt user to drag to Applications first
   - This prevents the "running from disk image" macOS issue

6. Create a post-build script (scripts/build-release.sh):
   - Builds release binary
   - Calculates SHA256 of the .dmg
   - Outputs version, filename, size, and hash
   - This info goes on the download page

Note: We're distributing unsigned for now. The app will trigger a Gatekeeper
warning on first launch. Users right-click → Open to bypass this.
We'll add code signing when revenue justifies the $99/year Apple Developer fee.
```

---

### Prompt 18: UI Overhaul — Sidebar Navigation & Visual Polish

```
The app works great but the UI feels like a prototype. Before adding Phase 4
features, restructure the frontend so it feels like a real macOS product.

This is a frontend-only change — no Rust backend modifications needed.

1. Add a persistent left sidebar navigation (replacing callback-based view switching):

   Create components/Sidebar.tsx:
   - Slim sidebar (~200px) on the left, always visible
   - Navigation items with lucide-react icons + labels:
     - Home (Mic icon) — main transcription view
     - History (Clock icon) — transcription history
     - Models (Box icon) — model manager
     - Settings (Settings icon) — settings panel
   - Active item highlighted with emerald accent (bg-emerald-500/10, left border)
   - ॐ logo/wordmark at the top of the sidebar
   - App version at the bottom (subtle, small text)
   - Free tier: usage remaining shown at bottom of sidebar
   - Licensed: small "Pro" badge near the logo

   Refactor App.tsx:
   - Replace the view state + ternary rendering with sidebar-driven layout
   - Layout: sidebar (fixed left) + content area (scrollable right)
   - Remove all onOpenModels/onOpenSettings/onOpenHistory callback props
   - Each view component no longer needs onClose/← Back buttons

2. Redesign the Home / Transcription view:

   Major changes to TranscriptionView.tsx:
   - Remove the header with "OmWhisper" title + tiny nav links (sidebar handles this)
   - Remove the mode tabs ("Live Mic" / "Audio File") from the main view
     Move "Audio File" transcription to a secondary option (menu item or
     button within Settings, or a small link below the record button)
   - Center the view around a large circular record button:
     - ~80px diameter circle
     - Emerald gradient when idle, red when recording
     - Subtle pulse animation when recording
     - Mic icon centered inside
   - Audio level meter: horizontal bar or waveform below the record button
     (replace the current vertical bar visualization)
   - "Listening..." status text below the meter when recording
   - Transcription output: clean card below with the text flowing in
   - Keep the usage bar for free tier users, but move it to be more subtle
     (thin bar at the top of the content area, or integrated into the sidebar)
   - Add a tasteful empty state when not recording:
     - Subtle ॐ icon or waveform illustration
     - "Press ⌘⇧V or tap the button to start"
     - Maybe show a recent transcription preview or stats summary

3. Restructure Settings into tabbed sub-sections:

   Refactor Settings.tsx:
   - Instead of one scrolling page, use vertical tabs/sidebar within Settings:
     - General (hotkey, auto-launch, auto-paste, overlay, log level)
     - Audio (microphone, VAD sensitivity)
     - Transcription (active model, language)
     - License (status, activate/deactivate)
     - About (version, storage, debug info, credits)
   - Each sub-section renders in the right content area
   - This structure scales well as we add more settings in Phase 4
     (sound effects, vocabulary, storage management, etc.)

4. Polish the History view:

   Update TranscriptionHistory.tsx:
   - Remove the "← Back" button (sidebar handles navigation)
   - Add a proper empty state with a clock or document icon
   - Consider a master-detail layout for wider windows:
     left column = entry list, right column = expanded entry detail
     (similar to HyperWhisper's history)
   - Or keep the current expandable cards but with better spacing

5. Polish the Models view:

   Update ModelManager.tsx:
   - Remove "← Back" button
   - Add a proper empty state
   - Better card layout for each model

6. Global CSS / Tailwind cleanup:

   - Move the repeated inline fontFamily styles to Tailwind config or
     global CSS (--font-sans: 'DM Sans'; --font-mono: 'DM Mono')
   - Define common component classes:
     - .card (rounded-2xl border border-white/[0.06] bg-white/[0.02])
     - .btn-primary (emerald button styles)
     - .btn-secondary (ghost/outline button styles)
   - Consistent spacing: use a spacing scale (p-5 for cards, gap-6 between sections)
   - Add smooth page transitions when switching views (optional, use framer-motion
     or simple CSS transitions)

7. Window sizing:

   - Update tauri.conf.json window dimensions to accommodate the sidebar:
     - width: ~780 (was likely ~600)
     - height: ~560
     - minWidth: 680
     - minHeight: 480
   - Test that the layout works at the minimum size

Important constraints:
- Do NOT change any Tauri commands, Rust backend, or IPC interface
- Do NOT change the functionality of any feature — only restructure the UI
- Keep all existing features working: recording, history, models, settings,
  license, overlay, hotkey, usage tracking
- Use lucide-react for all icons (already in the project)
- Maintain the emerald/teal on dark theme throughout
```

---

### Prompt 19: Landing Page Deployment

```
Turn the landing page into a deployable website:

1. Create a Vite project in the landing/ directory:
   - Framework: React + TypeScript
   - Install: tailwindcss, @tailwindcss/vite
   - Move omwhisper-landing.jsx → src/App.tsx (convert to TypeScript)

2. Add functional links:
   - "Download for macOS" → direct link to the .dmg file
     (host on GitHub Releases or your own domain)
   - "Buy License — $12" → Lemon Squeezy checkout URL
   - "View on GitHub" → your repo (if public) or remove if private
   - "Privacy" → /privacy page
   - "Terms" → /terms page

3. Create a minimal /privacy page:
   - OmWhisper does not collect, store, or transmit audio data
   - All processing happens on-device
   - License validation contacts Lemon Squeezy API (only the key, no audio)
   - Optional anonymous analytics (if you add them) with opt-out
   - No cookies except essential ones
   - Contact email for privacy questions

4. Create a minimal /terms page:
   - Software provided as-is
   - License is per-user, non-transferable
   - One year of updates included, app works forever
   - Refund policy (suggest 30-day no questions asked via Lemon Squeezy)

5. Add basic SEO:
   - Title: "OmWhisper — Voice to text, private and instant"
   - Meta description
   - Open Graph tags for social sharing
   - Favicon using the ॐ icon

6. Deploy:
   - Build: npm run build → produces dist/ folder
   - Deploy to Vercel, Netlify, or Cloudflare Pages (all free tier)
   - Connect your domain (omwhisper.com or similar)
   - Set up HTTPS (automatic with these platforms)
```

---

### Prompt 20: Version Check API

```
Set up the version check endpoint the app uses for update notifications:

1. Create a simple static JSON file for the landing site:
   landing/public/api/version.json:
   {
     "latest": "1.0.0",
     "min_supported": "1.0.0",
     "download_url": "https://omwhisper.com/download/OmWhisper_1.0.0_aarch64.dmg",
     "release_notes": "Initial release! Voice transcription powered by Whisper.",
     "release_date": "2026-XX-XX"
   }

2. This file gets deployed with the landing page — no backend needed.
   Update it manually with each release.

3. The app already checks this on launch (from Prompt 15).
   Verify the full flow:
   - App launches → fetches version.json
   - If newer version → shows banner with release notes and download link
   - If same version → does nothing
   - If network fails → silently continues (don't bother the user)
```

---

### Prompt 21: Beta Testing Prep

```
Prepare the app for beta testing with 20-50 users:

1. Add a beta feedback mechanism:
   - In Settings > About, add a "Send Feedback" button
   - Opens the user's default email client with:
     To: feedback@omwhisper.com (or your email)
     Subject: "OmWhisper Beta Feedback — v{version}"
     Body: pre-filled template with:
       - App version
       - macOS version
       - Mac model (Apple Silicon / Intel)
       - Active Whisper model
       - Space for user's message

2. Add a "Copy Debug Info" button that copies to clipboard:
   - App version
   - macOS version
   - Hardware: chip, RAM
   - Models downloaded and sizes
   - Total transcription time (all time)
   - License status (Free/Pro — don't include the key)
   - Last 20 log lines (sanitized — no personal text)

3. Create a beta distribution plan:
   - Generate 50 free license keys in Lemon Squeezy for beta testers
   - Prepare a short email/message template:
     "Hey! I'm building OmWhisper — a private, on-device voice transcription
      tool for Mac. Would you try the beta and give me feedback?
      Download: [link]
      Your free license key: [key]
      Takes 2 minutes to set up."

4. Create a known issues document (BETA_NOTES.md) to include:
   - App is unsigned — right-click → Open on first launch
   - Known issues / limitations
   - How to report bugs
   - What feedback you're looking for:
     - Transcription accuracy
     - Latency / speed feel
     - Any crashes or errors
     - Features that feel missing
     - Would you pay $12 for this?

5. Set up a simple feedback tracking system:
   - A spreadsheet or Notion page to log beta feedback
   - Columns: user, date, category (bug/feature/praise), description, status
```

---

### Prompt 22: Launch Checklist

```
This is not a code prompt — it's a checklist. Go through it manually
and verify everything before public launch.

Final audit before going live:

□ App
  □ Fresh install works (download .dmg → install → onboarding → transcribe)
  □ Onboarding flow is smooth and all steps work
  □ Microphone permission request works
  □ Model download (tiny.en) completes without error
  □ Live transcription works with tiny.en, base.en, small.en
  □ Global hotkey works from any app
  □ Paste-to-app works in: Notes, TextEdit, VS Code, Slack, Chrome
  □ Floating overlay appears and disappears correctly
  □ Settings save and persist across restarts
  □ History records and searches correctly
  □ Free tier limit triggers at 30 minutes
  □ License activation works with a real key
  □ License gating unlocks all models and features
  □ App doesn't crash during 30+ minute continuous recording
  □ Memory stays under 500MB with small.en during transcription
  □ CPU under 1% when idle
  □ App survives sleep/wake cycle
  □ Handles no-internet gracefully

□ Website
  □ Landing page loads and looks good
  □ Download link works and serves the correct .dmg
  □ Buy button goes to Lemon Squeezy checkout
  □ Privacy and Terms pages exist
  □ SEO meta tags present
  □ SSL certificate active
  □ Domain connected

□ Business
  □ Lemon Squeezy store and product configured
  □ $12 price set
  □ License key delivery is automatic via email
  □ Refund policy set (30 days)
  □ Payment receipt email looks professional
  □ feedback@omwhisper.com (or equivalent) receives email

□ Launch
  □ Product Hunt post drafted (schedule for Tuesday-Thursday)
  □ Hacker News Show HN post drafted
  □ r/macapps post drafted
  □ Twitter/X launch thread written (5-7 tweets)
  □ 2-3 friends ready to upvote/comment early
  □ Screenshot / demo GIF ready for social posts

After all boxes are checked: SHIP IT.
```

---

## Phase 4 — Competitor-Inspired Enhancements (Prompts 23–28)

> Inspiration drawn from SuperWhisper and HyperWhisper.
> Goal: Inspire, not copy. Make OmWhisper distinctly better.

---

### Prompt 23: Custom Vocabulary

**What:** Let users add custom words/phrases so Whisper recognizes them correctly.

**Why:** Whisper routinely mangles names, acronyms, brand names, and domain jargon. Both competitors offer this — it's clearly a real pain point.

**Approach:**
- Add a `custom_vocabulary: Vec<String>` field to `settings.rs`
- Feed vocabulary list into whisper.cpp's `initial_prompt` parameter to bias recognition
- Optional: support `word → replacement` mappings (e.g., "okay" → "OK", "omwhisper" → "OmWhisper")
- Frontend: `Vocabulary.tsx` — simple add/remove list with an input field
- Nav link in the main view header alongside History and Settings

**Scope:** Rust settings + whisper engine integration + React UI component

---

### Prompt 24: Recording Sound Effects

**What:** Play audible start/stop sounds when recording begins and ends.

**Why:** OmWhisper lives in the menu bar — users often aren't looking at the screen when they hit the hotkey. Auditory feedback confirms the action worked. Both competitors have this.

**Approach:**
- Bundle three sound files as Tauri resources:
  - **Om chant** (~2–3s, soft, meditative) — played once on app launch
  - **Start chime** (short, crisp) — played when recording begins
  - **Stop chime** (short, resolving tone) — played when recording ends
- Use `rodio` crate (lightweight audio playback) or macOS `NSSound` via objc bindings
- Play Om sound in `lib.rs` setup after tray + window init completes (non-blocking, spawned on async thread)
- Play start sound in `start_transcription`, stop sound in `stop_transcription`
- Add settings: `sound_enabled: bool` (default true), `sound_volume: f32` (0.0–1.0), `launch_sound_enabled: bool` (default true)
- Settings UI: toggle + volume slider in the Audio section, separate toggle for launch Om sound

**Sound sourcing notes:**
- Om chant: use a royalty-free Om sample (e.g., from freesound.org, CC0 licensed), trim to ~2–3 seconds, fade in/out
- Start/stop chimes: subtle, non-intrusive tones that match the emerald/zen brand feel
- All sounds stored as small .wav or .ogg files in `src-tauri/resources/sounds/`

**Scope:** Rust audio playback + bundled assets (3 sounds) + settings integration

---

### Prompt 25: Usage Statistics Card

**What:** Show a compact stats summary on the main transcription view — total recordings, total time, total words, streak/activity info.

**Why:** Turns a utility into a habit. Motivates continued use. HyperWhisper has a full stats page; we'll do it better as a compact, always-visible card.

**Approach:**
- Add SQL queries to `history.rs`: `get_stats_summary()` returning total_recordings, total_duration_seconds, total_words, recordings_today, streak_days
- New Tauri command: `get_usage_stats`
- Frontend: `StatsCard.tsx` — compact horizontal strip below the record button area
- Show: recordings count, total time (formatted), total words, current streak
- Optional: subtle sparkline for activity over the last 7 days (using inline SVG)
- Refresh on each recording stop

**Scope:** SQL queries + Tauri command + React component

---

### Prompt 26: Clipboard Restoration After Paste

**What:** After pasting transcription into the focused app, restore the user's previous clipboard contents.

**Why:** Currently, paste_transcription overwrites whatever was on the clipboard. If you copied a URL, started a dictation, and it pasted — your URL is gone. HyperWhisper has "Restore clipboard after paste" with a configurable delay. Small detail, big quality-of-life win.

**Approach:**
- In `paste.rs`: before writing transcription to clipboard, read and save current clipboard contents
- After the paste action completes, spawn a delayed task (configurable, default 2s) to restore the old clipboard
- Add setting: `restore_clipboard: bool` (default true), `clipboard_restore_delay_ms: u64` (default 2000)
- Settings UI: toggle + delay input in the General or Transcription section

**Scope:** Rust clipboard logic in paste.rs + settings field + UI toggle

---

### Prompt 27: Push to Talk Mode

**What:** Alternative recording trigger — hold the shortcut key to record, release to stop and paste.

**Why:** Some users prefer the walkie-talkie interaction over toggle. Both competitors offer this. It's especially natural for quick one-line dictations.

**Approach:**
- Add setting: `recording_mode: "toggle" | "push_to_talk"` (default "toggle")
- In `lib.rs` shortcut handler: if push_to_talk, register key-down to start and key-up to stop
- Tauri's global shortcut API may need platform-specific handling for key-up detection
- Alternative: use a separate dedicated shortcut for push-to-talk (e.g., `Fn` key or right `Option`)
- Settings UI: radio/segmented control in Keyboard Shortcuts section
- Update onboarding to mention both modes

**Scope:** Rust shortcut handling + settings + UI

---

### Prompt 28: Auto-Delete Old History

**What:** Automatically clean up transcription history older than a user-defined threshold.

**Why:** Without this, the SQLite database grows forever. HyperWhisper has storage management with compression and auto-deletion. We should keep it simple.

**Approach:**
- Add setting: `auto_delete_after_days: Option<u32>` (default None = keep forever, options: 7, 30, 90, 180, 365)
- In `history.rs`: `cleanup_old_transcriptions(days: u32)` — DELETE WHERE created_at < now - days
- Run cleanup on app launch (after history DB init)
- Add `get_storage_info()` command returning DB file size + record count
- Settings UI: dropdown in a new "Storage" subsection, plus a label showing current DB size and record count

**Scope:** SQL cleanup + Tauri command + settings field + UI

---

### Phase 4 Priority Order

| Priority | Prompt | Feature | Effort | Impact |
|----------|--------|---------|--------|--------|
| 1 | 23 | Custom Vocabulary | Medium | High — fixes a real transcription pain point |
| 2 | 24 | Recording Sound Effects | Low | High — essential feedback for menu-bar app |
| 3 | 25 | Usage Statistics Card | Medium | Medium — engagement + delight |
| 4 | 26 | Clipboard Restoration | Low | Medium — quality-of-life polish |
| 5 | 27 | Push to Talk Mode | High | Medium — alternative interaction pattern |
| 6 | 28 | Auto-Delete Old History | Low | Low-Medium — storage hygiene |

---

## Phase 5 — Smart Dictation (Prompts 29–32)

> OmWhisper's flagship differentiator. Neither SuperWhisper nor HyperWhisper does this.
> Speak naturally → get polished, context-aware text pasted into any app.
> 100% on-device with Ollama, or cloud API for users who prefer it.

**Flow:** Voice → Whisper → Raw text → **LLM polish** → Paste.

---

### Prompt 29: AI Backend — Ollama + Cloud API Integration

**What:** Build the Rust backend that can send text to a local Ollama instance or a cloud API (OpenAI-compatible) and return the polished result.

**Approach:**

New Rust module `src-tauri/src/ai/`:
```
ai/
├── mod.rs          # AiBackend enum, AiConfig, public interface
├── ollama.rs       # Ollama HTTP client (localhost:11434)
└── cloud.rs        # OpenAI-compatible API client
```

Core types:
```rust
pub enum AiBackend {
    Ollama { model: String },
    CloudApi { provider: String },
    Disabled,
}

pub struct AiConfig {
    pub backend: AiBackend,
    pub ollama_url: String,            // default "http://localhost:11434"
    pub cloud_api_key: Option<String>, // stored encrypted in Keychain
    pub cloud_api_url: String,         // default "https://api.openai.com/v1"
    pub cloud_model: String,           // default "gpt-4o-mini"
    pub timeout_seconds: u32,          // default 30
}
```

Ollama client (`ollama.rs`):
- `check_ollama_status()` → bool — GET `/api/tags`
- `list_ollama_models()` → Vec<String>
- `polish_text(text, system_prompt, model)` → Result<String> — POST `/api/chat`

Cloud client (`cloud.rs`):
- `polish_text(text, system_prompt, config)` → Result<String> — POST `{url}/chat/completions`
- Store API key in macOS Keychain, never log in plaintext

New Tauri commands:
- `check_ollama_status()` → `{ running: bool, models: Vec<String> }`
- `get_ollama_models()` → `Vec<String>`
- `polish_text(text, style, backend)` → `Result<String>`
- `test_ai_connection(backend)` → `Result<String>`

Settings additions to `settings.rs`:
```rust
pub ai_backend: String,           // "ollama" | "cloud" | "disabled"
pub ai_ollama_model: String,      // default "llama3.2"
pub ai_cloud_model: String,       // default "gpt-4o-mini"
pub ai_cloud_api_url: String,     // default "https://api.openai.com/v1"
pub ai_timeout_seconds: u32,      // default 30
```
API key stored separately in Keychain, NOT in settings.json.

**Scope:** New Rust module (3 files) + Tauri commands + settings fields

---

### Prompt 30: Polish Styles System

**What:** Define the style presets that control how the LLM transforms raw transcription into polished output.

**Built-in styles:**

**Professional** (default)
```
You are a text improvement assistant. Rewrite the given text to be more
professional, polished, and formal. Rules:
1) Keep the same meaning and core message
2) Only output the improved text — no preamble, no explanation, no quotes
3) Match the original language
4) Maintain the approximate length
5) Fix grammar, punctuation, and sentence structure
6) Use appropriate professional vocabulary
```

**Casual**
```
You are a text cleanup assistant. Clean up the given text to be clear and
natural, like a well-written message to a friend or colleague. Rules:
1) Keep the tone relaxed and conversational
2) Only output the cleaned text — nothing else
3) Fix obvious grammar issues but keep contractions and informal style
4) Remove filler words (um, uh, like, you know)
5) Don't make it longer than the original
```

**Concise**
```
You are a text compression assistant. Rewrite the given text to be shorter
and more direct while keeping the full meaning. Rules:
1) Reduce length by 30-50% where possible
2) Only output the compressed text — nothing else
3) Remove redundancy and filler
4) Keep all important information
5) Use active voice and strong verbs
```

**Translate** (needs target language parameter)
```
You are a translation assistant. Translate the given text into {target_language}.
Rules:
1) Only output the translation — nothing else
2) Maintain the tone and register of the original
3) Use natural, fluent {target_language}
4) Keep proper nouns unchanged
```

**Email Format**
```
You are an email writing assistant. Rewrite the given text as a professional
email. Rules:
1) Add an appropriate greeting if missing
2) Structure into clear paragraphs
3) Add a professional closing if missing
4) Fix grammar and punctuation
5) Only output the email text — no subject line unless requested
6) Keep the same core message and requests
```

**Meeting Notes**
```
You are a meeting notes formatter. Rewrite the given text as structured
meeting notes. Rules:
1) Extract key points and action items
2) Format with bullet points or numbered lists
3) Add section headers if multiple topics are discussed
4) Only output the formatted notes — nothing else
5) Preserve all factual details and names
```

**Custom styles:**
- Users can create styles with name + system prompt
- Stored in settings as `custom_polish_styles: Vec<CustomStyle>`
- `CustomStyle { name: String, system_prompt: String, icon: String }`

**Commands:** `get_polish_styles`, `add_custom_style`, `remove_custom_style`

**Scope:** System prompt definitions + style management commands + settings

---

### Prompt 31: Smart Dictation Shortcut & Recording Flow

**What:** Register a second global shortcut (`Cmd+Shift+B`) that triggers Smart Dictation — same recording, but with LLM polish before paste.

**Approach:**

New shortcut in `lib.rs`:
- Default: `Cmd+Shift+B` (configurable)
- Emits event: `hotkey-smart-dictation`

Recording flow when Smart Dictation shortcut pressed:
1. Capture focused app (reuse `capture_focused_app`)
2. Start transcription (reuse `start_transcription`)
3. Set `is_smart_dictation: bool = true` in app state

When recording stops:
1. Stop transcription
2. If `is_smart_dictation`:
   a. Emit `smart-dictation-polishing` (frontend shows "Polishing...")
   b. Call `polish_text(raw_text, active_style)`
   c. Emit `smart-dictation-complete` with polished text
   d. Paste polished text to focused app
   e. Save to history with `source: "smart_dictation"`, `raw_text`, `polish_style`

Frontend changes:
- Listen for `smart-dictation-polishing` → show shimmer/spinner
- Listen for `smart-dictation-complete` → show polished text with sparkle icon
- Record button shows sparkle badge when in Smart Dictation mode

History schema extension:
```rust
pub struct TranscriptionEntry {
    // ... existing fields ...
    pub source: String,                // "raw" | "smart_dictation"
    pub raw_text: Option<String>,
    pub polish_style: Option<String>,
}
```

Error handling — always fall back to raw paste if AI fails, never lose transcription.

**Scope:** Rust shortcut + recording flow + events + frontend UI + history schema migration

---

### Prompt 32: AI Settings UI & Ollama Setup Guide

**What:** Build the Settings UI for configuring the AI backend, selecting polish styles, and guiding users through Ollama setup.

**New Settings sub-tab: "AI Processing"** (between Transcription and License)

Section: Backend
- Radio group: "On-Device (Ollama)" / "Cloud API" / "Disabled"
- Status indicator per selection

Section: On-Device (Ollama)
- Status dot + model dropdown (from `get_ollama_models()`, refreshable)
- "Test Connection" button
- If not detected: expandable Ollama setup guide:
  - Step 1: Download from ollama.com [Open Download Page]
  - Step 2: Install and open Ollama
  - Step 3: Run `ollama pull llama3.2` in Terminal
  - Step 4: Click [Refresh Status]

Section: Cloud API
- Provider dropdown: OpenAI / Groq / Custom
- API Key: masked field with show/hide, stored in Keychain
- Model + API URL fields (pre-filled per provider)
- "Test Connection" button
- Privacy notice: text sent to provider, audio never leaves device

Section: Smart Dictation Shortcut
- Hotkey display/editor (default ⌘⇧B)
- Active polish style dropdown

Section: Polish Styles
- Built-in styles (viewable, non-editable)
- Custom styles area with + button, name/prompt textarea, delete, duplicate

First-use experience:
- If user presses `Cmd+Shift+B` with AI not configured → toast: "Smart Dictation needs AI setup. Open Settings → AI Processing to get started."

**Scope:** React Settings UI + Ollama setup guide + API key management

---

### Phase 5 Priority Order

| Priority | Prompt | Feature | Effort | Impact |
|----------|--------|---------|--------|--------|
| 1 | 29 | AI Backend (Ollama + Cloud) | High | Critical — foundation |
| 2 | 30 | Polish Styles System | Medium | High — defines user value |
| 3 | 31 | Smart Dictation Shortcut & Flow | High | Critical — user-facing feature |
| 4 | 32 | AI Settings UI & Setup Guide | Medium | High — discoverability |

---

## Tips for Working with Claude Code

- Run each prompt separately and verify it works before moving to the next
- If compilation fails, paste the error and ask Claude Code to fix it
- After Prompt 1, always keep `cargo tauri dev` running to catch issues early
- The first Rust compile takes 3-5 minutes (whisper.cpp builds from source)
- If whisper-rs fails to compile, make sure cmake is installed: `brew install cmake`
