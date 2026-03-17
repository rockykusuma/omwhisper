# Home Tips Section Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact stacked tips section to the idle home screen that surfaces 7 hidden power features with deep-links to the relevant settings.

**Architecture:** A new pure-React `TipsSection` component holds a static array of 7 tips and renders them as clickable rows inside a neumorphic card. `HomeView` conditionally renders it when not recording and the transcript panel is not showing. No backend changes.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS v4, lucide-react, Vitest + React Testing Library

---

## Chunk 1: TipsSection component + tests

### Task 1: Create TipsSection component with tests

**Files:**
- Create: `src/components/TipsSection.tsx`
- Create: `src/components/TipsSection.test.tsx`

---

- [ ] **Step 1: Write the failing tests**

Create `src/components/TipsSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TipsSection from "./TipsSection";

const mockNavigate = vi.fn();

beforeEach(() => {
  mockNavigate.mockReset();
});

describe("TipsSection", () => {
  it("renders all 7 tips", () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    expect(screen.getByText("Speed vs accuracy")).toBeInTheDocument();
    expect(screen.getByText("Multilingual")).toBeInTheDocument();
    expect(screen.getByText("Smart Dictation")).toBeInTheDocument();
    expect(screen.getByText("Custom Vocabulary")).toBeInTheDocument();
    expect(screen.getByText("Word Replacements")).toBeInTheDocument();
    expect(screen.getByText("Push-to-Talk")).toBeInTheDocument();
    expect(screen.getByText("History & Export")).toBeInTheDocument();
  });

  it("clicking Speed vs accuracy navigates to models:whisper", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Speed vs accuracy").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("models:whisper");
  });

  it("clicking Smart Dictation navigates to models:smart-dictation", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Smart Dictation").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("models:smart-dictation");
  });

  it("clicking Multilingual navigates to settings:transcription", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Multilingual").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("settings:transcription");
  });

  it("clicking Push-to-Talk navigates to settings:general", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Push-to-Talk").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("settings:general");
  });

  it("clicking Custom Vocabulary navigates to vocabulary", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Custom Vocabulary").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("vocabulary");
  });

  it("clicking History & Export navigates to history", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("History & Export").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("history");
  });

  it("renders 6 dividers between 7 tips", () => {
    const { container } = render(<TipsSection onNavigate={mockNavigate} />);
    // Each divider is a 1px-height div with mx-4
    const dividers = container.querySelectorAll(".mx-4");
    expect(dividers).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- TipsSection
```

Expected: FAIL — `Cannot find module './TipsSection'`

- [ ] **Step 3: Implement TipsSection**

Create `src/components/TipsSection.tsx`:

```tsx
import { ChevronRight } from "lucide-react";

interface Tip {
  icon: string;        // emoji, rendered as <span> — not a lucide icon
  headline: string;
  description: string;
  target: string;      // passed verbatim to onNavigate()
}

const TIPS: Tip[] = [
  {
    icon: "⚡",
    headline: "Speed vs accuracy",
    description: "tiny.en is fastest — try small or large-v3-turbo for longer or technical dictations",
    target: "models:whisper",
  },
  {
    icon: "🌐",
    headline: "Multilingual",
    description: "Switch to a non-.en model to transcribe any language, or translate it to English live",
    target: "settings:transcription",
  },
  {
    icon: "✨",
    headline: "Smart Dictation",
    description: "⌘⇧B sends your voice through AI — cleans grammar, writes emails, formats meeting notes",
    target: "models:smart-dictation",
  },
  {
    icon: "📖",
    headline: "Custom Vocabulary",
    description: "Whisper keeps mishearing a word? Add it once and it'll always get it right",
    target: "vocabulary",
  },
  {
    icon: "🔁",
    headline: "Word Replacements",
    description: "Auto-swap phrases after transcription — remove filler words or fix recurring mistakes",
    target: "vocabulary",
  },
  {
    icon: "🎯",
    headline: "Push-to-Talk",
    description: "Hold a key to record, release to stop — faster than toggle mode for quick dictations",
    target: "settings:general",
  },
  {
    icon: "📋",
    headline: "History & Export",
    description: "Every transcription is saved and searchable. Export as text, markdown, or JSON",
    target: "history",
  },
];

interface TipsSectionProps {
  onNavigate: (view: string) => void;
}

export default function TipsSection({ onNavigate }: TipsSectionProps) {
  return (
    <div
      className="rounded-2xl overflow-hidden flex-shrink-0"
      style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
    >
      {TIPS.map((tip, i) => (
        <div key={tip.headline}>
          <button
            onClick={() => onNavigate(tip.target)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 cursor-pointer"
            style={{ background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 4%, transparent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span className="text-sm shrink-0">{tip.icon}</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold" style={{ color: "var(--t2)" }}>
                {tip.headline}
              </span>
              <span className="text-xs" style={{ color: "var(--t3)" }}>
                {" — "}
                {tip.description}
              </span>
            </div>
            <ChevronRight size={11} className="shrink-0" style={{ color: "var(--t4)" }} />
          </button>
          {i < TIPS.length - 1 && (
            <div
              className="mx-4"
              style={{ height: "1px", background: "color-mix(in srgb, var(--t1) 6%, transparent)" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- TipsSection
```

Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/TipsSection.tsx src/components/TipsSection.test.tsx
git commit -m "✅ test(tips): add TipsSection component and tests"
```

---

## Chunk 2: Wire TipsSection into HomeView

### Task 2: Integrate TipsSection into HomeView

**Files:**
- Modify: `src/components/HomeView.tsx` (lines 1–5 for import, line 336 for render)

---

- [ ] **Step 1: Add import to HomeView.tsx**

At the top of `src/components/HomeView.tsx`, add the import after the existing local imports (after line 5):

```tsx
// existing imports:
import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Mic, MicOff, Sparkles, ChevronRight, Cpu } from "lucide-react";
import type { TranscriptionSegment } from "../types";
import TipsSection from "./TipsSection";   // ← add this line
```

- [ ] **Step 2: Render TipsSection after the active setup row**

In `src/components/HomeView.tsx`, insert `<TipsSection />` as the last child of the root `<div className="flex flex-col h-full ...">` (line 155). Concretely: after the setup row's closing `</div>` on line 336, before the root `</div>` on line 337. Do not insert it outside the root div.

```tsx
      {/* ── Tips ────────────────────────────────────────────────────── */}
      {!isRecording && !showLiveTranscript && (
        <TipsSection onNavigate={onNavigate} />
      )}
```

The final few lines of the return should look like:

```tsx
      {/* ── Active setup row ─────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden flex flex-shrink-0"
        style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
      >
        {/* ...mic and model buttons unchanged... */}
      </div>

      {/* ── Tips ────────────────────────────────────────────────────── */}
      {!isRecording && !showLiveTranscript && (
        <TipsSection onNavigate={onNavigate} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 4: Run TypeScript build check**

```bash
npm run build
```

Expected: Builds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/HomeView.tsx
git commit -m "✨ feat(home): add tips section for feature discoverability"
```

---

## Verification

After both tasks are complete:

1. Run `cargo tauri dev`
2. Open the app — the home screen in idle state should show the 7 tips card below the mic/model row
3. Start a recording — tips card should disappear
4. Stop recording — tips stay hidden while transcript panel is visible
5. Click "Clear" on the transcript panel — tips reappear
6. Click any tip row — should navigate to the correct tab/view

## Done
