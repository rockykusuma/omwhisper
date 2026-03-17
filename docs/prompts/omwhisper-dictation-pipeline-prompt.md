# OmWhisper — Phase 4: Two-Stage Dictation Pipeline (STT + LLM Cleanup)

## Context

OmWhisper is a macOS voice transcription app built with Tauri 2 + React + TypeScript + Rust + whisper.cpp. Phases 1–3 are complete. The app currently uses whisper.cpp with the `small.en` model for speech-to-text.

Every major competitor (Wispr Flow, SuperWhisper, HyperWhisper) uses a two-stage architecture:
1. **Stage 1 — STT**: Raw speech → raw transcript (Whisper, Parakeet, etc.)
2. **Stage 2 — LLM Cleanup**: Raw transcript → polished, formatted text (Llama, Gemma, GPT, etc.)

We need to add Stage 2 to OmWhisper using a **local LLM** via llama.cpp so the entire pipeline stays offline and private.

## Objective

Implement a local LLM-powered transcript cleanup pipeline that takes raw whisper.cpp output and produces clean, well-formatted, natural-sounding text — as if the user had typed it themselves.

## Architecture Requirements

### Rust Backend (Tauri Commands)

1. **Integrate llama.cpp** into the Rust backend
   - Use the `llama-cpp-rs` or `llama-cpp-2` crate (evaluate which has better Tauri 2 compatibility and Apple Silicon / Metal GPU support)
   - Support GGUF model loading from a configurable model directory (`~/Library/Application Support/OmWhisper/models/llm/`)
   - Keep the LLM model loaded in memory between dictation sessions for instant inference (do NOT reload per-dictation)
   - Expose a Tauri command: `cleanup_transcript(raw_text: String, context: CleanupContext) -> String`

2. **CleanupContext struct** — pass contextual hints to the LLM:
   ```rust
   struct CleanupContext {
       active_app: Option<String>,       // e.g. "Slack", "Mail", "VS Code"
       selected_text: Option<String>,     // text user had selected before dictating
       clipboard_text: Option<String>,    // recent clipboard content (if within 3s)
       dictation_mode: DictationMode,     // enum: Transcribe, Email, Message, Code, Notes
       custom_vocabulary: Vec<String>,    // user-defined terms, names, jargon
       language: String,                  // default "en"
   }
   ```

3. **Pipeline flow** (all in Rust, called sequentially):
   ```
   audio_buffer
     → whisper.cpp (small.en) → raw_transcript
     → build_llm_prompt(raw_transcript, context)
     → llama.cpp inference → cleaned_text
     → return to frontend
   ```

4. **Latency budget**: The TOTAL pipeline (STT + LLM) must target **under 800ms** for a typical 10-second dictation clip. The LLM step alone should target **under 300ms**. This means:
   - Use a small model: Gemma 3 1B Q4_K_M or Qwen3-0.6B Q4_K_M
   - Limit max output tokens to ~256
   - Use Metal GPU acceleration on Apple Silicon
   - Stream tokens if possible, but for dictation the full output is needed before pasting, so streaming to UI is optional

5. **LLM System Prompt** (hardcoded default, user-overridable):
   ```
   You are a dictation cleanup assistant. Your job is to take raw speech-to-text output and produce clean, natural text as if the user typed it themselves.

   Rules:
   - Fix obvious speech recognition errors based on context
   - Add proper punctuation and capitalization
   - Remove filler words (um, uh, like, you know) unless they appear intentional
   - Do NOT add, remove, or rephrase content — preserve the user's intent exactly
   - Do NOT add greetings, sign-offs, or any text the user did not say
   - If the dictation mode is "Code", preserve technical terms, variable names, and code-like syntax exactly
   - If the dictation mode is "Message", keep the tone casual and brief
   - If the dictation mode is "Email", use professional formatting
   - Apply any custom vocabulary terms provided — prefer these spellings over guesses
   - Output ONLY the cleaned text. No explanations, no preamble, no markdown formatting.
   ```

6. **Model management**:
   - On first launch, prompt user to download a recommended model (default: Gemma 3 1B Q4_K_M GGUF, ~1GB)
   - Show download progress in the UI
   - Allow users to swap models via settings (point to a GGUF file)
   - Validate GGUF file on load, show clear error if incompatible

### Frontend (React + TypeScript)

1. **Settings panel additions**:
   - LLM Model selector (dropdown of downloaded models + "Add custom model" option)
   - Toggle: "Enable LLM cleanup" (default: ON) — so users can bypass if they want raw output
   - Dictation Mode selector: Transcribe | Email | Message | Code | Notes
   - Custom Vocabulary editor: simple list where users can add/remove terms (persisted to local storage / config file)

2. **Dictation flow UI updates**:
   - After STT completes, show a brief "Cleaning up..." indicator (only if LLM step takes >200ms)
   - Display the final cleaned text in the existing transcript area
   - Optional: show raw vs cleaned toggle in history so users can compare

3. **Auto-detect dictation mode** (nice-to-have, Phase 4.1):
   - Use the active app name to auto-set mode:
     - Mail.app / Outlook / Gmail → Email
     - Slack / iMessage / WhatsApp → Message  
     - VS Code / Xcode / Terminal → Code
     - Everything else → Notes
   - User can override per-session

### Custom Vocabulary

- Stored as a simple JSON array in `~/Library/Application Support/OmWhisper/vocabulary.json`
- Passed to BOTH stages:
  - Stage 1: Injected as whisper.cpp `initial_prompt` to bias recognition
  - Stage 2: Included in the LLM prompt as a vocabulary reference list
- Default vocabulary should include common tech terms the user is likely to use

## Technical Constraints

- macOS only (for now)
- Apple Silicon required for Metal GPU acceleration of llama.cpp
- Intel Mac fallback: CPU-only inference, warn user about slower performance
- No network calls — entire pipeline must work offline
- Memory budget: LLM model + Whisper model together should stay under 2GB RAM
- GGUF format only for LLM models

## Files to Create / Modify

- `src-tauri/src/llm.rs` — LLM loading, inference, prompt building
- `src-tauri/src/pipeline.rs` — orchestrates STT → LLM cleanup flow
- `src-tauri/src/context.rs` — CleanupContext, active app detection, clipboard
- `src-tauri/src/models.rs` — model download, validation, management
- `src/components/Settings/LLMSettings.tsx` — LLM model & mode settings UI
- `src/components/Settings/VocabularyEditor.tsx` — custom vocabulary UI
- `src/components/Dictation/CleanupIndicator.tsx` — cleanup status indicator
- Update `src-tauri/Cargo.toml` with llama.cpp crate dependency
- Update existing dictation flow to route through the new pipeline

## Success Criteria

1. User speaks naturally for 10 seconds → gets clean, punctuated, formatted text in under 800ms total
2. Filler words are removed, punctuation is correct, capitalization is proper
3. Custom vocabulary terms (e.g., "OmWhisper", "Tauri", "SwiftUI") are spelled correctly
4. The entire pipeline works with zero network connectivity
5. LLM cleanup can be toggled off for users who prefer raw Whisper output
6. Model download and setup is smooth for first-time users

## Recommended Starting Model

**Gemma 3 1B Q4_K_M** — ~1GB download, fast inference on Apple Silicon via Metal, good instruction-following for a cleanup task. Alternative: **Qwen3-0.6B Q4_K_M** if we need even faster inference at the cost of slight quality.

## Out of Scope (for now)

- Streaming partial LLM output to the UI
- Voice commands ("new line", "bold that")
- Multi-language LLM cleanup (English only for Phase 4)
- Cloud LLM fallback option
- Real-time / streaming STT (still batch-mode per dictation clip)
