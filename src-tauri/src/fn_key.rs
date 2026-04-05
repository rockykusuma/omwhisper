// Push-to-talk via the Fn key using a raw CGEventTap (macOS only).
//
// Uses CGEventTap instead of tauri_plugin_global_shortcut because the plugin
// does not support bare modifier keys — CGEventTap gives reliable press/release.
//
// Tap level: kCGHIDEventTap (hardware level, before system processes Globe/Fn).
// kCGSessionEventTap misses Fn because macOS intercepts it for Dictation/Globe
// at the session level before our callback would ever see it.
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
const kCGHIDEventTap: c_int = 0;        // hardware level — before system processes Fn/Globe
// CGEventTapPlacement
const kCGHeadInsertEventTap: c_int = 0;
// CGEventTapOptions
const kCGEventTapOptionDefault: c_int = 0;
// CGEventType values
const kCGEventFlagsChanged: u32 = 12;
// System disables the tap — sent instead of a real event type
const kCGEventTapDisabledByTimeout: u32 = 0xFFFFFFFE;
const kCGEventTapDisabledByUserInput: u32 = 0xFFFFFFFF;
// CGEventFlags — Fn key
const kCGEventFlagMaskSecondaryFn: u64 = 0x00800000;

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

// ─── Fn key ────────────────────────────────────────────────────────────────

struct FnTapState {
    fn_down: AtomicBool,
    ever_fired: Arc<AtomicBool>,  // shared with watchdog to detect Input Monitoring permission
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
            // macOS kills the tap when Input Monitoring permission is missing.
            // Re-enable keeps it alive but events won't arrive until permission is granted.
            tracing::warn!("fn-key tap: disabled by system — grant Input Monitoring permission in System Settings > Privacy & Security");
            CGEventTapEnable(proxy as CFMachPortRef, true);
            return event;
        }
        _ => {}
    }

    if event_type == kCGEventFlagsChanged && !user_info.is_null() {
        let flags = CGEventGetFlags(event);
        let fn_now = (flags & kCGEventFlagMaskSecondaryFn) != 0;
        let state = &*(user_info as *const FnTapState);
        state.ever_fired.store(true, Ordering::Relaxed);
        let was_down = state.fn_down.swap(fn_now, Ordering::SeqCst);
        if fn_now && !was_down {
            tracing::info!("fn-key tap: Fn pressed");
            (state.on_press)();
        } else if !fn_now && was_down {
            tracing::info!("fn-key tap: Fn released");
            (state.on_release)();
        }
    }
    event
}

/// Spawns a CGEventTap for the Fn key.
pub fn spawn_fn_key_tap(
    on_press: impl Fn() + Send + Sync + 'static,
    on_release: impl Fn() + Send + Sync + 'static,
) -> PttTapHandle {
    let ever_fired = Arc::new(AtomicBool::new(false));

    // Watchdog: if no events arrive within 6 seconds, Input Monitoring is likely missing.
    let ever_fired_watch = ever_fired.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(6));
        if !ever_fired_watch.load(Ordering::Relaxed) {
            tracing::warn!(
                "fn-key tap: no events received after 6s — grant Input Monitoring permission \
                 in System Settings → Privacy & Security → Input Monitoring"
            );
        }
    });

    spawn_tap(
        1u64 << kCGEventFlagsChanged,
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

/// Spawns a background thread with a CGEventTap at hardware level (kCGHIDEventTap).
/// `make_state` is called inside the thread and returns the raw state pointer,
/// so raw pointers are never sent across thread boundaries.
/// Returns a handle that can stop the run loop from any thread.
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
        let state_ptr = make_state(); // raw pointer created inside the thread

        let tap = CGEventTapCreate(
            kCGHIDEventTap,          // hardware level — captures Fn before system Globe/Dictation handling
            kCGHeadInsertEventTap,
            kCGEventTapOptionDefault,
            event_mask,
            callback,
            state_ptr,
        );

        if tap.is_null() {
            tracing::warn!("{}-key tap: CGEventTapCreate failed — grant Accessibility permission in System Settings > Privacy & Security", label);
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

        // Store the run loop ref so PttTapHandle::stop() can terminate it.
        *run_loop_writer.lock().unwrap_or_else(|e| e.into_inner()) = Some(SendableRunLoop(rl));

        tracing::info!("{}-key tap: CGEventTap running (HID level)", label);
        CFRunLoopRun();
        tracing::info!("{}-key tap: run loop stopped", label);
    });

    PttTapHandle { run_loop: run_loop_slot }
}
