# Web App — Beta Release Tasks

Changes needed in the `omWhisperWebApp` repo before beta goes live.

---

## 1. Update `public/api/version.json`

Bump the version and point the download URL to the real beta DMG.

**File:** `public/api/version.json`

```json
{
  "latest": "0.1.0-beta.1",
  "min_supported": "0.1.0-beta.1",
  "download_url": "https://omwhisper.in/download/OmWhisper_0.1.0-beta.1_aarch64.dmg",
  "release_notes": "Beta release — all features unlocked, in-app feedback, improved auto-paste.",
  "release_date": "2026-03-18"
}
```

> The desktop app reads this file on launch to check for updates. The `download_url` must match the actual DMG filename you upload to the server.

---

## 2. Add Gatekeeper warning near every download button

The app is unsigned for beta. Users who just double-click will hit a macOS block. A one-liner near each download button prevents confusion.

**Where to add it:**
- `src/components/Hero.tsx` — below the main download button (around line 230–240)
- `src/components/FinalCTA.tsx` — below the download button (around line 54–69)

**Text to add** (small muted line, no styling prescription):

```
⚠️ First launch: right-click the app → Open to bypass the macOS security warning.
```

Or shorter:
```
macOS only · Unsigned beta — right-click → Open on first launch
```

---

## 3. Add a `/beta-install` page

A dedicated installation guide page so you can link to it from the download buttons and emails. This replaces the need to share the private GitHub repo's `BETA_INSTALL.md`.

**New file:** `src/pages/BetaInstall.tsx`

**Content to cover (in order):**

1. **Open the DMG** — double-click the downloaded file
2. **Drag to Applications** — drag OmWhisper into the Applications folder
3. **Right-click → Open** *(most important step)* — do NOT double-click; right-click the app in Applications → Open → click Open on the warning dialog
4. **Grant Microphone permission** — click Allow when prompted; if missed: System Settings → Privacy → Microphone → enable OmWhisper
5. **Grant Accessibility permission** — System Settings → Privacy → Accessibility → add OmWhisper; required for auto-paste; without it transcription still works but won't paste automatically
6. **You're set** — press ⌘⇧V from any app to start dictating

Add a note at the bottom:
> Found a bug or have feedback? Use **Settings → About → Send Feedback** inside the app.

**Register the route in `src/App.tsx`:**

```tsx
import BetaInstall from "./pages/BetaInstall";

// inside <Routes>:
<Route path="/beta-install" element={<BetaInstall />} />
```

**Update `vercel.json`** to include the new route (follow the existing pattern for `/privacy` and `/terms`).

---

## 4. Link to `/beta-install` from download buttons

After adding the page, update the download button areas in:

- `src/components/Hero.tsx` — add a small "Installation guide →" link below the download button
- `src/components/FinalCTA.tsx` — same

Example link text: `Need help installing? See the guide →`

---

## 5. Update `src/config.ts` download URL

**File:** `src/config.ts`

```ts
export const DOWNLOAD_URL = 'https://omwhisper.in/download/OmWhisper_0.1.0-beta.1_aarch64.dmg';
```

> Update this once the DMG is built and uploaded. Filename must match exactly.

---

## Priority Order

| # | Task | Blocking? |
|---|------|-----------|
| 1 | Update `version.json` | Yes — app update checker uses this |
| 2 | Gatekeeper warning near download buttons | Yes — users will get stuck without it |
| 3 | Add `/beta-install` page | Yes — needed for install guidance |
| 4 | Link to `/beta-install` from buttons | After #3 is done |
| 5 | Update `config.ts` download URL | Yes — once DMG is uploaded |

---

## Notes

- The DMG filename must include the architecture: `aarch64` for Apple Silicon, `x86_64` for Intel. Build with `bash scripts/build-release.sh` from the desktop app repo.
- `version.json` is served as a static file by Vercel — no API needed.
- The existing Pricing section can stay as-is for beta (or hide it if you don't want to show pricing yet).
