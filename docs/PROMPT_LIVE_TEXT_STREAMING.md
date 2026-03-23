# Feature: Live Text Streaming in Overlay Window

## Context

OmWhisper already emits `transcription-update` events in real-time as each VAD chunk is processed by Whisper. The frontend silently accumulates these in `segmentsRef` but never displays them until recording stops. This task adds a live text bubble below the overlay recording pill so users see transcription appearing in real-time (~2-3 second bursts). **No Rust/backend changes needed — frontend only.**

## Scope

- **Overlay window only** — show live text in a translucent bubble below the recording pill
- **HomeView** — no changes
- **App.tsx** — no changes to segment collection or paste logic
- **Smart Dictation (⌘⇧B)** — live text shows during recording, then PolishingPill takes over on stop

## Existing event flow (do not modify)

1. `start_transcription` → mic + VAD + Whisper thread starts
2. Each processed speech chunk → `app.emit("transcription-update", { segments: [...] })` (already real-time)
3. `stop_transcription` → `app.emit("transcription-complete")` → paste logic runs
4. `App.tsx` collects segments in `segmentsRef` for paste — **leave this untouched**

---
layout: default

## Task 1: Add live text state and listener to OverlayWindow

**File:** `src/components/OverlayWindow.tsx`

### 1a. Add state + ref inside `OverlayWindow()` component, near the existing `useState` declarations (alongside `overlayStyle`, `isPolishing`, etc.):

```tsx
const [liveText, setLiveText] = useState<string>("");
const liveTextRef = useRef<string>("");
```

### 1b. Add a new `useEffect` for live text streaming. Place it after the existing `polish-state` listener useEffect:

```tsx
// ── Live transcription text ─────────────────────────────────────────
useEffect(() => {
  const unlistenUpdate = listen<{ segments: { text: string }[] }>(
    "transcription-update",
    (event) => {
      const newText = event.payload.segments
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(" ");
      if (newText) {
        liveTextRef.current = liveTextRef.current
          ? liveTextRef.current + " " + newText
          : newText;
        setLiveText(liveTextRef.current);
      }
    }
  );

  const unlistenStart = listen<boolean>("recording-state", (e) => {
    if (e.payload) {
      liveTextRef.current = "";
      setLiveText("");
    }
  });

  const unlistenComplete = listen("transcription-complete", () => {
    setTimeout(() => {
      liveTextRef.current = "";
      setLiveText("");
    }, 500);
  });

  return () => {
    unlistenUpdate.then((f) => f());
    unlistenStart.then((f) => f());
    unlistenComplete.then((f) => f());
  };
}, []);
```

---
layout: default

## Task 2: Add `LiveTextBubble` component

**File:** `src/components/OverlayWindow.tsx`

Add this component **above** the `export default function OverlayWindow()` declaration, after the existing `PolishingPill` component:

```tsx
function LiveTextBubble({ text }: { text: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  if (!text) return null;

  const displayText = text.length > 150 ? "…" + text.slice(-150) : text;

  return (
    <>
      <style>{`
        @keyframes blink-cursor { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        .live-bubble::-webkit-scrollbar { display: none; }
      `}</style>
      <div
        ref={scrollRef}
        className="live-bubble"
        style={{
          maxWidth: 320,
          maxHeight: 60,
          overflowY: "auto",
          background: "rgba(10, 16, 13, 0.88)",
          backdropFilter: "blur(14px) saturate(180%)",
          WebkitBackdropFilter: "blur(14px) saturate(180%)",
          border: "0.5px solid rgba(29,158,117,0.3)",
          borderRadius: 10,
          padding: "8px 12px",
          marginTop: 4,
          scrollbarWidth: "none",
        }}
      >
        <p
          style={{
            color: "rgba(255, 255, 255, 0.75)",
            fontSize: 11,
            lineHeight: "1.5",
            margin: 0,
            fontWeight: 400,
            letterSpacing: "0.2px",
            wordBreak: "break-word",
          }}
        >
          {displayText}
          <span
            style={{
              display: "inline-block",
              width: 3,
              height: 12,
              background: "rgba(29,158,117,0.75)",
              marginLeft: 3,
              borderRadius: 1,
              animation: "blink-cursor 1s step-end infinite",
              verticalAlign: "text-bottom",
            }}
          />
        </p>
      </div>
    </>
  );
}
```

---
layout: default

## Task 3: Render LiveTextBubble in the OverlayWindow JSX

**File:** `src/components/OverlayWindow.tsx`

Find the return statement of the `OverlayWindow` component. It currently looks like:

```tsx
return (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
    {isPolishing ? (
      <PolishingPill large={overlayStyle === "waveform"} />
    ) : (
      <>
        {overlayStyle === "waveform" ? <WaveformPill elapsed={elapsed} /> : <MicroPill elapsed={elapsed} />}
        {applyPolishRegular && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "rgba(29,158,117,0.10)",
            border: "0.5px solid rgba(29,158,117,0.25)",
            borderRadius: 10,
            padding: "3px 8px",
          }}>
            <Sparkles size={9} style={{ color: "#34d399" }} />
            <span style={{ color: "#34d399", fontSize: 9, fontWeight: 500, letterSpacing: "0.4px" }}>AI Polish</span>
          </div>
        )}
      </>
    )}
  </div>
);
```

Add the `LiveTextBubble` as the **last child** of the outer `<div>`, after the closing of the ternary (after the `)}` that closes the `isPolishing` ternary):

```tsx
    {!isPolishing && liveText && <LiveTextBubble text={liveText} />}
  </div>
);
```

So the final structure becomes:

```tsx
return (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
    {isPolishing ? (
      <PolishingPill large={overlayStyle === "waveform"} />
    ) : (
      <>
        {overlayStyle === "waveform" ? <WaveformPill elapsed={elapsed} /> : <MicroPill elapsed={elapsed} />}
        {applyPolishRegular && (
          /* ... existing AI Polish badge unchanged ... */
        )}
      </>
    )}
    {!isPolishing && liveText && <LiveTextBubble text={liveText} />}
  </div>
);
```

---
layout: default

## Task 4: Increase overlay window height (if needed)

**File:** `src-tauri/tauri.conf.json`

Find the window config with `"label": "overlay"`. If the text bubble gets clipped during testing, increase the `height` value to around 200–250. Test first before changing — the current height may already accommodate the bubble.

---
layout: default

## What NOT to change

- `App.tsx` — the `segmentsRef` collection and paste-on-complete logic must remain exactly as-is
- `HomeView.tsx` — no changes
- Any Rust files — the backend already streams `transcription-update` events correctly
- The `transcription-complete` handler in `App.tsx` — paste logic is untouched
- The existing `recording-state` listener useEffect in `OverlayWindow.tsx` — the new useEffect in Task 1b adds a separate listener; do not merge them

## Testing

1. Start recording with ⌘⇧V — overlay pill appears
2. Speak a sentence — after ~2-3 seconds, a translucent text bubble appears below the pill with transcribed text and a blinking emerald cursor
3. Keep speaking — text accumulates, auto-scrolls, trims from front when >150 chars
4. Stop recording — text pastes as before, overlay bubble clears after 500ms
5. Test Smart Dictation (⌘⇧B) — live text appears during recording, then "AI Polishing" pill takes over on stop (bubble disappears when `isPolishing` becomes true)
6. Test with both overlay styles (micro + waveform) — the text bubble appears below both
7. Test with overlay disabled (`show_overlay: false` in settings) — no overlay, no bubble, no errors

## Style reference

- **Bubble background:** `rgba(10, 16, 13, 0.88)` with `blur(14px) saturate(180%)` backdrop
- **Bubble border:** `0.5px solid rgba(29,158,117,0.3)` — subtle emerald
- **Bubble size:** max 320px wide, max 60px tall, scrollable, hidden scrollbar
- **Text:** `rgba(255, 255, 255, 0.75)`, 11px, line-height 1.5
- **Cursor:** 3px wide, 12px tall, `rgba(29,158,117,0.75)`, 1s step blink
- **Truncation:** Shows last ~150 chars with leading `…` when text exceeds limit
