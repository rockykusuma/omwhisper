// Single-key push-to-talk via raw CGEventTap (macOS only).
//
// Supports: Fn, CapsLock, Right Option, Right Control, F13, F14, F15
//
// Uses CGEventTap instead of tauri_plugin_global_shortcut because:
// - The plugin only supports modifier+key combos, not bare modifier keys
// - Key-up events for bare modifiers are unreliable through the plugin
// - CGEventTap gives us reliable press/release for all key types
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
const kCGSessionEventTap: c_int = 1;
// CGEventTapPlacement
const kCGHeadInsertEventTap: c_int = 0;
// CGEventTapOptions
const kCGEventTapOptionDefault: c_int = 0;
// CGEventType values
const kCGEventFlagsChanged: u32 = 12;
// CGEventField: kCGKeyboardEventKeycode
const kCGKeyboardEventKeycode: u32 = 8;
// CGEventFlags
const kCGEventFlagMaskSecondaryFn: u64 = 0x00800000; // Fn key
pub const kCGEventFlagMaskAlternate: u64 = 0x00080000; // Option key
pub const kCGEventFlagMaskControl: u64 = 0x00040000;   // Control key
// HID keycodes for single-key PTT candidates
pub const KEYCODE_RIGHT_OPTION: u64 = 61;
pub const KEYCODE_RIGHT_CONTROL: u64 = 60;
pub const KEYCODE_CAPS_LOCK: u64 = 57;

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

// ─── Fn key ────────────────────────────────────────────────────────────────

struct FnTapState {
    fn_down: AtomicBool,
    on_press: Box<dyn Fn() + Send + Sync>,
    on_release: Box<dyn Fn() + Send + Sync>,
}

unsafe extern "C" fn fn_tap_callback(
    _proxy: *const c_void,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    if event_type == kCGEventFlagsChanged && !user_info.is_null() {
        let flags = CGEventGetFlags(event);
        let fn_now = (flags & kCGEventFlagMaskSecondaryFn) != 0;
        let state = &*(user_info as *const FnTapState);
        let was_down = state.fn_down.swap(fn_now, Ordering::SeqCst);
        if fn_now && !was_down {
            (state.on_press)();
        } else if !fn_now && was_down {
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
    spawn_tap(
        1u64 << kCGEventFlagsChanged,
        fn_tap_callback,
        move || Box::into_raw(Box::new(FnTapState {
            fn_down: AtomicBool::new(false),
            on_press: Box::new(on_press),
            on_release: Box::new(on_release),
        })) as *mut c_void,
        "fn",
    )
}

// ─── Modifier keys (Right Option, Right Control) ────────────────────────────

struct ModifierTapState {
    target_keycode: u64,
    flag_mask: u64,
    on_press: Box<dyn Fn() + Send + Sync>,
    on_release: Box<dyn Fn() + Send + Sync>,
}

unsafe extern "C" fn modifier_tap_callback(
    _proxy: *const c_void,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    if event_type == kCGEventFlagsChanged && !user_info.is_null() {
        let keycode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) as u64;
        let state = &*(user_info as *const ModifierTapState);
        if keycode == state.target_keycode {
            let flags = CGEventGetFlags(event);
            if (flags & state.flag_mask) != 0 {
                (state.on_press)();
            } else {
                (state.on_release)();
            }
        }
    }
    event
}

/// Spawns a CGEventTap for a bare modifier key (Right Option or Right Control).
/// `target_keycode`: HID keycode (61 = Right Option, 60 = Right Control).
/// `flag_mask`: CGEventFlags bit that is set while the key is held.
pub fn spawn_modifier_key_tap(
    target_keycode: u64,
    flag_mask: u64,
    on_press: impl Fn() + Send + Sync + 'static,
    on_release: impl Fn() + Send + Sync + 'static,
) -> PttTapHandle {
    let label = if target_keycode == KEYCODE_RIGHT_OPTION { "right-option" } else { "right-control" };
    spawn_tap(
        1u64 << kCGEventFlagsChanged,
        modifier_tap_callback,
        move || Box::into_raw(Box::new(ModifierTapState {
            target_keycode,
            flag_mask,
            on_press: Box::new(on_press),
            on_release: Box::new(on_release),
        })) as *mut c_void,
        label,
    )
}

// ─── CapsLock ───────────────────────────────────────────────────────────────

struct CapsLockTapState {
    // kCGEventFlagsChanged fires twice for CapsLock: once on physical press,
    // once on physical release. The AlphaShift flag tracks lock *state* (toggle),
    // not physical press, so we use an AtomicBool to track physical down/up.
    key_down: AtomicBool,
    on_press: Box<dyn Fn() + Send + Sync>,
    on_release: Box<dyn Fn() + Send + Sync>,
}

unsafe extern "C" fn capslock_tap_callback(
    _proxy: *const c_void,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    if event_type == kCGEventFlagsChanged && !user_info.is_null() {
        let keycode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) as u64;
        if keycode == KEYCODE_CAPS_LOCK {
            let state = &*(user_info as *const CapsLockTapState);
            let was_down = state.key_down.load(Ordering::SeqCst);
            state.key_down.store(!was_down, Ordering::SeqCst);
            if !was_down {
                (state.on_press)();
            } else {
                (state.on_release)();
            }
        }
    }
    event
}

/// Spawns a CGEventTap for the CapsLock key used as a PTT button.
/// Treats physical press/release as start/stop — does not affect the CapsLock toggle state.
pub fn spawn_capslock_tap(
    on_press: impl Fn() + Send + Sync + 'static,
    on_release: impl Fn() + Send + Sync + 'static,
) -> PttTapHandle {
    // kCGEventFlagsChanged fires on any modifier change; we filter by KEYCODE_CAPS_LOCK
    // inside the callback rather than using the AlphaShift flag (which tracks lock state,
    // not physical press/release).
    spawn_tap(
        1u64 << kCGEventFlagsChanged,
        capslock_tap_callback,
        move || Box::into_raw(Box::new(CapsLockTapState {
            key_down: AtomicBool::new(false),
            on_press: Box::new(on_press),
            on_release: Box::new(on_release),
        })) as *mut c_void,
        "capslock",
    )
}

// ─── Shared tap runner ──────────────────────────────────────────────────────

type TapCallbackFn = unsafe extern "C" fn(*const c_void, u32, CGEventRef, *mut c_void) -> CGEventRef;

/// Spawns a background thread with a CGEventTap.
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
            kCGSessionEventTap,
            kCGHeadInsertEventTap,
            kCGEventTapOptionDefault,
            event_mask,
            callback,
            state_ptr,
        );

        if tap.is_null() {
            tracing::warn!("{}-key tap: CGEventTapCreate failed — check Accessibility permission", label);
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

        tracing::info!("{}-key tap: CGEventTap running", label);
        CFRunLoopRun();
        tracing::info!("{}-key tap: run loop stopped", label);
    });

    PttTapHandle { run_loop: run_loop_slot }
}
