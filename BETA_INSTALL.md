# OmWhisper Beta — Installation Guide

Thank you for testing OmWhisper! Because this is a beta build, it is not yet signed with an Apple Developer certificate. Follow the steps below to install it on your Mac.

---

## Step 1 — Open the DMG

Double-click the `OmWhisper_0.1.0-beta.1_x64.dmg` file you downloaded.

## Step 2 — Drag to Applications

In the window that opens, drag **OmWhisper** into the **Applications** folder.

## Step 3 — Open with Right-Click (Important)

macOS will block the app if you double-click it the first time. Instead:

1. Open **Finder** → **Applications**
2. Find **OmWhisper**
3. **Right-click** (or Control-click) on it
4. Select **Open** from the menu
5. Click **Open** on the warning dialog

> You only need to do this once. After the first launch, double-clicking works normally.

---

## Step 4 — Grant Microphone Permission

On first launch, macOS will ask for microphone access. Click **Allow**.

If you accidentally denied it:
**System Settings → Privacy & Security → Microphone → enable OmWhisper**

---

## Step 5 — Grant Accessibility Permission (for Auto-Paste)

Auto-paste (automatically typing your transcription into the focused app) requires Accessibility access.

1. Go to **System Settings → Privacy & Security → Accessibility**
2. Click the **+** button and add **OmWhisper**
3. Make sure the toggle is **on**

> Without this, transcriptions are still copied to your clipboard — you can paste manually with Cmd+V.

---

## Using OmWhisper

- OmWhisper lives in your **menu bar** (top-right, ॐ icon)
- Press **Cmd+Shift+V** to start and stop recording
- Your transcription is automatically pasted into whatever app you were typing in

---

## Sending Feedback

Found a bug or have a suggestion? Use the **Feedback** button in **Settings → About** — it sends a report directly to the team.

---

## Uninstalling

Drag OmWhisper from Applications to Trash. App data (models, history) is stored at:
`~/Library/Application Support/com.omwhisper.app/`
Delete that folder to remove all data.
