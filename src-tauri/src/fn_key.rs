// Fn-key push-to-talk via raw CGEventTap (macOS only).
//
// rdev crashes on macOS 13+ because its internal `string_from_code` calls
// `TSMGetInputSourceProperty` (HIToolbox) which requires the main dispatch
// queue but is invoked from a background CFRunLoop thread.
//
// This module bypasses rdev entirely: we set up a CGEventTap that listens
// only for `kCGEventFlagsChanged` events and checks the
// `kCGEventFlagMaskSecondaryFn` (0x00800000) bit — no key-to-string
// conversion, no HIToolbox, no crash.
#[allow(non_upper_case_globals, non_snake_case)]

use std::os::raw::{c_int, c_void};
use std::sync::atomic::{AtomicBool, Ordering};

// CGEventTapLocation
const kCGSessionEventTap: c_int = 1;
// CGEventTapPlacement
const kCGHeadInsertEventTap: c_int = 0;
// CGEventTapOptions
const kCGEventTapOptionDefault: c_int = 0;
// CGEventType
const kCGEventFlagsChanged: u32 = 12;
// kCGEventFlagMaskSecondaryFn — set in CGEventFlags when the fn key is held
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
    static kCFRunLoopCommonModes: *const c_void;
}

struct TapState {
    fn_down: AtomicBool,
    on_press: Box<dyn Fn() + Send + Sync>,
    on_release: Box<dyn Fn() + Send + Sync>,
}

unsafe extern "C" fn tap_callback(
    _proxy: *const c_void,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    if event_type == kCGEventFlagsChanged && !user_info.is_null() {
        let flags = CGEventGetFlags(event);
        let fn_now = (flags & kCGEventFlagMaskSecondaryFn) != 0;
        let state = &*(user_info as *const TapState);
        let was_down = state.fn_down.swap(fn_now, Ordering::SeqCst);
        if fn_now && !was_down {
            (state.on_press)();
        } else if !fn_now && was_down {
            (state.on_release)();
        }
    }
    event // pass event through (non-blocking tap)
}

/// Spawns a background thread that runs a CGEventTap to detect fn key
/// press/release. Calls `on_press` when fn is pressed, `on_release` when
/// released. Requires Accessibility permission.
pub fn spawn_fn_key_tap(
    on_press: impl Fn() + Send + Sync + 'static,
    on_release: impl Fn() + Send + Sync + 'static,
) {
    std::thread::spawn(move || unsafe {
        let state = Box::new(TapState {
            fn_down: AtomicBool::new(false),
            on_press: Box::new(on_press),
            on_release: Box::new(on_release),
        });
        let state_ptr = Box::into_raw(state) as *mut c_void;

        let tap = CGEventTapCreate(
            kCGSessionEventTap,
            kCGHeadInsertEventTap,
            kCGEventTapOptionDefault,
            1u64 << kCGEventFlagsChanged,
            tap_callback,
            state_ptr,
        );

        if tap.is_null() {
            tracing::warn!(
                "fn-key tap: CGEventTapCreate failed — check Accessibility permission"
            );
            drop(Box::from_raw(state_ptr as *mut TapState));
            return;
        }

        let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
        if source.is_null() {
            tracing::warn!("fn-key tap: CFMachPortCreateRunLoopSource failed");
            drop(Box::from_raw(state_ptr as *mut TapState));
            return;
        }

        let rl = CFRunLoopGetCurrent();
        CFRunLoopAddSource(rl, source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        tracing::info!("fn-key tap: CGEventTap running");

        CFRunLoopRun(); // blocks until the run loop exits (never under normal conditions)

        tracing::warn!("fn-key tap: run loop exited unexpectedly");
        drop(Box::from_raw(state_ptr as *mut TapState));
    });
}
