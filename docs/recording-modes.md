---
layout: default
title: Recording Modes & VAD
nav_order: 3
---

# Recording Modes & Voice Activity Detection

---

## Recording Modes

### Toggle Mode (default, all platforms)

Press the hotkey once to **start**, press again to **stop**. The overlay appears while recording and disappears when you stop.

Best for: longer dictations, structured speech, when you want full control over when transcription runs.

### Push-to-Talk Mode (macOS only)

**Hold** the hotkey or a single key to record, **release** to stop. Transcription runs immediately on release.

Best for: quick one-off phrases, chat messages, voice commands.

Configure in **Settings → General → Recording Mode**.

---

## Voice Activity Detection (VAD)

VAD filters your audio before sending it to Whisper. Without VAD, Whisper processes all audio including silence — which causes hallucinations ("Thank you for watching.", random filler words).

### VAD Engines

#### Silero (Neural) — Recommended

A small neural network (~1.8 MB ONNX model) that detects speech with high accuracy. Runs on-device at every 512-sample frame (~32ms at 16kHz).

- Eliminates hallucinations on silence almost entirely
- Works on macOS (Metal) and Windows (CPU)
- Slight CPU overhead (minimal in practice)

#### Energy (RMS)

Simple volume threshold — if the audio level exceeds a threshold, it's considered speech. Faster and lighter but less accurate; loud background noise can trigger false positives.

### VAD Sensitivity

Adjust in **Settings → Audio → VAD Sensitivity**. Higher = more sensitive (picks up quieter speech). Lower = more aggressive silence filtering.

---

## Live Text Streaming

When enabled (**Settings → Overlay → Live Text Streaming**), partial transcriptions appear below the overlay indicator as you speak — before you stop recording.

> **Note:** May slightly reduce accuracy for long uninterrupted speech, as Whisper works best on complete utterances. Disabled by default — opt in if you want live feedback.

---

## Whisper Models

Larger models are more accurate but slower. The right choice depends on your hardware and use case.

| Model | Size | Best for |
|-------|------|----------|
| `tiny.en` | 75 MB | Fast drafts, quick notes |
| `base.en` | 142 MB | Everyday use |
| `small` / `small.en` | 466 MB | High accuracy, still fast on Apple Silicon |
| `large-v3-turbo` | 1.5 GB | Best accuracy, slower |

Download additional models in **Settings → AI Models**.
