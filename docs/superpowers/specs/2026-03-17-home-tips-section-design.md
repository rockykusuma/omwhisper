# Home Screen Tips Section — Design Spec

## Goal

Surface a compact, always-visible tips section on the idle home screen to help users discover powerful features they would otherwise miss without exploring settings.

## Context

OmWhisper has many high-value features (Smart Dictation, Push-to-Talk, Custom Vocabulary, Word Replacements, multilingual models) that are buried in settings tabs. New and time-poor users rarely discover them. The home screen has substantial empty space when idle — the record button, status line, and mic/model row leave roughly 250px unused. A tips section fills this space with actionable discoverability hints.

`StatsCard` was built for the empty state in Phase 4 but is not currently rendered in `HomeView.tsx`. `TipsSection` occupies that same space. `StatsCard` is out of scope for this feature.

## Design Decisions

### Style: Compact stacked list (always visible)

Each tip is a compact row: emoji icon · bold headline · one-line description · right-aligned `ChevronRight`. All tips visible simultaneously, equal weight, no carousel or rotation. Dividers between rows use `color-mix(in srgb, var(--t1) 6%, transparent)` — the same token used for dividers elsewhere in `HomeView`.

Rejected alternatives:
- **Single card with prev/next arrows** — hides tips behind user interaction; most users never click through
- **Auto-rotating carousel** — distracting in an otherwise calm, focused UI; users miss tips they weren't looking for when the rotation happened

### Visibility: Idle only

Tips show only when the home screen is truly idle:
- **Hidden** while `isRecording === true`
- **Hidden** while `showLiveTranscript === true` (this persists after recording stops until the user manually clicks "Clear")

**Implication:** after every completed recording session, tips are hidden until the user clears the transcript panel. This is the desired behaviour — the transcript panel is the active focus post-recording, and tips are background furniture for the empty state. This is a conscious trade-off, not an oversight.

No dismiss button. Tips are permanent UI furniture, not a one-time nudge.

### Architecture: Pure frontend, static array

No backend changes. No new Tauri commands. No settings flags. The tips are a hardcoded static array inside a new `TipsSection` component. Adding or removing tips requires only editing that array.

## Routing

The `navigate(target: string)` function in `App.tsx` splits on `:` → `[view, tab]`, calls `setActiveView(view)` and `setSettingsInitialTab(tab)`. Valid routing targets:

| Target string | Destination |
|--------------|-------------|
| `"models"` | `AiModelsView` (default tab) |
| `"models:whisper"` | `AiModelsView` → Whisper Models tab |
| `"models:smart-dictation"` | `AiModelsView` → Smart Dictation tab |
| `"settings:general"` | `SettingsPanel` → General tab |
| `"settings:audio"` | `SettingsPanel` → Audio tab |
| `"settings:transcription"` | `SettingsPanel` → Transcription tab |
| `"vocabulary"` | `Vocabulary` view |
| `"history"` | `TranscriptionHistory` view |

`TipsSection` receives `onNavigate: (view: string) => void` and calls it with the target string verbatim — no splitting or modification inside the component.

## Component Design

### New file: `src/components/TipsSection.tsx`

Props:
```typescript
interface TipsSectionProps {
  onNavigate: (view: string) => void;
}
```

Internal tip type:
```typescript
interface Tip {
  icon: string;        // emoji, rendered as a <span> — not a lucide icon
  headline: string;    // bold short label
  description: string; // one-line explanation
  target: string;      // passed verbatim to onNavigate()
}
```

Static tips array (7 tips, initial set):

| # | Icon | Headline | Description | Target |
|---|------|----------|-------------|--------|
| 1 | ⚡ | Speed vs accuracy | tiny.en is fastest — try small or large-v3-turbo for longer or technical dictations | `"models:whisper"` |
| 2 | 🌐 | Multilingual | Switch to a non-.en model to transcribe any language, or translate it to English live | `"settings:transcription"` |
| 3 | ✨ | Smart Dictation | ⌘⇧B sends your voice through AI — cleans grammar, writes emails, formats meeting notes | `"models:smart-dictation"` |
| 4 | 📖 | Custom Vocabulary | Whisper keeps mishearing a word? Add it once and it'll always get it right | `"vocabulary"` |
| 5 | 🔁 | Word Replacements | Auto-swap phrases after transcription — remove filler words or fix recurring mistakes | `"vocabulary"` |
| 6 | 🎯 | Push-to-Talk | Hold a key to record, release to stop — faster than toggle mode for quick dictations | `"settings:general"` |
| 7 | 📋 | History & Export | Every transcription is saved and searchable. Export as text, markdown, or JSON | `"history"` |

### Render structure

The outer container uses the same neumorphic card style as the active setup row (`var(--bg)`, `var(--nm-raised-sm)`, `rounded-2xl`). Each row is a `<button>` with hover state using `color-mix(in srgb, var(--t1) 4%, transparent)` — the same pattern as the mic/model row buttons in `HomeView`.

```
<div>  ← rounded-2xl card container, nm-raised-sm
  {tips.map((tip, i) => (
    <>
      <button onClick={() => onNavigate(tip.target)}>
        <span>{tip.icon}</span>              ← emoji, fixed width
        <div>
          <span class="font-semibold">{tip.headline}</span>
          {" — "}
          <span class="text-t3">{tip.description}</span>
        </div>
        <ChevronRight size={11} />           ← lucide, var(--t4), shrink-0
      </button>
      {i < tips.length - 1 && <div class="divider" />}   ← color-mix(--t1 6%)
    </>
  ))}
</div>
```

Text sizes: headline `text-xs font-semibold` in `var(--t2)`, description `text-xs` in `var(--t3)`, emoji `text-sm`.

### Integration into `HomeView.tsx`

`TipsSection` is rendered at the bottom of the home screen flex column, after the active setup row. Conditional:

```tsx
{!isRecording && !showLiveTranscript && (
  <TipsSection onNavigate={onNavigate} />
)}
```

No new props needed on `HomeView` itself — `isRecording`, `showLiveTranscript`, and `onNavigate` are all already present.

## Files Changed

| File | Change |
|------|--------|
| `src/components/TipsSection.tsx` | **Create** — new component with static tips array |
| `src/components/HomeView.tsx` | **Modify** — import and conditionally render `TipsSection` |

## Out of Scope

- Tips stored in backend / fetched from server
- Per-tip dismiss / "don't show again" tracking
- Tip ordering based on user behaviour
- Animated transitions between states
- `StatsCard` integration
