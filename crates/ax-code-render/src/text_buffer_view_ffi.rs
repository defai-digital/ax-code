//! ADR-046 Slice C5a — napi exports for the TextBufferView subset
//! (create/destroy, wrap + viewport config, virtual line count, line info,
//! plain text). Drawing and selection land in later tranches.

use crate::handles::{self, Kind};
use crate::segment::WrapMode;
use crate::text_buffer_view::{TextBufferView, Viewport};
use napi_derive::napi;

fn resolve(handle: u32) -> Option<&'static mut TextBufferView> {
    handles::get(handle, Kind::TextBufferView)
        .map(|ptr| unsafe { &mut *(ptr as *mut TextBufferView) })
}

#[napi(js_name = "createTextBufferView")]
pub fn create_text_buffer_view(tb_handle: u32) -> u32 {
    let Some(tb_ptr) = handles::get(tb_handle, Kind::TextBuffer) else {
        return 0;
    };
    // The reference's view init registers an ellipsis ("…") buffer in the
    // TextBuffer's mem registry — it consumes a slot, so the id streams
    // diverge without it (found by differential fuzz).
    let tb = unsafe { &mut *(tb_ptr as *mut crate::text_buffer::TextBuffer) };
    let _ = tb.registry.register(crate::mem_registry::MemBuffer::Owned(
        "\u{2026}".as_bytes().to_vec(),
    ));
    let view = TextBufferView::new(tb_handle);
    let ptr = Box::into_raw(Box::new(view)) as usize;
    let handle = handles::insert(Kind::TextBufferView, ptr);
    if handle == 0 {
        drop(unsafe { Box::from_raw(ptr as *mut TextBufferView) });
    }
    handle
}

#[napi(js_name = "destroyTextBufferView")]
pub fn destroy_text_buffer_view(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::TextBufferView) {
        drop(unsafe { Box::from_raw(ptr as *mut TextBufferView) });
    }
}

#[napi(js_name = "textBufferViewSetWrapWidth")]
pub fn text_buffer_view_set_wrap_width(handle: u32, width: u32) {
    if let Some(view) = resolve(handle) {
        view.set_wrap_width(if width == 0 { None } else { Some(width) });
    }
}

#[napi(js_name = "textBufferViewSetWrapMode")]
pub fn text_buffer_view_set_wrap_mode(handle: u32, mode: u32) {
    if let Some(view) = resolve(handle) {
        view.set_wrap_mode(match mode {
            1 => WrapMode::Char,
            2 => WrapMode::Word,
            _ => WrapMode::None,
        });
    }
}

#[napi(js_name = "textBufferViewSetFirstLineOffset")]
pub fn text_buffer_view_set_first_line_offset(handle: u32, offset: u32) {
    if let Some(view) = resolve(handle) {
        view.set_first_line_offset(offset);
    }
}

#[napi(js_name = "textBufferViewSetViewportSize")]
pub fn text_buffer_view_set_viewport_size(handle: u32, width: u32, height: u32) {
    if let Some(view) = resolve(handle) {
        view.set_viewport_size(width, height);
    }
}

#[napi(js_name = "textBufferViewSetViewport")]
pub fn text_buffer_view_set_viewport(handle: u32, x: u32, y: u32, width: u32, height: u32) {
    if let Some(view) = resolve(handle) {
        view.set_viewport(Some(Viewport {
            x,
            y,
            width,
            height,
        }));
    }
}

#[napi(js_name = "textBufferViewGetVirtualLineCount")]
pub fn text_buffer_view_get_virtual_line_count(handle: u32) -> u32 {
    resolve(handle).map_or(0, |view| view.virtual_line_count())
}

/// ExternalLineInfo extern layout (64-bit): starts_ptr@0, starts_len@8,
/// widths_ptr@16, widths_len@24, sources_ptr@32, sources_len@40,
/// wraps_ptr@48, wraps_len@56, width_cols_max@64.
#[napi(js_name = "textBufferViewGetLineInfoDirect")]
pub fn text_buffer_view_get_line_info_direct(handle: u32, out_ptr: f64) {
    if out_ptr == 0.0 {
        return;
    }
    let out = (out_ptr as u64) as usize;
    let write_pair = |off: usize, ptr: usize, len: usize| unsafe {
        std::ptr::write_unaligned((out + off) as *mut usize, ptr);
        std::ptr::write_unaligned((out + off + 8) as *mut u32, len as u32);
    };
    let Some(view) = resolve(handle) else {
        write_pair(0, 0, 0);
        write_pair(16, 0, 0);
        write_pair(32, 0, 0);
        write_pair(48, 0, 0);
        unsafe { std::ptr::write_unaligned((out + 64) as *mut u32, 0) };
        return;
    };
    let max = view.refresh_line_info();
    let (starts, widths, sources, wraps) = view.info_slices();
    write_pair(0, starts.as_ptr() as usize, starts.len());
    write_pair(16, widths.as_ptr() as usize, widths.len());
    write_pair(32, sources.as_ptr() as usize, sources.len());
    write_pair(48, wraps.as_ptr() as usize, wraps.len());
    unsafe { std::ptr::write_unaligned((out + 64) as *mut u32, max) };
}

#[napi(js_name = "textBufferViewGetPlainText")]
pub fn text_buffer_view_get_plain_text(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(view) = resolve(handle) else {
        return 0;
    };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let text = view.plain_text();
    let copy = text.len().min(max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(text.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy)
    };
    copy as u32
}

// --- selection (C5b) --------------------------------------------------------

fn read_rgba_ptr(addr: f64) -> Option<crate::buffer::Rgba> {
    if addr == 0.0 {
        return None;
    }
    let p = (addr as u64) as usize as *const u16;
    Some(unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] })
}

#[napi(js_name = "textBufferViewSetSelection")]
pub fn text_buffer_view_set_selection(handle: u32, start: u32, end: u32, bg: f64, fg: f64) {
    if let Some(view) = resolve(handle) {
        view.set_selection(start, end, read_rgba_ptr(bg), read_rgba_ptr(fg));
    }
}

#[napi(js_name = "textBufferViewUpdateSelection")]
pub fn text_buffer_view_update_selection(handle: u32, end: u32, bg: f64, fg: f64) {
    if let Some(view) = resolve(handle) {
        view.update_selection(end, read_rgba_ptr(bg), read_rgba_ptr(fg));
    }
}

#[napi(js_name = "textBufferViewResetSelection")]
pub fn text_buffer_view_reset_selection(handle: u32) {
    if let Some(view) = resolve(handle) {
        view.reset_selection();
    }
}

#[napi(js_name = "textBufferViewGetSelectionInfo")]
pub fn text_buffer_view_get_selection_info(handle: u32) -> i64 {
    resolve(handle).map_or(-1, |view| view.pack_selection_info() as i64)
}

#[napi(js_name = "textBufferViewSetLocalSelection")]
pub fn text_buffer_view_set_local_selection(
    handle: u32,
    ax: i32,
    ay: i32,
    fx: i32,
    fy: i32,
    bg: f64,
    fg: f64,
) -> bool {
    resolve(handle).is_some_and(|view| {
        view.set_local_selection(ax, ay, fx, fy, read_rgba_ptr(bg), read_rgba_ptr(fg))
    })
}

#[napi(js_name = "textBufferViewUpdateLocalSelection")]
pub fn text_buffer_view_update_local_selection(
    handle: u32,
    ax: i32,
    ay: i32,
    fx: i32,
    fy: i32,
    bg: f64,
    fg: f64,
) -> bool {
    resolve(handle).is_some_and(|view| {
        view.update_local_selection(ax, ay, fx, fy, read_rgba_ptr(bg), read_rgba_ptr(fg))
    })
}

#[napi(js_name = "textBufferViewResetLocalSelection")]
pub fn text_buffer_view_reset_local_selection(handle: u32) {
    if let Some(view) = resolve(handle) {
        view.reset_local_selection();
    }
}

#[napi(js_name = "textBufferViewGetSelectedText")]
pub fn text_buffer_view_get_selected_text(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(view) = resolve(handle) else {
        return 0;
    };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let text = view.selected_text(max_len as usize);
    let copy = text.len().min(max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(text.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy)
    };
    copy as u32
}

// --- draw + defaults + tab indicator (C5d) -----------------------------------

#[napi(js_name = "bufferDrawTextBufferView")]
pub fn buffer_draw_text_buffer_view(buffer_handle: u32, view_handle: u32, x: i32, y: i32) {
    let Some(buf_ptr) = handles::get(buffer_handle, Kind::OptimizedBuffer) else {
        return;
    };
    let Some(view) = resolve(view_handle) else {
        return;
    };
    let buffer = unsafe { &mut *(buf_ptr as *mut crate::buffer::OptimizedBuffer) };
    let mut pool = crate::buffer_ffi::global_pool();
    buffer.draw_text_buffer_view(&mut pool, view, x, y);
}

#[napi(js_name = "textBufferViewSetTabIndicator")]
pub fn text_buffer_view_set_tab_indicator(handle: u32, indicator: u32) {
    if let Some(view) = resolve(handle) {
        view.tab_indicator = Some(indicator);
    }
}

#[napi(js_name = "textBufferViewSetTabIndicatorColor")]
pub fn text_buffer_view_set_tab_indicator_color(handle: u32, color: f64) {
    if let Some(view) = resolve(handle) {
        view.tab_indicator_color = read_rgba_ptr(color);
    }
}

#[napi(js_name = "textBufferSetDefaultFg")]
pub fn text_buffer_set_default_fg(handle: u32, fg: f64) {
    if let Some(ptr) = handles::get(handle, Kind::TextBuffer) {
        let tb = unsafe { &mut *(ptr as *mut crate::text_buffer::TextBuffer) };
        tb.default_fg = read_rgba_ptr(fg);
    }
}

#[napi(js_name = "textBufferSetDefaultBg")]
pub fn text_buffer_set_default_bg(handle: u32, bg: f64) {
    if let Some(ptr) = handles::get(handle, Kind::TextBuffer) {
        let tb = unsafe { &mut *(ptr as *mut crate::text_buffer::TextBuffer) };
        tb.default_bg = read_rgba_ptr(bg);
    }
}

#[napi(js_name = "textBufferSetDefaultAttributes")]
pub fn text_buffer_set_default_attributes(handle: u32, attr_ptr: f64) {
    if let Some(ptr) = handles::get(handle, Kind::TextBuffer) {
        let tb = unsafe { &mut *(ptr as *mut crate::text_buffer::TextBuffer) };
        tb.default_attributes = if attr_ptr == 0.0 {
            None
        } else {
            Some(unsafe { std::ptr::read_unaligned((attr_ptr as u64) as usize as *const u32) })
        };
    }
}

#[napi(js_name = "textBufferResetDefaults")]
pub fn text_buffer_reset_defaults(handle: u32) {
    if let Some(ptr) = handles::get(handle, Kind::TextBuffer) {
        let tb = unsafe { &mut *(ptr as *mut crate::text_buffer::TextBuffer) };
        tb.default_fg = None;
        tb.default_bg = None;
        tb.default_attributes = None;
    }
}
