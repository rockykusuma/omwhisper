# Apple SpeechAnalyzer Integration Design

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Integrate macOS 26's native speech transcription framework as the primary engine on macOS 26+, with automatic fallback to Whisper on older macOS and Windows.

**Architecture:** Abstract transcription behind a `TranscriptionEngine` enum. At runtime, detect macOS version and select the appropriate engine. Swift shim bridges Apple's speech API to Rust via C FFI.

**Tech Stack:** Swift 6, Apple Speech framework (macOS 26+), Rust FFI (`extern "C"`), `swiftc` static library compiled via `build.rs`, existing `WhisperEngine` as fallback.

---

## Context

Apple introduced a new speech transcription framework at WWDC 2025. Key properties:
- 100% on-device, no cloud
- 55% faster than Whisper Large V3 Turbo
- Long-form audio support (meetings, lectures)
- Accuracy equivalent to Whisper mid-tier models
- macOS 26+ only

OmWhisper currently uses `whisper-rs` (whisper.cpp) for all transcription. This integration adds the Apple engine as a transparent upgrade on supported hardware, with no user configuration required.

> **⚠️ API stability note:** The Apple speech framework introduced in macOS 26 is brand new (WWDC 2025 beta). Before implementing the Swift shim, the implementer MUST verify the exact framework name, class names, and availability guard by inspecting the installed Xcode 26 beta SDK headers:
> ```bash
> xcrun --sdk macosx --show-sdk-path
> ls $(xcrun --sdk macosx --show-sdk-path)/System/Library/Frameworks/ | grep -i speech
> ```
> The design below uses placeholder names (`AppleSpeechFramework`, `SpeechSession`). Replace with actual SDK symbols found above.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/src/macos/speech_analyzer.swift` | Create | Swift shim — wraps Apple speech API, exposes C FFI |
| `src-tauri/src/macos/speech_analyzer.rs` | Create | Rust FFI declarations + safe `SpeechAnalyzerEngine` wrapper |
| `src-tauri/src/engine.rs` | Create | `TranscriptionEngine` enum unifying both engines |
| `src-tauri/src/commands.rs` | Modify | Use `TranscriptionEngine` instead of `WhisperEngine` directly; store engine name in `TranscriptionState` |
| `src-tauri/src/lib.rs` | Modify | Register `get_transcription_engine` in `invoke_handler!` and use-imports |
| `src-tauri/build.rs` | Modify | Compile Swift shim into static library + link frameworks on macOS |
| `src-tauri/src/lib.rs` | Modify | Add `mod macos;` + `mod engine;` declarations; register `get_transcription_engine` in `invoke_handler!` |
| `src/components/HomeView.tsx` | Modify | Show engine badge (⚡ Apple Speech / ◎ Whisper) near record button |

---

## Design

### 1. Swift Shim (`speech_analyzer.swift`)

**Critical: async-to-sync bridge using `DispatchSemaphore`**

The Apple speech API is Swift async/await only. The C FFI boundary is synchronous. Bridge these using a semaphore:

```swift
// ⚠️ Replace framework/class names with actual Xcode 26 beta SDK symbols
import Foundation
// import <ActualFrameworkName>  ← verify via SDK headers

/// Check availability at runtime — called once on startup.
@_cdecl("apple_speech_available")
public func appleSpeechAvailable() -> Bool {
    if #available(macOS 26.0, *) {
        return true  // replace with actual availability check if API provides one
    }
    return false
}

/// Transcribe a PCM buffer. Blocks the calling thread until complete.
/// Calls `callback` once per result segment with (text, start_ms, end_ms, is_final).
/// Returns 0 on success, -1 on error (error description written to error_out if non-nil).
@_cdecl("apple_transcribe_buffer")
public func appleTranscribeBuffer(
    samples: UnsafePointer<Float>,
    count: Int32,
    sampleRate: Int32,
    context: UnsafeMutableRawPointer?,
    callback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, Int64, Int64, Bool) -> Void
) -> Int32 {
    guard #available(macOS 26.0, *) else { return -1 }

    // Copy samples — unsafe pointer is only valid during this call
    let frameCount = AVAudioFrameCount(count)
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                sampleRate: Double(sampleRate),
                                channels: 1,
                                interleaved: false)!
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return -1 }
    buffer.frameLength = frameCount
    buffer.floatChannelData![0].initialize(from: samples, count: Int(count))

    let sema = DispatchSemaphore(value: 0)
    var success = true

    Task {
        do {
            // ⚠️ Replace with actual SpeechSession/SpeechAnalyzer API
            // let session = try SpeechSession(...)
            // for await result in session.transcribe(buffer) {
            //     let text = result.text
            //     let startMs = Int64(result.timeRange.start.seconds * 1000)
            //     let endMs = Int64(result.timeRange.end.seconds * 1000)
            //     text.withCString { ptr in
            //         callback(context, ptr, startMs, endMs, result.isFinal)
            //     }
            // }
        } catch {
            success = false
        }
        sema.signal()
    }

    sema.wait()
    return success ? 0 : -1
}
```

**Key points:**
- `context` passes a heap-allocated Rust pointer through the callback (avoids thread-local issues — see Issue 4 below)
- All errors caught inside Swift `do/catch` and returned as a return code — `catch_unwind` in Rust cannot catch Swift exceptions across FFI
- `DispatchSemaphore` bridges async Task to the blocking C call correctly

### 2. Rust FFI + Safe Wrapper (`speech_analyzer.rs`)

```rust
#[cfg(target_os = "macos")]
mod ffi {
    use std::os::raw::c_char;
    extern "C" {
        pub fn apple_speech_available() -> bool;
        pub fn apple_transcribe_buffer(
            samples: *const f32,
            count: i32,
            sample_rate: i32,
            context: *mut std::os::raw::c_void,
            callback: extern "C" fn(*mut std::os::raw::c_void, *const c_char, i64, i64, bool),
        ) -> i32;
    }
}

/// SpeechAnalyzerEngine is a zero-sized type — it holds no state.
/// It is safe to send across threads (used inside std::thread::spawn).
#[cfg(target_os = "macos")]
pub struct SpeechAnalyzerEngine;

#[cfg(target_os = "macos")]
unsafe impl Send for SpeechAnalyzerEngine {}

#[cfg(target_os = "macos")]
impl SpeechAnalyzerEngine {
    pub fn is_available() -> bool {
        unsafe { ffi::apple_speech_available() }
    }

    pub fn transcribe(&self, audio: &[f32]) -> anyhow::Result<Vec<crate::whisper::engine::Segment>> {
        use std::os::raw::c_void;
        use std::ffi::CStr;

        // Heap-allocate the output buffer; pass its raw pointer as context
        // so the Swift callback (which runs on a different thread) can write to it.
        let mut segments: Vec<crate::whisper::engine::Segment> = Vec::new();
        let segments_ptr: *mut Vec<_> = &mut segments;

        extern "C" fn segment_callback(
            context: *mut c_void,
            text: *const std::os::raw::c_char,
            start_ms: i64,
            end_ms: i64,
            is_final: bool,
        ) {
            if text.is_null() || context.is_null() { return; }
            let text = unsafe { CStr::from_ptr(text) }
                .to_string_lossy()
                .into_owned();
            let out = unsafe { &mut *(context as *mut Vec<crate::whisper::engine::Segment>) };
            out.push(crate::whisper::engine::Segment { text, start_ms, end_ms, is_final });
        }

        let result = unsafe {
            ffi::apple_transcribe_buffer(
                audio.as_ptr(),
                audio.len() as i32,
                16000,
                segments_ptr as *mut c_void,
                segment_callback,
            )
        };

        if result == 0 {
            Ok(segments)
        } else {
            anyhow::bail!("Apple speech transcription failed")
        }
    }
}
```

### 3. Engine Abstraction (`engine.rs`)

Unified `transcribe` signature matches `WhisperEngine::transcribe` exactly. Apple variant silently ignores `language`, `initial_prompt`, and `word_replacements` (Apple handles language detection internally — this is by design).

```rust
use std::collections::HashMap;
use std::path::Path;
use crate::whisper::engine::{WhisperEngine, Segment};

pub enum TranscriptionEngine {
    #[cfg(target_os = "macos")]
    Apple(crate::macos::speech_analyzer::SpeechAnalyzerEngine),
    Whisper(WhisperEngine),
}

impl TranscriptionEngine {
    pub fn select(model_path: &Path) -> Self {
        #[cfg(target_os = "macos")]
        if crate::macos::speech_analyzer::SpeechAnalyzerEngine::is_available() {
            tracing::info!("Using Apple speech engine");
            return TranscriptionEngine::Apple(
                crate::macos::speech_analyzer::SpeechAnalyzerEngine
            );
        }
        tracing::info!("Using Whisper engine");
        TranscriptionEngine::Whisper(
            WhisperEngine::new(model_path).expect("failed to load whisper model")
        )
    }

    /// Unified transcribe — matches WhisperEngine::transcribe signature exactly.
    /// `language`, `initial_prompt`, `word_replacements` ignored by Apple variant.
    pub fn transcribe(
        &self,
        audio: &[f32],
        language: &str,
        translate_to_english: bool,
        initial_prompt: Option<&str>,
        word_replacements: &HashMap<String, String>,
    ) -> anyhow::Result<Vec<Segment>> {
        match self {
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Apple(engine) => engine.transcribe(audio),
            TranscriptionEngine::Whisper(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Apple(_) => "apple",
            TranscriptionEngine::Whisper(_) => "whisper",
        }
    }
}
```

### 4. `TranscriptionState` Update (`commands.rs`)

Add `active_engine: &'static str` to `TranscriptionState` so `get_transcription_engine` can answer without calling into Swift:

```rust
pub struct TranscriptionState {
    pub capture: Option<AudioCapture>,
    pub usage_running: Arc<AtomicBool>,
    pub is_smart_dictation: bool,
    pub start_cancelled: bool,
    pub recording_start_time: Option<std::time::Instant>,
    pub active_engine: &'static str,  // "apple" or "whisper" — set in start_transcription
}

impl TranscriptionState {
    pub fn new() -> Self {
        TranscriptionState {
            // ... existing fields ...
            active_engine: "whisper",  // default until first recording
        }
    }
}
```

In `start_transcription`, after constructing `TranscriptionEngine::select(model_path)`:
```rust
state.lock().expect("state mutex poisoned").active_engine = engine.name();
```

New command:
```rust
#[tauri::command]
pub fn get_transcription_engine(state: tauri::State<'_, SharedState>) -> &'static str {
    state.lock().expect("state mutex poisoned").active_engine
}
```

Register in `lib.rs` both in the `use` block and in `invoke_handler!`.

**Also add to `lib.rs` at the top-level (before `use` imports):**
```rust
#[cfg(target_os = "macos")]
mod macos;
mod engine;
```

**Note on borrow order in `start_transcription`:** Call `engine.name()` and store the result in a local variable _before_ moving `engine` into the spawned thread closure:
```rust
let engine_name = engine.name();
state.lock().expect("state mutex poisoned").active_engine = engine_name;
// now move engine into std::thread::spawn closure
```

### 5. Build System (`build.rs`)

```rust
#[cfg(target_os = "macos")]
fn compile_swift_shim() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let swift_src = format!("{}/src/macos/speech_analyzer.swift", manifest_dir);
    let lib_out = format!("{}/libspeech_analyzer.a", out_dir);

    // Use host architecture (supports both Apple Silicon and Intel)
    // CARGO_CFG_TARGET_ARCH returns "aarch64" or "x86_64"
    // Swift target triple uses "macosx" (not "macos") — e.g. aarch64-apple-macosx13.0
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or("aarch64".to_string());
    let target = format!("{}-apple-macosx13.0", arch);

    let status = std::process::Command::new("swiftc")
        .args([
            "-emit-library", "-static",
            "-o", &lib_out,
            &swift_src,
            "-module-name", "SpeechAnalyzerShim",
            "-target", &target,
        ])
        .status()
        .expect("failed to run swiftc — is Xcode installed?");

    assert!(status.success(), "Swift shim compilation failed");

    println!("cargo:rustc-link-search=native={}", out_dir);
    println!("cargo:rustc-link-lib=static=speech_analyzer");

    // Link required Apple frameworks (⚠️ update framework name once SDK verified)
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=Foundation");
    // println!("cargo:rustc-link-lib=framework=<ActualSpeechFramework>");

    // Swift runtime — required for any Swift static library
    // xcrun --find swift returns e.g.:
    //   /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift
    // Walk up 4 parents to reach toolchain root, then descend to usr/lib/swift/macosx
    if let Ok(swift_bin_path) = std::process::Command::new("xcrun")
        .args(["--find", "swift"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    {
        let toolchain_lib = std::path::Path::new(&swift_bin_path)
            .parent()  // bin/
            .and_then(|p| p.parent())  // usr/
            .and_then(|p| p.parent())  // XcodeDefault.xctoolchain/
            .and_then(|p| p.parent())  // Toolchains/
            .map(|p| p.join("XcodeDefault.xctoolchain/usr/lib/swift/macosx"))
            .unwrap_or_default();
        println!("cargo:rustc-link-search=native={}", toolchain_lib.display());
    }
    println!("cargo:rustc-link-lib=dylib=swiftCore");

    println!("cargo:rerun-if-changed={}", swift_src);
}
```

Call `compile_swift_shim()` from `main()` before `tauri_build::build()`, gated with `#[cfg(target_os = "macos")]`.

### 6. Frontend Badge (`HomeView.tsx`)

Fetch engine once on mount:
```tsx
const [engine, setEngine] = useState<"apple" | "whisper">("whisper");

useEffect(() => {
  invoke<string>("get_transcription_engine").then(e => setEngine(e as "apple" | "whisper"));
}, []);
```

Badge near the record button:
```tsx
<span className="text-xs text-t3 font-mono">
  {engine === "apple" ? "⚡ Apple Speech" : "◎ Whisper"}
</span>
```

---

## Fallback Chain

1. macOS 26+ detected AND `apple_speech_available()` returns true → `Apple` engine
2. `apple_speech_available()` returns false (permission denied, API error) → log warning → `Whisper` engine
3. macOS < 26 or Windows → always `Whisper` engine
4. Whisper with no model downloaded → existing `"transcription-error"` event path (unchanged)

---

## Error Handling

- All Swift errors caught inside Swift `do/catch` — returned as `-1` from `apple_transcribe_buffer`
- **Do NOT use `catch_unwind` for Swift FFI** — it cannot catch Swift/ObjC exceptions. Swift must handle its own errors internally.
- On `-1` return: Rust logs warning and falls back gracefully to Whisper for that chunk
- Permission denied: `apple_speech_available()` returns false → Whisper used for entire session

---

## Testing

| Test | Location | What it verifies |
|------|----------|-----------------|
| `TranscriptionEngine::select` with mocked availability | `engine.rs` tests | Correct engine chosen based on availability |
| `SpeechAnalyzerEngine::is_available` on macOS < 26 | `speech_analyzer.rs` tests | Returns false gracefully (Swift `#available` guard) |
| Swift shim compilation | CI build | `swiftc` succeeds against Xcode 26 SDK |
| Manual integration test | macOS 26 device | End-to-end transcription via Apple engine |
| Windows build unaffected | CI | No compilation errors on Windows path |

> **Note:** macOS version detection is handled entirely by Swift's `#available(macOS 26.0, *)` — no Rust-side version parsing is needed.

---

## Constraints

- All new code is `#[cfg(target_os = "macos")]` gated — Windows build unaffected
- Model Manager unchanged — users keep control over Whisper models
- No new Settings toggle — engine selection is fully automatic
- Swift shim requires Xcode command-line tools (already required for macOS builds)
- `SpeechAnalyzer` API names must be verified against installed Xcode 26 beta SDK before writing the Swift shim
- macOS minimum for Apple engine: 26.0 (guarded by `#available(macOS 26.0, *)` in Swift)
