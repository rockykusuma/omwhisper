// Push-to-talk via the Fn/Globe key using a raw CGEventTap (macOS only).
//
// Uses CGEventTap instead of tauri_plugin_global_shortcut because the plugin
// does not support bare modifier keys — CGEventTap gives reliable press/release.
//
// Strategy:
//   - kCGSessionEventTap + kCGEventTapOptionListenOnly: requires Accessibility only (no Input
//     Monitoring). Passive observer — cannot suppress events, which is fine for PTT.
//   - Listens for both kCGEventFlagsChanged (Fn-as-modifier) AND kCGEventKeyDown/Up (Globe
//     standalone press on Apple Silicon), since the Globe key generates different event types
//     depending on macOS version and how it's configured.
#![allow(non_upper_case_globals, non_snake_case)]

use std::os::raw::{c_int, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
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
const kCGSessionEventTap: c_int = 1;    // session level — requires Accessibility only
// CGEventTapPlacement
const kCGHeadInsertEventTap: c_int = 0;
// CGEventTapOptions
const kCGEventTapOptionListenOnly: c_int = 1; // passive: observe only, no Input Monitoring needed
// CGEventType values
const kCGEventKeyDown: u32 = 10;
const kCGEventKeyUp: u32 = 11;
const kCGEventFlagsChanged: u32 = 12;
// System disables the tap
const kCGEventTapDisabledByTimeout: u32 = 0xFFFFFFFE;
const kCGEventTapDisabledByUserInput: u32 = 0xFFFFFFFF;
// CGEventFlags — Fn key as modifier
const kCGEventFlagMaskSecondaryFn: u64 = 0x00800000;
// CGEventField: kCGKeyboardEventKeycode
const kCGKeyboardEventKeycode: u32 = 8;
// Globe/Fn key keycodes (vary by hardware/macOS version)
const KEYCODE_FN_INTEL: i64 = 63;   // kVK_Function on Intel Macs
const KEYCODE_GLOBE: i64 = 179;     // Globe key on Apple Silicon

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

// ─── Fn/Globe key ──────────────────────────────────────────────────────────

struct FnTapState {
    fn_down: AtomicBool,
    ever_fired: Arc<AtomicBool>,
    on_press: Box<dyn Fn() + Send + Sync>,
    on_release: Box<dyn Fn() + Send + Sync>,
}

unsafe extern "C" fn fn_tap_callback(
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

    let state = &*(user_info as *const FnTapState);
    state.ever_fired.store(true, Ordering::Relaxed);

    match event_type {
        // Path 1: Fn used as modifier — detected via flags bit (Intel and Apple Silicon)
        kCGEventFlagsChanged => {
            let flags = CGEventGetFlags(event);
            let fn_now = (flags & kCGEventFlagMaskSecondaryFn) != 0;
            let was_down = state.fn_down.swap(fn_now, Ordering::SeqCst);
            if fn_now && !was_down {
                tracing::info!("fn-key tap: Fn pressed (flags)");
                (state.on_press)();
            } else if !fn_now && was_down {
                tracing::info!("fn-key tap: Fn released (flags)");
                (state.on_release)();
            }
        }
        // Path 2: Globe key standalone press — generates KeyDown/Up on Apple Silicon
        kCGEventKeyDown | kCGEventKeyUp => {
            let keycode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
            if keycode == KEYCODE_FN_INTEL || keycode == KEYCODE_GLOBE {
                let is_down = event_type == kCGEventKeyDown;
                let was_down = state.fn_down.swap(is_down, Ordering::SeqCst);
                if is_down && !was_down {
                    tracing::info!("fn-key tap: Globe/Fn pressed (keydown, keycode={})", keycode);
                    (state.on_press)();
                } else if !is_down && was_down {
                    tracing::info!("fn-key tap: Globe/Fn released (keyup, keycode={})", keycode);
                    (state.on_release)();
                }
            }
        }
        _ => {}
    }

    event
}

/// Spawns a CGEventTap for the Fn/Globe key.
pub fn spawn_fn_key_tap(
    on_press: impl Fn() + Send + Sync + 'static,
    on_release: impl Fn() + Send + Sync + 'static,
) -> PttTapHandle {
    let ever_fired = Arc::new(AtomicBool::new(false));

    // Watchdog: if no events arrive within 8s, Accessibility permission is likely missing.
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

    // Event mask: FlagsChanged (Fn modifier) + KeyDown/Up (Globe standalone)
    let event_mask = (1u64 << kCGEventFlagsChanged)
        | (1u64 << kCGEventKeyDown)
        | (1u64 << kCGEventKeyUp);

    spawn_tap(
        event_mask,
        fn_tap_callback,
        move || Box::into_raw(Box::new(FnTapState {
            fn_down: AtomicBool::new(false),
            ever_fired,
            on_press: Box::new(on_press),
            on_release: Box::new(on_release),
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
            kCGEventTapOptionListenOnly, // passive — Accessibility only, no Input Monitoring
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
