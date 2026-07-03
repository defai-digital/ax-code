//! ADR-046 Slice C3a — napi exports for the TextBuffer core symbol subset.
//! Signatures mirror the Zig `lib.zig` glue. External text pointers are
//! registered as borrowed memory exactly like the reference (the JS side
//! keeps the allocation alive for the registration's lifetime).

#![allow(clippy::too_many_arguments)]

use crate::handles::{self, Kind};
use crate::mem_registry::MemBuffer;
use crate::text_buffer::{StyledChunkIn, TextBuffer};
use crate::unicode::WidthMethod;
use napi_derive::napi;

fn resolve(handle: u32) -> Option<&'static mut TextBuffer> {
    handles::get(handle, Kind::TextBuffer).map(|ptr| unsafe { &mut *(ptr as *mut TextBuffer) })
}

#[napi(js_name = "createTextBuffer")]
pub fn create_text_buffer(width_method: u32) -> u32 {
    let tb = TextBuffer::new(WidthMethod::from_code(width_method));
    let ptr = Box::into_raw(Box::new(tb)) as usize;
    let handle = handles::insert(Kind::TextBuffer, ptr);
    if handle == 0 {
        drop(unsafe { Box::from_raw(ptr as *mut TextBuffer) });
    }
    handle
}

#[napi(js_name = "destroyTextBuffer")]
pub fn destroy_text_buffer(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::TextBuffer) {
        drop(unsafe { Box::from_raw(ptr as *mut TextBuffer) });
    }
}

/// StyledChunk extern-struct layout (64-bit): text_ptr@0, text_len@8,
/// fg_ptr@16, bg_ptr@24, attributes@32 (u32 + 4 pad), link_ptr@40, link_len@48.
#[napi(js_name = "textBufferSetStyledText")]
pub fn text_buffer_set_styled_text(handle: u32, chunks_ptr: f64, chunk_count: u32) {
    let Some(tb) = resolve(handle) else { return };
    if chunks_ptr == 0.0 || chunk_count == 0 {
        return;
    }
    let base = (chunks_ptr as u64) as usize;
    const STRIDE: usize = 56;
    let read_usize =
        |addr: usize| -> usize { unsafe { std::ptr::read_unaligned(addr as *const usize) } };
    let read_u32 = |addr: usize| -> u32 { unsafe { std::ptr::read_unaligned(addr as *const u32) } };
    let mut chunks: Vec<StyledChunkIn> = Vec::with_capacity(chunk_count as usize);
    for i in 0..chunk_count as usize {
        let off = base + i * STRIDE;
        let text_ptr = read_usize(off);
        let text_len = read_usize(off + 8);
        let text: &[u8] = if text_ptr == 0 || text_len == 0 {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(text_ptr as *const u8, text_len) }
        };
        let link_ptr = read_usize(off + 40);
        let link_len = read_usize(off + 48);
        let link = if link_ptr == 0 || link_len == 0 {
            None
        } else {
            Some(unsafe { std::slice::from_raw_parts(link_ptr as *const u8, link_len) })
        };
        let read_rgba = |addr: usize| -> Option<crate::buffer::Rgba> {
            if addr == 0 {
                return None;
            }
            let p = addr as *const u16;
            Some(unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] })
        };
        chunks.push(StyledChunkIn {
            text,
            fg: read_rgba(read_usize(off + 16)),
            bg: read_rgba(read_usize(off + 24)),
            attributes: read_u32(off + 32),
            link,
        });
    }
    tb.set_styled_text(&chunks);
}

#[napi(js_name = "textBufferGetPlainText")]
pub fn text_buffer_get_plain_text(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(tb) = resolve(handle) else { return 0 };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let text = tb.plain_text();
    let copy = text.len().min(max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(text.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy)
    };
    copy as u32
}

#[napi(js_name = "textBufferGetLength")]
pub fn text_buffer_get_length(handle: u32) -> u32 {
    resolve(handle).map_or(0, |tb| tb.get_length())
}

#[napi(js_name = "textBufferGetByteSize")]
pub fn text_buffer_get_byte_size(handle: u32) -> u32 {
    resolve(handle).map_or(0, |tb| tb.get_byte_size())
}

#[napi(js_name = "textBufferGetLineCount")]
pub fn text_buffer_get_line_count(handle: u32) -> u32 {
    resolve(handle).map_or(0, |tb| tb.get_line_count())
}

#[napi(js_name = "textBufferGetTabWidth")]
pub fn text_buffer_get_tab_width(handle: u32) -> u32 {
    resolve(handle).map_or(0, |tb| tb.tab_width as u32)
}

#[napi(js_name = "textBufferSetTabWidth")]
pub fn text_buffer_set_tab_width(handle: u32, width: u32) {
    if let Some(tb) = resolve(handle) {
        tb.set_tab_width(width as u8);
    }
}

#[napi(js_name = "textBufferReset")]
pub fn text_buffer_reset(handle: u32) {
    if let Some(tb) = resolve(handle) {
        tb.reset();
    }
}

#[napi(js_name = "textBufferClear")]
pub fn text_buffer_clear(handle: u32) {
    if let Some(tb) = resolve(handle) {
        tb.clear();
    }
}

#[napi(js_name = "textBufferAppend")]
pub fn text_buffer_append(handle: u32, data_ptr: f64, data_len: u32) {
    let Some(tb) = resolve(handle) else { return };
    if data_ptr == 0.0 || data_len == 0 {
        return;
    }
    tb.append(
        MemBuffer::External {
            ptr: (data_ptr as u64) as usize,
            len: data_len as usize,
        },
        data_len as usize,
    );
}

#[napi(js_name = "textBufferRegisterMemBuffer")]
pub fn text_buffer_register_mem_buffer(
    handle: u32,
    data_ptr: f64,
    data_len: u32,
    owned: bool,
) -> u32 {
    let Some(tb) = resolve(handle) else {
        return 0xFFFF;
    };
    // Zig sliceFromPtrLen(null, n) yields an empty slice — registration of
    // empty/null data succeeds and consumes a slot.
    if data_ptr == 0.0 || data_len == 0 {
        return tb
            .registry
            .register(MemBuffer::Owned(Vec::new()))
            .map_or(0xFFFF, |id| id as u32);
    }
    let addr = (data_ptr as u64) as usize;
    let buffer = if owned {
        let bytes = unsafe { std::slice::from_raw_parts(addr as *const u8, data_len as usize) };
        MemBuffer::Owned(bytes.to_vec())
    } else {
        MemBuffer::External {
            ptr: addr,
            len: data_len as usize,
        }
    };
    tb.registry.register(buffer).map_or(0xFFFF, |id| id as u32)
}

#[napi(js_name = "textBufferReplaceMemBuffer")]
pub fn text_buffer_replace_mem_buffer(
    handle: u32,
    id: u32,
    data_ptr: f64,
    data_len: u32,
    owned: bool,
) -> bool {
    let Some(tb) = resolve(handle) else {
        return false;
    };
    if data_ptr == 0.0 || data_len == 0 {
        return tb.registry.replace(id as u8, MemBuffer::Owned(Vec::new()));
    }
    let addr = (data_ptr as u64) as usize;
    let buffer = if owned {
        let bytes = unsafe { std::slice::from_raw_parts(addr as *const u8, data_len as usize) };
        MemBuffer::Owned(bytes.to_vec())
    } else {
        MemBuffer::External {
            ptr: addr,
            len: data_len as usize,
        }
    };
    tb.registry.replace(id as u8, buffer)
}

#[napi(js_name = "textBufferClearMemRegistry")]
pub fn text_buffer_clear_mem_registry(handle: u32) {
    if let Some(tb) = resolve(handle) {
        tb.registry.clear();
    }
}

#[napi(js_name = "textBufferSetTextFromMem")]
pub fn text_buffer_set_text_from_mem(handle: u32, id: u32) {
    if let Some(tb) = resolve(handle) {
        tb.set_text_from_mem(id as u8);
    }
}

#[napi(js_name = "textBufferGetTextRange")]
pub fn text_buffer_get_text_range(
    handle: u32,
    start_offset: u32,
    end_offset: u32,
    out_ptr: f64,
    max_len: u32,
) -> u32 {
    let Some(tb) = resolve(handle) else { return 0 };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let out = tb.get_text_range(start_offset, end_offset, max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(
            out.as_ptr(),
            (out_ptr as u64) as usize as *mut u8,
            out.len(),
        )
    };
    out.len() as u32
}

#[napi(js_name = "textBufferGetTextRangeByCoords")]
pub fn text_buffer_get_text_range_by_coords(
    handle: u32,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    out_ptr: f64,
    max_len: u32,
) -> u32 {
    let Some(tb) = resolve(handle) else { return 0 };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let out = tb.get_text_range_by_coords(start_row, start_col, end_row, end_col, max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(
            out.as_ptr(),
            (out_ptr as u64) as usize as *mut u8,
            out.len(),
        )
    };
    out.len() as u32
}

/// ExternalHighlight extern layout: start@0 u32, end@4 u32, style_id@8 u32,
/// priority@12 u8, hl_ref@14 u16 (size 16).
fn read_external_highlight(addr: usize) -> (u32, u32, u32, u8, u16) {
    unsafe {
        (
            std::ptr::read_unaligned(addr as *const u32),
            std::ptr::read_unaligned((addr + 4) as *const u32),
            std::ptr::read_unaligned((addr + 8) as *const u32),
            std::ptr::read_unaligned((addr + 12) as *const u8),
            std::ptr::read_unaligned((addr + 14) as *const u16),
        )
    }
}

#[napi(js_name = "textBufferAddHighlight")]
pub fn text_buffer_add_highlight(handle: u32, line_idx: u32, hl_ptr: f64) {
    let Some(tb) = resolve(handle) else { return };
    if hl_ptr == 0.0 {
        return;
    }
    let (start, end, style_id, priority, hl_ref) =
        read_external_highlight((hl_ptr as u64) as usize);
    tb.add_highlight(
        line_idx as usize,
        start,
        end,
        style_id,
        priority,
        hl_ref,
        false,
    );
}

#[napi(js_name = "textBufferAddHighlightByCharRange")]
pub fn text_buffer_add_highlight_by_char_range(handle: u32, hl_ptr: f64) {
    let Some(tb) = resolve(handle) else { return };
    if hl_ptr == 0.0 {
        return;
    }
    let (start, end, style_id, priority, hl_ref) =
        read_external_highlight((hl_ptr as u64) as usize);
    tb.add_highlight_by_char_range(start, end, style_id, priority, hl_ref, false);
}

#[napi(js_name = "textBufferRemoveHighlightsByRef")]
pub fn text_buffer_remove_highlights_by_ref(handle: u32, hl_ref: u32) {
    if let Some(tb) = resolve(handle) {
        tb.remove_highlights_by_ref(hl_ref as u16);
    }
}

#[napi(js_name = "textBufferClearLineHighlights")]
pub fn text_buffer_clear_line_highlights(handle: u32, line_idx: u32) {
    if let Some(tb) = resolve(handle) {
        tb.clear_line_highlights(line_idx as usize);
    }
}

#[napi(js_name = "textBufferClearAllHighlights")]
pub fn text_buffer_clear_all_highlights(handle: u32) {
    if let Some(tb) = resolve(handle) {
        tb.clear_all_highlights();
    }
}

#[napi(js_name = "textBufferGetHighlightCount")]
pub fn text_buffer_get_highlight_count(handle: u32) -> u32 {
    resolve(handle).map_or(0, |tb| tb.get_highlight_count())
}

#[napi(js_name = "textBufferGetLineHighlightsPtr")]
pub fn text_buffer_get_line_highlights_ptr(handle: u32, line_idx: u32, out_count: f64) -> f64 {
    let Some(tb) = resolve(handle) else {
        return 0.0;
    };
    if out_count == 0.0 {
        return 0.0;
    }
    let out_count_ptr = (out_count as u64) as usize as *mut u32;
    let highs = tb.line_highlights_at(line_idx as usize);
    if highs.is_empty() {
        unsafe { *out_count_ptr = 0 };
        return 0.0;
    }
    let mut packed: Vec<u8> = Vec::with_capacity(highs.len() * 16);
    for hl in highs {
        packed.extend_from_slice(&hl.col_start.to_le_bytes());
        packed.extend_from_slice(&hl.col_end.to_le_bytes());
        packed.extend_from_slice(&hl.style_id.to_le_bytes());
        packed.push(hl.priority);
        packed.push(0); // padding
        packed.extend_from_slice(&hl.hl_ref.to_le_bytes());
    }
    unsafe { *out_count_ptr = highs.len() as u32 };
    let boxed = packed.into_boxed_slice();
    let len = boxed.len();
    let ptr = Box::into_raw(boxed) as *mut u8;
    // freeLineHighlights reconstructs from (ptr, count*16)
    let _ = len;
    ptr as usize as f64
}

#[napi(js_name = "textBufferFreeLineHighlights")]
pub fn text_buffer_free_line_highlights(ptr: f64, count: u32) {
    if ptr == 0.0 || count == 0 {
        return;
    }
    let raw = (ptr as u64) as usize as *mut u8;
    let len = count as usize * 16;
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(raw, len)) });
}

#[napi(js_name = "textBufferAppendFromMemId")]
pub fn text_buffer_append_from_mem_id(handle: u32, id: u32) {
    if let Some(tb) = resolve(handle) {
        tb.append_from_mem(id as u8);
    }
}

// --- syntax styles (C4b) --------------------------------------------------------

use crate::syntax_style::{StyleDefinition, SyntaxStyle};

fn resolve_style(handle: u32) -> Option<&'static mut SyntaxStyle> {
    handles::get(handle, Kind::SyntaxStyle).map(|ptr| unsafe { &mut *(ptr as *mut SyntaxStyle) })
}

#[napi(js_name = "createSyntaxStyle")]
pub fn create_syntax_style() -> u32 {
    let ptr = Box::into_raw(Box::new(SyntaxStyle::new())) as usize;
    let handle = handles::insert(Kind::SyntaxStyle, ptr);
    if handle == 0 {
        drop(unsafe { Box::from_raw(ptr as *mut SyntaxStyle) });
    }
    handle
}

#[napi(js_name = "destroySyntaxStyle")]
pub fn destroy_syntax_style(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::SyntaxStyle) {
        drop(unsafe { Box::from_raw(ptr as *mut SyntaxStyle) });
    }
}

#[napi(js_name = "syntaxStyleRegister")]
pub fn syntax_style_register(
    handle: u32,
    name_ptr: f64,
    name_len: u32,
    fg: f64,
    bg: f64,
    attributes: u32,
) -> u32 {
    let Some(style) = resolve_style(handle) else {
        return 0;
    };
    let name = if name_ptr == 0.0 || name_len == 0 {
        ""
    } else {
        let bytes = unsafe {
            std::slice::from_raw_parts((name_ptr as u64) as usize as *const u8, name_len as usize)
        };
        std::str::from_utf8(bytes).unwrap_or("")
    };
    let read_rgba = |addr: f64| -> Option<crate::buffer::Rgba> {
        if addr == 0.0 {
            return None;
        }
        let p = (addr as u64) as usize as *const u16;
        Some(unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] })
    };
    style.register(
        name,
        StyleDefinition {
            fg: read_rgba(fg),
            bg: read_rgba(bg),
            attributes,
        },
    )
}

#[napi(js_name = "syntaxStyleResolveByName")]
pub fn syntax_style_resolve_by_name(handle: u32, name_ptr: f64, name_len: u32) -> u32 {
    let Some(style) = resolve_style(handle) else {
        return 0;
    };
    if name_ptr == 0.0 || name_len == 0 {
        return style.resolve_by_name("").unwrap_or(0);
    }
    let bytes = unsafe {
        std::slice::from_raw_parts((name_ptr as u64) as usize as *const u8, name_len as usize)
    };
    std::str::from_utf8(bytes)
        .ok()
        .and_then(|n| style.resolve_by_name(n))
        .unwrap_or(0)
}

#[napi(js_name = "syntaxStyleGetStyleCount")]
pub fn syntax_style_get_style_count(handle: u32) -> u32 {
    resolve_style(handle).map_or(0, |s| s.style_count())
}

#[napi(js_name = "textBufferSetSyntaxStyle")]
pub fn text_buffer_set_syntax_style(handle: u32, style_handle: u32) -> bool {
    let Some(tb) = resolve(handle) else {
        return false;
    };
    if style_handle != 0 && handles::get(style_handle, Kind::SyntaxStyle).is_none() {
        return false;
    }
    tb.syntax_style = if style_handle == 0 {
        None
    } else {
        Some(style_handle)
    };
    true
}

#[napi(js_name = "textBufferLoadFile")]
pub fn text_buffer_load_file(_handle: u32, _path_ptr: f64, _path_len: u32) -> bool {
    // File loading (read + styled set) is a documented follow-up; the TUI feeds
    // text buffers through setStyledText/setText rather than this path.
    false
}
