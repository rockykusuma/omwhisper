// Push-to-talk via the Fn/Globe key using a raw CGEventTap (macOS only).
//
// Uses CGEventTap instead of tauri_plugin_global_shortcut because the plugin
// does not support bare modifier keys — CGEventTap gives reliable press/release.
//
// Strategy:
//   - kCGSessionEventTap + kCGEventTapOptionListenOnly: requires Accessibility only (no Input
//     Monitoring). Passive observer — cannot suppress events, which is fine for PTT.
//   - Listens for both kCGEventFlagsChanged (Fn/Ctrl modifier) AND kCGEventKeyDown/Up (Globe
//     standalone press on Apple Silicon), since the Globe key generates different event types
//     depending on macOS version and how it's configured.
//
// Chord detection (Fn+Left Ctrl → Smart Dictation):
//   Both Fn and Left Ctrl are modifier keys, so both fire kCGEventFlagsChanged.
//   The state machine handles both press orderings:
//     - Fn first, then Ctrl within 50ms → SMART_DICTATION
//     - Ctrl first, then Fn              → SMART_DICTATION immediately
//     - Fn alone (50ms pass without Ctrl) → NORMAL_PTT
//   Releasing either modifier while in SMART_DICTATION fires on_smart_release.
#![allow(non_upper_case_globals, non_snake_case)]

use std::os::raw::{c_int, c_void};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

/// Wrapper around CFRunLoopRef that is Send+Sync.
/// Safety: CFRunLoopStop is documented as thread-safe by Apple.
struct SendableRunLoop(*mut c_void);
unsafe impl Send for SendableRunLoop {}
unsafe impl Sync for SendableRunLoop {}

/// Handle to a running CGEventTap. Call `stop()` to terminate the run loop.
pub struct PttTapHandle {
    run_loop: Arc<Mutex<Option<SendableRunLoop>>>,
}

unsafe impl Send for PttTapHandle {}
unsafe impl Sync for PttTapHandle {}

impl PttTapHandle {
    pub fn stop(&self) {
        if let Some(rl) = self.run_loop.lock().unwrap_or_else(|e| e.into_inner()).take() {
            unsafe { CFRunLoopStop(rl.0); }
            tracing::info!("PTT tap: stopped run loop");
        }
    }
}

// CGEventTapLocation
const kCGSessionEventTap: c_int = 1;
// CGEventTapPlacement
const kCGHeadInsertEventTap: c_int = 0;
// CGEventTapOptions
const kCGEventTapOptionListenOnly: c_int = 1;
// CGEventType values
const kCGEventKeyDown: u32 = 10;
const kCGEventKeyUp: u32 = 11;
const kCGEventFlagsChanged: u32 = 12;
// System disables the tap
const kCGEventTapDisabledByTimeout: u32 = 0xFFFFFFFE;
const kCGEventTapDisabledByUserInput: u32 = 0xFFFFFFFF;
// CGEventFlags
const kCGEventFlagMaskSecondaryFn: u64 = 0x00800000; // Fn/Globe modifier
const kCGEventFlagMaskControl: u64 = 0x00040000;     // Left Ctrl modifier
// CGEventField: kCGKeyboardEventKeycode
const kCGKeyboardEventKeycode: u32 = 8;
// Globe/Fn key keycodes (vary by hardware/macOS version)
const KEYCODE_FN_INTEL: i64 = 63;  // kVK_Function on Intel Macs
const KEYCODE_GLOBE: i64 = 179;    // Globe key on Apple Silicon

// Chord detection mode state machine
const MODE_IDLE: u8 = 0;
const MODE_DEBOUNCING: u8 = 1;      // Fn pressed, waiting MIN_HOLD_MS for Left Ctrl AND sustained hold
const MODE_NORMAL_PTT: u8 = 2;      // hold threshold elapsed without Ctrl — normal dictation
const MODE_SMART_DICTATION: u8 = 3; // Fn+Ctrl chord detected — smart dictation

/// Minimum hold time before firing normal PTT press. Shorter taps are treated as
/// accidental presses and ignored entirely (no overlay, no recording). Also doubles
/// as the Fn+Ctrl chord detection window.
const MIN_HOLD_MS: u64 = 200;

type CGEventRef = *const c_void;
type CFMachPortRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopRef = *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: c_int,
        place: c_int,
        options: c_int,
        events_of_interest: u64,
        callback: unsafe extern "C" fn(*const c_void, u32, CGEventRef, *mut c_void) -> CGEventRef,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CFMachPortRef,
        order: c_int,
    ) -> CFRunLoopSourceRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: *const c_void);
    fn CFRunLoopRun();
    fn CFRunLoopStop(rl: CFRunLoopRef);
    static kCFRunLoopCommonModes: *const c_void;
}

// ─── Fn/Globe key with Fn+Left Ctrl chord detection ─────────────────────────

struct FnCtrlTapState {
    fn_down: AtomicBool,
    ctrl_down: AtomicBool,
    ever_fired: Arc<AtomicBool>,
    /// Current mode: IDLE, DEBOUNCING, NORMAL_PTT, or SMART_DICTATION.
    /// Shared with debounce threads via Arc.
    mode: Arc<AtomicU8>,
    /// Fires immediately on Fn keydown, before the 50ms debounce window.
    /// Used to pre-warm the audio stream so the mic indicator appears only while the key is held.
    on_fn_down: Arc<dyn Fn() + Send + Sync>,
    on_normal_press: Arc<dyn Fn() + Send + Sync>,
    on_normal_release: Arc<dyn Fn() + Send + Sync>,
    on_smart_press: Arc<dyn Fn() + Send + Sync>,
    on_smart_release: Arc<dyn Fn() + Send + Sync>,
}

unsafe extern "C" fn fn_ctrl_tap_callback(
    proxy: *const c_void,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    match event_type {
        kCGEventTapDisabledByTimeout => {
            tracing::warn!("fn-key tap: disabled by timeout — re-enabling");
            CGEventTapEnable(proxy as CFMachPortRef, true);
            return event;
        }
        kCGEventTapDisabledByUserInput => {
            tracing::warn!("fn-key tap: disabled by system — check Accessibility permission");
            CGEventTapEnable(proxy as CFMachPortRef, true);
            return event;
        }
        _ => {}
    }

    if user_info.is_null() {
        return event;
    }

    let state = &*(user_info as *const FnCtrlTapState);
    state.ever_fired.store(true, Ordering::Relaxed);

    match event_type {
        // Both Fn and Left Ctrl are modifier keys — both fire kCGEventFlagsChanged.
        kCGEventFlagsChanged => {
            let flags = CGEventGetFlags(event);
            let fn_now   = (flags & kCGEventFlagMaskSecondaryFn) != 0;
            let ctrl_now = (flags & kCGEventFlagMaskControl) != 0;

            let was_fn_down   = state.fn_down.swap(fn_now, Ordering::SeqCst);
            let was_ctrl_down = state.ctrl_down.swap(ctrl_now, Ordering::SeqCst);

            // ── Fn state changed ─────────────────────────────────────────────
            if fn_now && !was_fn_down {
                // Fire pre-warm callback immediately (before debounce) so the audio
                // stream opens the moment the user presses Fn. This keeps the macOS
                // orange mic indicator tightly coupled to physical key hold time.
                (state.on_fn_down)();

                if ctrl_now {
                    // Ctrl was already held — immediate smart dictation chord
                    if state.mode.compare_exchange(
                        MODE_IDLE, MODE_SMART_DICTATION,
                        Ordering::SeqCst, Ordering::SeqCst,
                    ).is_ok() {
                        tracing::info!("fn-key tap: Fn+Ctrl chord (Ctrl first) — smart dictation press");
                        (state.on_smart_press)();
                    }
                } else {
                    // Start hold-threshold window. Doubles as Fn+Ctrl chord detection.
                    tracing::info!("fn-key tap: Fn pressed — waiting {MIN_HOLD_MS}ms for sustained hold");
                    state.mode.store(MODE_DEBOUNCING, Ordering::SeqCst);
                    let mode = state.mode.clone();
                    let on_normal_press = state.on_normal_press.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(MIN_HOLD_MS));
                        if mode.compare_exchange(
                            MODE_DEBOUNCING, MODE_NORMAL_PTT,
                            Ordering::SeqCst, Ordering::SeqCst,
                        ).is_ok() {
                            tracing::info!("fn-key tap: hold threshold elapsed, no Ctrl — normal PTT press");
                            on_normal_press();
                        }
                    });
                }
            } else if !fn_now && was_fn_down {
                // Fn released — dispatch based on current mode
                let prev_mode = state.mode.swap(MODE_IDLE, Ordering::SeqCst);
                match prev_mode {
                    MODE_NORMAL_PTT => {
                        tracing::info!("fn-key tap: Fn released (normal PTT)");
                        (state.on_normal_release)();
                    }
                    MODE_SMART_DICTATION => {
                        tracing::info!("fn-key tap: Fn released (smart dictation)");
                        (state.on_smart_release)();
                    }
                    MODE_DEBOUNCING => {
                        // Released before hold threshold — user never intended to record. Swallow.
                        // Debounce thread will see IDLE and skip on_normal_press.
                        tracing::info!("fn-key tap: quick Fn tap — ignored (hold {MIN_HOLD_MS}ms to record)");
                    }
                    _ => {}
                }
            }

            // ── Ctrl state changed ───────────────────────────────────────────
            if ctrl_now && !was_ctrl_down && fn_now {
                // Ctrl pressed while Fn already held — transition DEBOUNCING → SMART_DICTATION
                if state.mode.compare_exchange(
                    MODE_DEBOUNCING, MODE_SMART_DICTATION,
                    Ordering::SeqCst, Ordering::SeqCst,
                ).is_ok() {
                    tracing::info!("fn-key tap: Fn+Ctrl chord (Fn first) — smart dictation press");
                    (state.on_smart_press)();
                }
            } else if !ctrl_now && was_ctrl_down {
                // Ctrl released — end smart dictation (Fn may still be held)
                if state.mode.compare_exchange(
                    MODE_SMART_DICTATION, MODE_IDLE,
                    Ordering::SeqCst, Ordering::SeqCst,
                ).is_ok() {
                    tracing::info!("fn-key tap: Ctrl released — smart dictation release");
                    (state.on_smart_release)();
                }
            }
        }

        // ── Globe key standalone (Apple Silicon KeyDown/Up) ──────────────────
        kCGEventKeyDown | kCGEventKeyUp => {
            let keycode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);

            if keycode == KEYCODE_FN_INTEL || keycode == KEYCODE_GLOBE {
                let is_down = event_type == kCGEventKeyDown;
                let was_down = state.fn_down.swap(is_down, Ordering::SeqCst);

                if is_down && !was_down {
                    // Pre-warm on Globe keydown too (same as Fn).
                    (state.on_fn_down)();

                    let ctrl_held = state.ctrl_down.load(Ordering::SeqCst);
                    if ctrl_held {
                        if state.mode.compare_exchange(
                            MODE_IDLE, MODE_SMART_DICTATION,
                            Ordering::SeqCst, Ordering::SeqCst,
                        ).is_ok() {
                            tracing::info!("fn-key tap: Globe+Ctrl chord — smart dictation press");
                            (state.on_smart_press)();
                        }
                    } else {
                        tracing::info!("fn-key tap: Globe pressed (keydown, keycode={}) — waiting {}ms", keycode, MIN_HOLD_MS);
                        state.mode.store(MODE_DEBOUNCING, Ordering::SeqCst);
                        let mode = state.mode.clone();
                        let on_normal_press = state.on_normal_press.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(MIN_HOLD_MS));
                            if mode.compare_exchange(
                                MODE_DEBOUNCING, MODE_NORMAL_PTT,
                                Ordering::SeqCst, Ordering::SeqCst,
                            ).is_ok() {
                                on_normal_press();
                            }
                        });
                    }
                } else if !is_down && was_down {
                    let prev_mode = state.mode.swap(MODE_IDLE, Ordering::SeqCst);
                    match prev_mode {
                        MODE_NORMAL_PTT => {
                            tracing::info!("fn-key tap: Globe released (normal PTT)");
                            (state.on_normal_release)();
                        }
                        MODE_SMART_DICTATION => {
                            tracing::info!("fn-key tap: Globe released (smart dictation)");
                            (state.on_smart_release)();
                        }
                        MODE_DEBOUNCING => {
                            tracing::info!("fn-key tap: Globe quick tap — ignored (hold to record)");
                        }
                        _ => {}
                    }
                }
            }
        }

        _ => {}
    }

    event
}

/// Spawns a CGEventTap for the Fn/Globe key with Fn+Left Ctrl chord detection.
///
/// - `on_fn_down` — fires immediately on every Fn/Globe keydown, before the debounce window.
///   Use this to pre-warm the audio stream so the mic indicator is tightly coupled to key hold time.
/// - `on_normal_press` / `on_normal_release` — fired for plain Fn key PTT (normal dictation).
/// - `on_smart_press` / `on_smart_release` — fired for Fn+Left Ctrl chord (smart dictation PTT).
///
/// A 50ms debounce window after Fn press handles the case where Fn is pressed first.
/// If Ctrl is already held when Fn goes down, smart dictation activates immediately.
pub fn spawn_fn_key_tap(
    on_fn_down: impl Fn() + Send + Sync + 'static,
    on_normal_press: impl Fn() + Send + Sync + 'static,
    on_normal_release: impl Fn() + Send + Sync + 'static,
    on_smart_press: impl Fn() + Send + Sync + 'static,
    on_smart_release: impl Fn() + Send + Sync + 'static,
) -> PttTapHandle {
    let ever_fired = Arc::new(AtomicBool::new(false));

    let ever_fired_watch = ever_fired.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(8));
        if !ever_fired_watch.load(Ordering::Relaxed) {
            tracing::warn!(
                "fn-key tap: no events received after 8s — grant Accessibility permission \
                 in System Settings → Privacy & Security → Accessibility"
            );
        }
    });

    // FlagsChanged covers both Fn and Ctrl. KeyDown/Up covers Globe standalone.
    let event_mask = (1u64 << kCGEventFlagsChanged)
        | (1u64 << kCGEventKeyDown)
        | (1u64 << kCGEventKeyUp);

    spawn_tap(
        event_mask,
        fn_ctrl_tap_callback,
        move || Box::into_raw(Box::new(FnCtrlTapState {
            fn_down: AtomicBool::new(false),
            ctrl_down: AtomicBool::new(false),
            ever_fired,
            mode: Arc::new(AtomicU8::new(MODE_IDLE)),
            on_fn_down: Arc::new(on_fn_down),
            on_normal_press: Arc::new(on_normal_press),
            on_normal_release: Arc::new(on_normal_release),
            on_smart_press: Arc::new(on_smart_press),
            on_smart_release: Arc::new(on_smart_release),
        })) as *mut c_void,
        "fn",
    )
}

// ─── Shared tap runner ──────────────────────────────────────────────────────

type TapCallbackFn = unsafe extern "C" fn(*const c_void, u32, CGEventRef, *mut c_void) -> CGEventRef;

fn spawn_tap<F>(
    event_mask: u64,
    callback: TapCallbackFn,
    make_state: F,
    label: &'static str,
) -> PttTapHandle
where
    F: FnOnce() -> *mut c_void + Send + 'static,
{
    let run_loop_slot: Arc<Mutex<Option<SendableRunLoop>>> = Arc::new(Mutex::new(None));
    let run_loop_writer = run_loop_slot.clone();

    std::thread::spawn(move || unsafe {
        let state_ptr = make_state();

        let tap = CGEventTapCreate(
            kCGSessionEventTap,
            kCGHeadInsertEventTap,
            kCGEventTapOptionListenOnly,
            event_mask,
            callback,
            state_ptr,
        );

        if tap.is_null() {
            tracing::warn!(
                "{}-key tap: CGEventTapCreate failed — grant Accessibility permission \
                 in System Settings → Privacy & Security → Accessibility",
                label
            );
            return;
        }

        let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
        if source.is_null() {
            tracing::warn!("{}-key tap: CFMachPortCreateRunLoopSource failed", label);
            return;
        }

        let rl = CFRunLoopGetCurrent();
        CFRunLoopAddSource(rl, source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);

        *run_loop_writer.lock().unwrap_or_else(|e| e.into_inner()) = Some(SendableRunLoop(rl));

        tracing::info!("{}-key tap: CGEventTap running (session, listen-only)", label);
        CFRunLoopRun();
        tracing::info!("{}-key tap: run loop stopped", label);
    });

    PttTapHandle { run_loop: run_loop_slot }
}
