//! ADR-046 Slice E — napi exports for the `editorView*` / `createEditorView` /
//! `bufferDrawEditorView` dlopen symbol family. Signatures mirror the Zig
//! `lib.zig` glue. The view is a borrowed TextBufferView handle child of the
//! editor view (shared with the buffer-draw + line-info paths).

#![allow(dead_code)] // napi macro expansion hides usage from dead-code analysis
#![allow(clippy::too_many_arguments)]

use crate::editor_view::{EditorView, VisualCursor};
use crate::handles::{self, Kind};
use napi::bindgen_prelude::BigInt;
use napi_derive::napi;

fn resolve(handle: u32) -> Option<&'static mut EditorView> {
    handles::get(handle, Kind::EditorView).map(|ptr| unsafe { &mut *(ptr as *mut EditorView) })
}

#[allow(dead_code)] // napi macro expansion hides usage from dead-code analysis
unsafe fn opt_rgba(addr: f64) -> Option<[u16; 4]> {
    if addr == 0.0 {
        return None;
    }
    let p = (addr as u64) as usize as *const u16;
    Some(unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] })
}

fn write_visual_cursor(out_ptr: f64, v: VisualCursor) {
    if out_ptr == 0.0 {
        return;
    }
    let base = (out_ptr as u64) as usize;
    unsafe {
        (base as *mut u32).write_unaligned(v.visual_row);
        ((base + 4) as *mut u32).write_unaligned(v.visual_col);
        ((base + 8) as *mut u32).write_unaligned(v.logical_row);
        ((base + 12) as *mut u32).write_unaligned(v.logical_col);
        ((base + 16) as *mut u32).write_unaligned(v.offset);
    }
}

#[napi(js_name = "createEditorView")]
pub fn create_editor_view(edit_handle: u32, viewport_width: u32, viewport_height: u32) -> u32 {
    let Some(view) = EditorView::create(edit_handle, viewport_width, viewport_height) else {
        return 0;
    };
    let ptr = Box::into_raw(view) as usize;
    let handle = handles::insert(Kind::EditorView, ptr);
    if handle == 0 {
        let boxed = unsafe { Box::from_raw(ptr as *mut EditorView) };
        boxed.invalidate_handles();
        return 0;
    }
    handle
}

#[napi(js_name = "destroyEditorView")]
pub fn destroy_editor_view(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::EditorView) {
        let boxed = unsafe { Box::from_raw(ptr as *mut EditorView) };
        boxed.invalidate_handles();
        drop(boxed);
    }
}

#[napi(js_name = "editorViewSetViewport")]
pub fn editor_view_set_viewport(
    handle: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    move_cursor: f64,
) {
    if let Some(v) = resolve(handle) {
        v.set_viewport(
            Some(crate::text_buffer_view::Viewport {
                x,
                y,
                width,
                height,
            }),
            move_cursor != 0.0,
        );
    }
}

#[napi(js_name = "editorViewClearViewport")]
pub fn editor_view_clear_viewport(handle: u32) {
    if let Some(v) = resolve(handle) {
        v.set_viewport(None, false);
    }
}

#[napi(js_name = "editorViewGetViewport")]
pub fn editor_view_get_viewport(
    handle: u32,
    out_x: f64,
    out_y: f64,
    out_w: f64,
    out_h: f64,
) -> bool {
    let vp = resolve(handle).and_then(|v| v.get_viewport());
    let (x, y, w, h) = vp.map_or((0, 0, 0, 0), |vp| (vp.x, vp.y, vp.width, vp.height));
    for (addr, val) in [(out_x, x), (out_y, y), (out_w, w), (out_h, h)] {
        if addr != 0.0 {
            unsafe { ((addr as u64) as usize as *mut u32).write_unaligned(val) };
        }
    }
    vp.is_some()
}

#[napi(js_name = "editorViewSetScrollMargin")]
pub fn editor_view_set_scroll_margin(handle: u32, margin: f64) {
    if let Some(v) = resolve(handle) {
        v.set_scroll_margin(margin as f32);
    }
}

#[napi(js_name = "editorViewGetVirtualLineCount")]
pub fn editor_view_get_virtual_line_count(handle: u32) -> u32 {
    resolve(handle).map_or(0, |v| v.get_virtual_line_count())
}

#[napi(js_name = "editorViewGetTotalVirtualLineCount")]
pub fn editor_view_get_total_virtual_line_count(handle: u32) -> u32 {
    resolve(handle).map_or(0, |v| v.get_total_virtual_line_count())
}

#[napi(js_name = "editorViewGetTextBufferView")]
pub fn editor_view_get_text_buffer_view(handle: u32) -> u32 {
    resolve(handle).map_or(0, |v| v.view_handle())
}

#[napi(js_name = "editorViewGetLineInfoDirect")]
pub fn editor_view_get_line_info_direct(handle: u32, out_ptr: f64) {
    if let Some(v) = resolve(handle) {
        v.prepare_for_draw();
        let vh = v.view_handle();
        crate::text_buffer_view_ffi::text_buffer_view_get_line_info_direct(vh, out_ptr);
    }
}

#[napi(js_name = "editorViewGetLogicalLineInfoDirect")]
pub fn editor_view_get_logical_line_info_direct(handle: u32, out_ptr: f64) {
    // Approximation: delegates to the cached (virtual) line info, exact for
    // wrap=none. A dedicated logical variant lands with the wrap-aware pass.
    if let Some(v) = resolve(handle) {
        let vh = v.view_handle();
        crate::text_buffer_view_ffi::text_buffer_view_get_line_info_direct(vh, out_ptr);
    }
}

#[napi(js_name = "editorViewSetViewportSize")]
pub fn editor_view_set_viewport_size(handle: u32, width: u32, height: u32) {
    if let Some(v) = resolve(handle) {
        v.set_viewport_size(width, height);
    }
}

#[napi(js_name = "editorViewSetWrapMode")]
pub fn editor_view_set_wrap_mode(handle: u32, mode: u32) {
    let wm = match mode {
        1 => crate::segment::WrapMode::Char,
        2 => crate::segment::WrapMode::Word,
        _ => crate::segment::WrapMode::None,
    };
    if let Some(v) = resolve(handle) {
        v.set_wrap_mode(wm);
    }
}

#[napi(js_name = "editorViewSetSelection")]
pub fn editor_view_set_selection(handle: u32, start: u32, end: u32, bg: f64, fg: f64) {
    if let Some(v) = resolve(handle) {
        v.set_selection(start, end, unsafe { opt_rgba(bg) }, unsafe { opt_rgba(fg) });
    }
}

#[napi(js_name = "editorViewUpdateSelection")]
pub fn editor_view_update_selection(handle: u32, end: u32, bg: f64, fg: f64) {
    if let Some(v) = resolve(handle) {
        v.update_selection(end, unsafe { opt_rgba(bg) }, unsafe { opt_rgba(fg) });
    }
}

#[napi(js_name = "editorViewResetSelection")]
pub fn editor_view_reset_selection(handle: u32) {
    if let Some(v) = resolve(handle) {
        v.reset_selection();
    }
}

#[napi(js_name = "editorViewGetSelection")]
pub fn editor_view_get_selection(handle: u32) -> BigInt {
    BigInt::from(resolve(handle).map_or(u64::MAX, |v| v.pack_selection_info()))
}

#[napi(js_name = "editorViewSetLocalSelection")]
pub fn editor_view_set_local_selection(
    handle: u32,
    anchor_x: i32,
    anchor_y: i32,
    focus_x: i32,
    focus_y: i32,
    bg: f64,
    fg: f64,
    update_cursor: f64,
    follow_cursor: f64,
) -> bool {
    resolve(handle).is_some_and(|v| {
        v.set_local_selection(
            anchor_x,
            anchor_y,
            focus_x,
            focus_y,
            unsafe { opt_rgba(bg) },
            unsafe { opt_rgba(fg) },
            update_cursor != 0.0,
            follow_cursor != 0.0,
        )
    })
}

#[napi(js_name = "editorViewUpdateLocalSelection")]
pub fn editor_view_update_local_selection(
    handle: u32,
    anchor_x: i32,
    anchor_y: i32,
    focus_x: i32,
    focus_y: i32,
    bg: f64,
    fg: f64,
    update_cursor: f64,
    follow_cursor: f64,
) -> bool {
    resolve(handle).is_some_and(|v| {
        v.update_local_selection(
            anchor_x,
            anchor_y,
            focus_x,
            focus_y,
            unsafe { opt_rgba(bg) },
            unsafe { opt_rgba(fg) },
            update_cursor != 0.0,
            follow_cursor != 0.0,
        )
    })
}

#[napi(js_name = "editorViewResetLocalSelection")]
pub fn editor_view_reset_local_selection(handle: u32) {
    if let Some(v) = resolve(handle) {
        v.reset_local_selection();
    }
}

#[napi(js_name = "editorViewGetSelectedTextBytes")]
pub fn editor_view_get_selected_text_bytes(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(v) = resolve(handle) else { return 0 };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let text = v.get_selected_text(max_len as usize);
    let copy = text.len().min(max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(text.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy)
    };
    copy as u32
}

#[napi(js_name = "editorViewGetCursor")]
pub fn editor_view_get_cursor(handle: u32, out_row: f64, out_col: f64) {
    let (row, col) = resolve(handle).map_or((0, 0), |v| v.get_cursor());
    if out_row != 0.0 {
        unsafe { ((out_row as u64) as usize as *mut u32).write_unaligned(row) };
    }
    if out_col != 0.0 {
        unsafe { ((out_col as u64) as usize as *mut u32).write_unaligned(col) };
    }
}

#[napi(js_name = "editorViewGetText")]
pub fn editor_view_get_text(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(v) = resolve(handle) else { return 0 };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let text = v.get_text();
    let copy = text.len().min(max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(text.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy)
    };
    copy as u32
}

#[napi(js_name = "editorViewGetVisualCursor")]
pub fn editor_view_get_visual_cursor(handle: u32, out_ptr: f64) {
    let v = resolve(handle).map(|v| v.get_visual_cursor());
    write_visual_cursor(
        out_ptr,
        v.unwrap_or(VisualCursor {
            visual_row: 0,
            visual_col: 0,
            logical_row: 0,
            logical_col: 0,
            offset: 0,
        }),
    );
}

#[napi(js_name = "editorViewMoveUpVisual")]
pub fn editor_view_move_up_visual(handle: u32) {
    if let Some(v) = resolve(handle) {
        v.move_up_visual();
    }
}

#[napi(js_name = "editorViewMoveDownVisual")]
pub fn editor_view_move_down_visual(handle: u32) {
    if let Some(v) = resolve(handle) {
        v.move_down_visual();
    }
}

#[napi(js_name = "editorViewDeleteSelectedText")]
pub fn editor_view_delete_selected_text(handle: u32) {
    if let Some(v) = resolve(handle) {
        v.delete_selected_text();
    }
}

#[napi(js_name = "editorViewSetCursorByOffset")]
pub fn editor_view_set_cursor_by_offset(handle: u32, offset: u32) {
    if let Some(v) = resolve(handle) {
        v.set_cursor_by_offset(offset);
    }
}

#[napi(js_name = "editorViewGetNextWordBoundary")]
pub fn editor_view_get_next_word_boundary(handle: u32, out_ptr: f64) {
    if let Some(v) = resolve(handle) {
        let vc = v.get_next_word_boundary();
        write_visual_cursor(out_ptr, vc);
    } else {
        write_visual_cursor(
            out_ptr,
            VisualCursor {
                visual_row: 0,
                visual_col: 0,
                logical_row: 0,
                logical_col: 0,
                offset: 0,
            },
        );
    }
}

#[napi(js_name = "editorViewGetPrevWordBoundary")]
pub fn editor_view_get_prev_word_boundary(handle: u32, out_ptr: f64) {
    if let Some(v) = resolve(handle) {
        let vc = v.get_prev_word_boundary();
        write_visual_cursor(out_ptr, vc);
    } else {
        write_visual_cursor(
            out_ptr,
            VisualCursor {
                visual_row: 0,
                visual_col: 0,
                logical_row: 0,
                logical_col: 0,
                offset: 0,
            },
        );
    }
}

#[allow(dead_code)] // napi macro expansion hides usage from dead-code analysis
#[napi(js_name = "editorViewGetEOL")]
pub fn editor_view_get_eol(handle: u32, out_ptr: f64) {
    if let Some(v) = resolve(handle) {
        let vc = v.get_eol();
        write_visual_cursor(out_ptr, vc);
    } else {
        write_visual_cursor(
            out_ptr,
            VisualCursor {
                visual_row: 0,
                visual_col: 0,
                logical_row: 0,
                logical_col: 0,
                offset: 0,
            },
        );
    }
}

#[napi(js_name = "editorViewGetVisualSOL")]
pub fn editor_view_get_visual_sol(handle: u32, out_ptr: f64) {
    if let Some(v) = resolve(handle) {
        let vc = v.get_visual_sol();
        write_visual_cursor(out_ptr, vc);
    } else {
        write_visual_cursor(
            out_ptr,
            VisualCursor {
                visual_row: 0,
                visual_col: 0,
                logical_row: 0,
                logical_col: 0,
                offset: 0,
            },
        );
    }
}

#[napi(js_name = "editorViewGetVisualEOL")]
pub fn editor_view_get_visual_eol(handle: u32, out_ptr: f64) {
    if let Some(v) = resolve(handle) {
        let vc = v.get_visual_eol();
        write_visual_cursor(out_ptr, vc);
    } else {
        write_visual_cursor(
            out_ptr,
            VisualCursor {
                visual_row: 0,
                visual_col: 0,
                logical_row: 0,
                logical_col: 0,
                offset: 0,
            },
        );
    }
}

#[napi(js_name = "editorViewSetPlaceholderStyledText")]
pub fn editor_view_set_placeholder_styled_text(_handle: u32, _chunks_ptr: f64, _chunk_count: u32) {
    // Placeholder rendering (buffer swap on empty rope) is a cosmetic visual-only
    // feature deferred to a follow-up; accepted as a no-op so callers don't fail.
}

#[napi(js_name = "editorViewSetTabIndicator")]
pub fn editor_view_set_tab_indicator(handle: u32, indicator: u32) {
    if let Some(v) = resolve(handle) {
        v.set_tab_indicator(Some(indicator));
    }
}

#[napi(js_name = "editorViewSetTabIndicatorColor")]
pub fn editor_view_set_tab_indicator_color(handle: u32, color: f64) {
    if let Some(v) = resolve(handle) {
        v.set_tab_indicator_color(unsafe { opt_rgba(color) });
    }
}

#[napi(js_name = "bufferDrawEditorView")]
pub fn buffer_draw_editor_view(buffer_handle: u32, view_handle: u32, x: i32, y: i32) {
    let vh = match resolve(view_handle) {
        Some(v) => {
            v.prepare_for_draw();
            v.view_handle()
        }
        None => return,
    };
    crate::text_buffer_view_ffi::buffer_draw_text_buffer_view(buffer_handle, vh, x, y);
}
