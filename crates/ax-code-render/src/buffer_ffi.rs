//! ADR-046 Slice B — napi exports for the `buffer*` dlopen symbol family
//! (tranche 1 subset). Names and signatures mirror the Zig `lib.zig` export
//! glue so these become the production implementations when the overlay
//! promotes to the full symbol set. Colors arrive as raw addresses of
//! `[4]u16` values (the JS layer packs RGBA into u16 lanes before the call);
//! the overlay bridge narrows BigInt pointers to f64 numbers.

use crate::buffer::{Cell, OptimizedBuffer, Rgba};
use crate::handles::{self, Kind};
use napi_derive::napi;

fn resolve(handle: u32) -> Option<&'static mut OptimizedBuffer> {
    handles::get(handle, Kind::OptimizedBuffer)
        .map(|ptr| unsafe { &mut *(ptr as *mut OptimizedBuffer) })
}

unsafe fn read_rgba(addr: f64) -> Rgba {
    let p = (addr as u64) as usize as *const u16;
    unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] }
}

#[napi(js_name = "createOptimizedBuffer")]
pub fn create_optimized_buffer(
    width: u32,
    height: u32,
    respect_alpha: f64,
    width_method: u32,
    id_ptr: f64,
    id_len: u32,
) -> u32 {
    let id = if id_ptr != 0.0 && id_len > 0 {
        let p = (id_ptr as u64) as usize as *const u8;
        unsafe { std::slice::from_raw_parts(p, id_len as usize) }.to_vec()
    } else {
        Vec::new()
    };
    let Some(buf) = OptimizedBuffer::new(width, height, respect_alpha != 0.0, width_method, id)
    else {
        return 0;
    };
    let ptr = Box::into_raw(Box::new(buf)) as usize;
    let handle = handles::insert(Kind::OptimizedBuffer, ptr);
    if handle == 0 {
        drop(unsafe { Box::from_raw(ptr as *mut OptimizedBuffer) });
    }
    handle
}

#[napi(js_name = "destroyOptimizedBuffer")]
pub fn destroy_optimized_buffer(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::OptimizedBuffer) {
        drop(unsafe { Box::from_raw(ptr as *mut OptimizedBuffer) });
    }
}

#[napi(js_name = "bufferClear")]
pub fn buffer_clear(handle: u32, bg: f64) {
    if let Some(buf) = resolve(handle) {
        buf.clear(unsafe { read_rgba(bg) }, None);
    }
}

#[napi(js_name = "bufferSetCell")]
pub fn buffer_set_cell(handle: u32, x: u32, y: u32, char: u32, fg: f64, bg: f64, attributes: u32) {
    if let Some(buf) = resolve(handle) {
        let cell = Cell {
            char,
            fg: unsafe { read_rgba(fg) },
            bg: unsafe { read_rgba(bg) },
            attributes,
        };
        buf.set(x, y, cell);
    }
}

#[napi(js_name = "bufferSetCellWithAlphaBlending")]
pub fn buffer_set_cell_with_alpha_blending(
    handle: u32,
    x: u32,
    y: u32,
    char: u32,
    fg: f64,
    bg: f64,
    attributes: u32,
) {
    if let Some(buf) = resolve(handle) {
        let cell = Cell {
            char,
            fg: unsafe { read_rgba(fg) },
            bg: unsafe { read_rgba(bg) },
            attributes,
        };
        buf.set_cell_with_alpha_blending(x, y, cell);
    }
}

#[napi(js_name = "bufferDrawChar")]
pub fn buffer_draw_char(handle: u32, char: u32, x: u32, y: u32, fg: f64, bg: f64, attributes: u32) {
    if let Some(buf) = resolve(handle) {
        let cell = Cell {
            char,
            fg: unsafe { read_rgba(fg) },
            bg: unsafe { read_rgba(bg) },
            attributes,
        };
        buf.set_cell_with_alpha_blending(x, y, cell);
    }
}

#[napi(js_name = "bufferFillRect")]
pub fn buffer_fill_rect(handle: u32, x: u32, y: u32, width: u32, height: u32, bg: f64) {
    if let Some(buf) = resolve(handle) {
        buf.fill_rect(x, y, width, height, unsafe { read_rgba(bg) });
    }
}

#[napi(js_name = "bufferPushScissorRect")]
pub fn buffer_push_scissor_rect(handle: u32, x: i32, y: i32, width: u32, height: u32) {
    if let Some(buf) = resolve(handle) {
        buf.push_scissor_rect(x, y, width, height);
    }
}

#[napi(js_name = "bufferPopScissorRect")]
pub fn buffer_pop_scissor_rect(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.pop_scissor_rect();
    }
}

#[napi(js_name = "bufferClearScissorRects")]
pub fn buffer_clear_scissor_rects(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.clear_scissor_rects();
    }
}

#[napi(js_name = "bufferPushOpacity")]
pub fn buffer_push_opacity(handle: u32, opacity: f64) {
    if let Some(buf) = resolve(handle) {
        buf.push_opacity(opacity as f32);
    }
}

#[napi(js_name = "bufferPopOpacity")]
pub fn buffer_pop_opacity(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.pop_opacity();
    }
}

#[napi(js_name = "bufferClearOpacity")]
pub fn buffer_clear_opacity(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.clear_opacity();
    }
}

#[napi(js_name = "bufferGetCurrentOpacity")]
pub fn buffer_get_current_opacity(handle: u32) -> f64 {
    resolve(handle).map_or(1.0, |buf| buf.current_opacity() as f64)
}

#[napi(js_name = "bufferResize")]
pub fn buffer_resize(handle: u32, width: u32, height: u32) {
    if let Some(buf) = resolve(handle) {
        buf.resize(width, height);
    }
}

#[napi(js_name = "bufferGetCharPtr")]
pub fn buffer_get_char_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.char.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetFgPtr")]
pub fn buffer_get_fg_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.fg.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetBgPtr")]
pub fn buffer_get_bg_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.bg.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetAttributesPtr")]
pub fn buffer_get_attributes_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.attributes.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetRealCharSize")]
pub fn buffer_get_real_char_size(handle: u32) -> u32 {
    resolve(handle).map_or(0, |buf| buf.get_real_char_size())
}

#[napi(js_name = "bufferGetRespectAlpha")]
pub fn buffer_get_respect_alpha(handle: u32) -> bool {
    resolve(handle).is_some_and(|buf| buf.respect_alpha)
}

#[napi(js_name = "bufferSetRespectAlpha")]
pub fn buffer_set_respect_alpha(handle: u32, respect_alpha: f64) {
    if let Some(buf) = resolve(handle) {
        buf.respect_alpha = respect_alpha != 0.0;
    }
}

#[napi(js_name = "bufferGetId")]
pub fn buffer_get_id(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(buf) = resolve(handle) else { return 0 };
    if max_len == 0 || out_ptr == 0.0 {
        return 0;
    }
    let copy = buf.id.len().min(max_len as usize);
    let out = (out_ptr as u64) as usize as *mut u8;
    unsafe { std::ptr::copy_nonoverlapping(buf.id.as_ptr(), out, copy) };
    copy as u32
}
