# Home Screen Tips Section — Design Spec

## Goal

Surface a compact, always-visible tips section on the idle home screen to help users discover powerful features they would otherwise miss without exploring settings.

## Context

OmWhisper has many high-value features (Smart Dictation, Push-to-Talk, Custom Vocabulary, Word Replacements, multilingual models) that are buried in settings tabs. New and time-poor users rarely discover them. The home screen has substantial empty space when idle — the record button, status line, and mic/model row leave roughly 250px unused. A tips section fills this space with actionable discoverability hints.

## Design Decisions

### Style: Compact stacked list (always visible)

Each tip is a compact row: icon · bold headline · one-line description · right-aligned chevron. All tips visible simultaneously, equal weight, no carousel or rotation. Subtle dividers between rows.

Rejected alternatives:
- **Single card with prev/next arrows** — hides tips behind user interaction; most users never click through
- **Auto-rotating carousel** — distracting in an otherwise calm, focused UI; users miss tips they weren't looking for when the rotation happened

### Visibility: Idle only

Tips show only when the home screen is truly idle:
- **Hidden** while `isRecording === true`
- **Hidden** while `showLiveTranscript === true` (during recording and until transcript is cleared)
- **Shown** in all other states

No dismiss button. Tips are permanent UI furniture, not a one-time nudge.

### Architecture: Pure frontend, static array

No backend changes. No new Tauri commands. No settings flags. The tips are a hardcoded static array inside a new `TipsSection` component. Adding or removing tips requires only editing that array.

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
  icon: string;        // emoji
  headline: string;    // bold short label
  description: string; // one-line explanation
  target: string;      // onNavigate destination
}
```

Static tips array (7 tips, initial set):

| # | Icon | Headline | Description | Target |
|---|------|----------|-------------|--------|
| 1 | ⚡ | Speed vs accuracy | tiny.en is fastest — try small or large-v3-turbo for longer or technical dictations | `models` |
| 2 | 🌐 | Multilingual | Switch to a non-.en model to transcribe any language, or translate it to English live | `settings:transcription` |
| 3 | ✨ | Smart Dictation | ⌘⇧B sends your voice through AI — cleans grammar, writes emails, formats meeting notes | `settings:ai` |
| 4 | 📖 | Custom Vocabulary | Whisper keeps mishearing a word? Add it once and it'll always get it right | `vocabulary` |
| 5 | 🔁 | Word Replacements | Auto-swap phrases after transcription — remove filler words or fix recurring mistakes | `vocabulary` |
| 6 | 🎯 | Push-to-Talk | Hold a key to record, release to stop — faster than toggle mode for quick dictations | `settings:general` |
| 7 | 📋 | History & Export | Every transcription is saved and searchable. Export as text, markdown, or JSON | `history` |

### Render structure

```
<div>  ← tips container, shown only when !isRecording && !showLiveTranscript
  {tips.map((tip, i) => (
    <button onClick={() => onNavigate(tip.target)}>
      <span>{tip.icon}</span>
      <div>
        <span>{tip.headline}</span>
        {" — "}
        <span>{tip.description}</span>
      </div>
      <ChevronRight />
    </button>
    {i < tips.length - 1 && <divider />}
  ))}
</div>
```

Visual style matches the existing neumorphic card aesthetic (`var(--bg)`, `var(--nm-raised-sm)`, `var(--t2)`, `var(--t4)`, `var(--accent)`). Hover state uses the same pattern as the existing mic/model row buttons.

### Integration into `HomeView.tsx`

`TipsSection` is rendered at the bottom of the home screen flex column, after the active setup row. It receives `onNavigate` which is already available in `HomeView`. Visibility is controlled by the existing `isRecording` and `showLiveTranscript` state already present in that component.

No new props needed on `HomeView` itself.

## Files Changed

| File | Change |
|------|--------|
| `src/components/TipsSection.tsx` | **Create** — new component with static tips array |
| `src/components/HomeView.tsx` | **Modify** — import and render `TipsSection`, pass `isRecording`, `showLiveTranscript`, `onNavigate` |

## Out of Scope

- Tips stored in backend / fetched from server
- Per-tip dismiss / "don't show again" tracking
- Tip ordering based on user behaviour
- Animated transitions between states
