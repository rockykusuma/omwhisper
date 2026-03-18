# PRO Version Revert Guide

This document tracks every change made to remove PRO/licensing features for the beta release.
Use it as a checklist when re-introducing the PRO tier.

> **Beta branch:** `feature/beta-release` (merged to `main` after beta)
> **Last updated:** 2026-03-18

---

## What Still Exists (Do NOT remove — needed for PRO revert)

The backend licensing infrastructure was intentionally kept intact. Nothing below needs to be rebuilt from scratch.

### Backend — `src-tauri/src/`

| File | What's preserved |
|------|-----------------|
| `license/mod.rs` | Full license module: `is_active()`, `activate()`, `deactivate()`, Keychain storage, machine ID, GracePeriod/Expired states |
| `license/validator.rs` | HTTP calls to Lemon Squeezy API for activation/validation/deactivation |
| `commands.rs` | `get_license_status`, `activate_license`, `deactivate_license`, `get_usage_today` commands all intact |
| `commands.rs` | `UsageUpdate` and `UsageToday` structs intact |
| `history.rs` | `FREE_TIER_SECONDS` constant, `add_seconds_today()`, `get_seconds_used_today()`, `daily_usage` SQLite table |
| `settings.rs` | `license_key` field in `AppSettings` struct |

---

## What Was Removed — Restore Checklist

### 1. `src-tauri/src/commands.rs` — Usage gate in `start_transcription`

**Restore this block** at the top of `start_transcription`, before "Clear any cancellation":

```rust
// --- License / Usage gate ---
let is_licensed = crate::license::is_active();
if !is_licensed {
    let seconds_used = history::get_seconds_used_today().unwrap_or(0);
    if seconds_used >= history::FREE_TIER_SECONDS {
        return Err("free_tier_limit_reached".to_string());
    }
}
```

---

### 2. `src-tauri/src/commands.rs` — Usage timer thread in `start_transcription`

**Restore the `usage_running` clone** from SharedState and **restore the timer thread** after `let model_path = resolve_model_path(&model);`.

First, restore the variable binding (currently collapsed to a plain block):

```rust
let usage_running = {
    let mut s = state.lock().expect("state mutex poisoned");
    s.capture = Some(capture);
    s.recording_start_time = Some(std::time::Instant::now());
    s.usage_running.store(true, Ordering::SeqCst);
    s.usage_running.clone()
};
```

Then restore the timer thread (insert after `usage_running` binding, before the transcription thread):

```rust
// Spawn usage-tracking timer — ticks every 10 s, emits usage-update, enforces limit.
let app_for_usage = app.clone();
let usage_running_timer = usage_running.clone();
let is_licensed_for_timer = is_licensed; // captured before async move
std::thread::spawn(move || {
    const TICK: u64 = 10;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(TICK));
        if !usage_running_timer.load(Ordering::SeqCst) {
            break;
        }
        if !is_licensed_for_timer {
            let _ = history::add_seconds_today(TICK as i64);
            let seconds_used = history::get_seconds_used_today().unwrap_or(0);
            let seconds_remaining = (history::FREE_TIER_SECONDS - seconds_used).max(0);
            let _ = app_for_usage.emit("usage-update", UsageUpdate {
                seconds_used,
                seconds_remaining,
                is_free_tier: true,
            });
            if seconds_used >= history::FREE_TIER_SECONDS {
                // Signal frontend to stop recording
                let _ = app_for_usage.emit("usage-limit-reached", ());
                break;
            }
        }
    }
});
```

---

### 3. `src/components/AiModelsView.tsx` — License state

**Restore** the `_isLicensed` state and `get_license_status` call in the component body (used to gate model downloads for free tier):

```tsx
const [isLicensed, setIsLicensed] = useState(false);
```

In `useEffect`:
```tsx
invoke<string>("get_license_status")
  .then((s) => setIsLicensed(s === "Licensed" || s === "GracePeriod"))
  .catch(() => {});
```

Then use `isLicensed` to lock non-tiny models behind a paywall in the model list render.

---

### 4. `src/components/License.tsx` — Full license page (DELETED)

This file was deleted. It contained:
- License activation form with key input
- License status display (email, activated date)
- Deactivate button
- Link to purchase page (Lemon Squeezy)

**Restore from git history:**
```bash
git show <beta-branch-base-commit>:src/components/License.tsx
```

Or find it in git log before the `feature/beta-release` branch:
```bash
git log --all --oneline -- src/components/License.tsx
```

---

### 5. `src/components/LicenseActivation.tsx` — Inline activation widget (DELETED)

Small inline widget used in onboarding and Settings for quick key entry.

**Restore from git history:**
```bash
git show <beta-branch-base-commit>:src/components/LicenseActivation.tsx
```

---

### 6. `src/components/Sidebar.tsx` — PRO badge, usage bar, upgrade CTA

Replace the `BETA` badge with the conditional `PRO` badge:

```tsx
{isLicensed && (
  <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--accent)", color: "#000" }}>
    PRO
  </span>
)}
```

Restore the license state and usage tracking in Sidebar:
- `isFreeTier`, `isLicensed`, `usageSeconds`, `remaining`, `usagePct` state
- `useEffect` listening to `license-status` and `usage-update` events
- Usage bar in the footer
- "Upgrade" CTA button in the footer when `isFreeTier`
- `View = "license"` added back to the view type union

---

### 7. `src/App.tsx` — License page route, upgrade modal, usage-limit listener

Restore:
- `import LicensePage from "./components/License"`
- `import LicenseActivation from "./components/LicenseActivation"`
- `showUpgradePrompt` state
- `useEffect` listening to `usage-limit-reached` → sets `showUpgradePrompt(true)`
- `{activeView === "license" && <LicensePage />}` in the view router
- Upgrade modal JSX (shown when `showUpgradePrompt`)

---

### 8. `src/components/TranscriptionHistory.tsx` — Locked export for free tier

Replace always-visible export dropdown with the conditional:

```tsx
{isLicensed ? (
  <ExportDropdown ... />
) : (
  <LockedExport onClick={() => setActiveView("license")} />
)}
```

Restore `isLicensed` state and `get_license_status` call in the component.

---

### 9. `src/components/Onboarding.tsx` — Free tier messaging on final step

Restore the callout block on the final onboarding screen:

```tsx
<div className="w-full rounded-xl p-4 mt-4" style={{ background: "..." }}>
  <p className="text-sm font-semibold">Free Tier</p>
  <p className="text-xs mt-1" style={{ color: "var(--t2)" }}>
    30 minutes of transcription per day. Upgrade for unlimited access — just $12, one time.
  </p>
</div>
```

---

### 10. `src/components/Settings.tsx` — License tab

Restore the `License` sub-tab in Settings:
- Tab entry in the settings nav (between `Transcription` and `About`)
- `LicenseSection` component rendering when `activeTab === "license"`

---

## Model Gating (Free Tier)

Free tier users were restricted to `tiny.en` only. All other models showed a lock icon and required PRO.

This gating logic lived in `AiModelsView.tsx` in the model list render — check `isLicensed` and if false, show a locked state for non-`tiny.en` models.

---

## Lemon Squeezy Config

- **Product page URL:** stored in `License.tsx` as the "Buy" link
- **API calls:** `src-tauri/src/license/validator.rs` — update API key/product ID there
- **Keychain service name:** `"com.omwhisper.app"` (in `license/mod.rs`)

---

## Quick Recovery Command

To see the exact state of any deleted/modified file before the beta changes:

```bash
# Find the last commit before beta branch diverged
git log --oneline main | head -5

# View a deleted file
git show <commit-hash>:src/components/License.tsx

# Diff a modified file against pre-beta state
git diff <commit-hash> HEAD -- src/components/Sidebar.tsx
```
