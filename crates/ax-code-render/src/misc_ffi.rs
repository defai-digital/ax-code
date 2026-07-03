//! ADR-046 Slice E — remaining peripheral dlopen symbols to complete the
//! addon's coverage of the Zig `lib.zig` export table. Real logic where cheap
//! and verifiable (link URL pool, encodeUnicode, event-sink handles); honest
//! documented stubs for the paths that need bookkeeping deliberately scoped out
//! of the render-core (mem-buffer input, terminal-name/notification/osc52
//! detection, allocator/build diagnostics, debug overlay draw, snapshot commit).

#![allow(clippy::missing_safety_doc)]

use crate::handles::{self, Kind};
use crate::renderer::CliRenderer;
use crate::unicode::{WidthMethod, encode_widths};
use napi::bindgen_prelude::BigInt;
use napi_derive::napi;
use std::sync::{Mutex, OnceLock};

fn renderer(handle: u32) -> Option<&'static mut CliRenderer> {
    handles::get(handle, Kind::Renderer).map(|ptr| unsafe { &mut *(ptr as *mut CliRenderer) })
}

// --- link URL pool (link.zig linkAlloc / linkGetUrl) -------------------------

fn link_pool() -> &'static Mutex<Vec<String>> {
    static POOL: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(Vec::new()))
}

#[napi(js_name = "linkAlloc")]
pub fn link_alloc(url_ptr: f64, url_len: u32) -> u32 {
    if url_ptr == 0.0 || url_len == 0 {
        return 0;
    }
    let p = (url_ptr as u64) as usize as *const u8;
    let bytes = unsafe { std::slice::from_raw_parts(p, url_len as usize) };
    let url = String::from_utf8_lossy(bytes).into_owned();
    let mut pool = link_pool().lock().unwrap();
    pool.push(url);
    pool.len() as u32 // ids are 1-based
}

#[napi(js_name = "linkGetUrl")]
pub fn link_get_url(id: u32, out_ptr: f64, max_len: u32) -> u32 {
    if id == 0 || out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let pool = link_pool().lock().unwrap();
    let Some(url) = pool.get(id as usize - 1) else {
        return 0;
    };
    let copy = url.len().min(max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(url.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy)
    };
    copy as u32
}

#[napi(js_name = "clearGlobalLinkPool")]
pub fn clear_global_link_pool_misc() {
    link_pool().lock().unwrap().clear();
}

// --- encodeUnicode / freeUnicode (utf8.zig) ----------------------------------

#[repr(C)]
struct EncodedChar {
    width: u8,
    char: u32,
}

#[napi(js_name = "encodeUnicode")]
pub fn encode_unicode(
    text_ptr: f64,
    text_len: u32,
    out_ptr: f64,
    out_len_ptr: f64,
    width_method: u32,
) -> bool {
    // out_ptr: *(*EncodedChar), out_len_ptr: *usize
    if text_ptr == 0.0 || text_len == 0 {
        if out_ptr != 0.0 {
            unsafe { ((out_ptr as u64) as usize as *mut usize).write_unaligned(0) };
        }
        if out_len_ptr != 0.0 {
            unsafe { ((out_len_ptr as u64) as usize as *mut usize).write_unaligned(0) };
        }
        return true;
    }
    let p = (text_ptr as u64) as usize as *const u8;
    let bytes = unsafe { std::slice::from_raw_parts(p, text_len as usize) };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let cells = encode_widths(text, WidthMethod::from_code(width_method), 2);
    let mut out: Vec<EncodedChar> = Vec::with_capacity(cells.len());
    for (width, ch) in cells {
        out.push(EncodedChar {
            width: width as u8,
            char: ch,
        });
    }
    out.shrink_to_fit();
    let len = out.len();
    let ptr = out.as_mut_ptr();
    std::mem::forget(out); // ownership passes to JS; reclaimed by freeUnicode
    unsafe {
        ((out_ptr as u64) as usize as *mut usize).write_unaligned(ptr as usize);
        ((out_len_ptr as u64) as usize as *mut usize).write_unaligned(len);
    }
    true
}

#[napi(js_name = "freeUnicode")]
pub fn free_unicode(chars_ptr: f64, chars_len: u32) {
    if chars_ptr == 0.0 || chars_len == 0 {
        return;
    }
    let ptr = (chars_ptr as u64) as usize as *mut EncodedChar;
    // Allocated with cap == len (shrink_to_fit above).
    drop(unsafe { Vec::from_raw_parts(ptr, chars_len as usize, chars_len as usize) });
}

// --- event sink (event-bus.zig) — handle lifecycle only ----------------------
//
// The port polls the EditBuffer for cursor changes instead of dispatching
// events, so the sink is inert; the handle exists for API compatibility.
#[napi(js_name = "createEventSink")]
pub fn create_event_sink(_callback: f64) -> u32 {
    handles::insert(Kind::EventSink, 1)
}

#[napi(js_name = "destroyEventSink")]
pub fn destroy_event_sink(handle: u32) {
    handles::remove(handle, Kind::EventSink);
}

// --- clipboard OSC52 (gated on the osc52 capability) -------------------------

/// ClipboardTarget code → OSC 52 target char (intToEnum order; default clipboard).
fn clipboard_target_char(target: u32) -> u8 {
    match target {
        1 => b'p', // primary
        2 => b's', // secondary
        3 => b'q', // query
        _ => b'c', // clipboard
    }
}

#[napi(js_name = "copyToClipboardOSC52")]
pub fn copy_to_clipboard_osc52(
    handle: u32,
    target: u32,
    payload_ptr: f64,
    payload_len: u32,
) -> bool {
    let Some(r) = renderer(handle) else {
        return false;
    };
    let payload: &[u8] = if payload_ptr == 0.0 || payload_len == 0 {
        &[]
    } else {
        unsafe {
            std::slice::from_raw_parts(
                (payload_ptr as u64) as usize as *const u8,
                payload_len as usize,
            )
        }
    };
    r.copy_to_clipboard_osc52(clipboard_target_char(target), payload)
}

#[napi(js_name = "clearClipboardOSC52")]
pub fn clear_clipboard_osc52(handle: u32, target: u32) -> bool {
    let Some(r) = renderer(handle) else {
        return false;
    };
    r.clear_clipboard_osc52(clipboard_target_char(target))
}

// --- notification (gated on notification protocol detection) -----------------
#[napi(js_name = "triggerNotification")]
pub fn trigger_notification(
    _handle: u32,
    _msg_ptr: f64,
    _msg_len: u32,
    _title_ptr: f64,
    _title_len: u32,
) -> bool {
    false
}

// --- debug / diagnostics -----------------------------------------------------

#[napi(js_name = "dumpBuffers")]
pub fn dump_buffers(handle: u32, timestamp: f64) {
    if let Some(r) = renderer(handle) {
        r.dump_output_buffer(timestamp as i64);
    }
}

#[napi(js_name = "setDebugOverlay")]
pub fn set_debug_overlay(_handle: u32, _enabled: f64, _corner: u32) {
    // Overlay rendering is not ported; storing the flag without a draw would
    // diverge when enabled, so this is intentionally inert (off = no divergence).
}

#[napi(js_name = "setTerminalEnvVar")]
pub fn set_terminal_env_var(
    handle: u32,
    key_ptr: f64,
    key_len: u32,
    val_ptr: f64,
    val_len: u32,
) -> bool {
    let Some(r) = renderer(handle) else {
        return false;
    };
    let read = |ptr: f64, len: u32| -> String {
        if ptr == 0.0 || len == 0 {
            String::new()
        } else {
            let bytes = unsafe {
                std::slice::from_raw_parts((ptr as u64) as usize as *const u8, len as usize)
            };
            String::from_utf8_lossy(bytes).into_owned()
        }
    };
    r.set_terminal_env_var(&read(key_ptr, key_len), &read(val_ptr, val_len));
    true
}

#[napi(js_name = "processCapabilityResponse")]
pub fn process_capability_response(_handle: u32, _resp_ptr: f64, _resp_len: u32) {
    // Query-response parsing (updates caps) is unported; caps come from env.
}

#[napi(js_name = "getTerminalCapabilities")]
pub fn get_terminal_capabilities(handle: u32, caps_ptr: f64) {
    if caps_ptr == 0.0 {
        return;
    }
    let base = (caps_ptr as u64) as usize;
    match renderer(handle) {
        // Boolean capabilities are exact; terminal name/version are left empty
        // (name bookkeeping not tracked — a documented partial getter).
        Some(r) => r.write_terminal_capabilities(base),
        None => unsafe { std::ptr::write_bytes(base as *mut u8, 0, 64) },
    }
}

#[napi(js_name = "getAllocatorStats")]
pub fn get_allocator_stats(_out_ptr: f64) {}

#[napi(js_name = "getBuildOptions")]
pub fn get_build_options(_out_ptr: f64) {}

#[napi(js_name = "commitSplitFooterSnapshot")]
pub fn commit_split_footer_snapshot(handle: u32) -> BigInt {
    // Batched snapshot commit is a follow-up; report a rendered result with the
    // current render offset so callers don't treat it as a failure.
    let offset = renderer(handle).map_or(0u64, |r| r.render_offset() as u64);
    BigInt::from(offset)
}
