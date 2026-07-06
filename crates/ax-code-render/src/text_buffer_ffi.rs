//! ADR-046 Slice C3a — napi exports for the TextBuffer core symbol subset.
//! Signatures mirror the Zig `lib.zig` glue. External text pointers are
//! registered as borrowed memory exactly like the reference (the JS side
//! keeps the allocation alive for the registration's lifetime).

#![allow(clippy::too_many_arguments)]
#![allow(dead_code)] // napi macro expansion hides usage from dead-code analysis

use crate::handles::{self, Kind};
use crate::ffi_utils as ffi;
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
    let Some(base) = ffi::addr_from_f64(chunks_ptr) else {
        return;
    };
    let Some(chunk_count) = ffi::record_count(chunk_count) else {
        return;
    };
    const STRIDE: usize = 56;
    let field_addr = |base: usize, field_offset: usize| -> Option<usize> {
        ffi::checked_offset(base, field_offset)
    };
    let read_usize = |addr: usize, field_offset: usize| -> Option<usize> {
        ffi::read_unaligned_addr(field_addr(addr, field_offset)?)
    };
    let read_u32 = |addr: usize, field_offset: usize| -> Option<u32> {
        ffi::read_unaligned_addr(field_addr(addr, field_offset)?)
    };
    let mut chunks: Vec<StyledChunkIn> = Vec::with_capacity(chunk_count);
    for i in 0..chunk_count {
        let Some(off) = ffi::checked_record_addr(base, i, STRIDE) else {
            return;
        };
        let Some(text_ptr) = read_usize(off, 0) else { return };
        let Some(text_len) = read_usize(off, 8) else { return };
        let text: &[u8] = if text_ptr == 0 || text_len == 0 {
            &[]
        } else {
            let Some(bytes) = (unsafe { ffi::bytes_from_addr(text_ptr, text_len) }) else {
                return;
            };
            bytes
        };
        let Some(link_ptr) = read_usize(off, 40) else { return };
        let Some(link_len) = read_usize(off, 48) else { return };
        let link = if link_ptr == 0 || link_len == 0 {
            None
        } else {
            let Some(bytes) = (unsafe { ffi::bytes_from_addr(link_ptr, link_len) }) else {
                return;
            };
            Some(bytes)
        };
        chunks.push(StyledChunkIn {
            text,
            fg: read_usize(off, 16).and_then(ffi::read_rgba_addr),
            bg: read_usize(off, 24).and_then(ffi::read_rgba_addr),
            attributes: read_u32(off, 32).unwrap_or(0),
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
    ffi::copy_raw_to_f64(text.as_ptr(), text.len(), out_ptr, max_len)
}

#[napi(js_name = "textBufferGetLength")]
pub fn text_buffer_get_length(handle: u32) -> u32 {
    resolve(handle).map_or(0, |tb| tb.get_length())
}

#[napi(js_name = "textBufferGetByteSize")]
pub fn text_buffer_get_byte_size(handle: u32) -> u32 {
    resolve(handle).map_or(0, |tb| tb.get_byte_size())
}

#[allow(dead_code)]
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
        tb.set_tab_width(width.min(u8::MAX as u32) as u8);
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
    let Some(addr) = ffi::addr_from_f64(data_ptr) else {
        return;
    };
    let Some(len) = ffi::byte_len_from_u32(data_len) else {
        return;
    };
    tb.append(
        MemBuffer::External {
            ptr: addr,
            len,
        },
        len,
    );
}

#[napi(js_name = "textBufferRegisterMemBuffer")]
pub fn text_buffer_register_mem_buffer(
    handle: u32,
    data_ptr: f64,
    data_len: u32,
    owned: f64,
) -> u32 {
    let owned = owned != 0.0;
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
    let Some(addr) = ffi::addr_from_f64(data_ptr) else {
        return 0xFFFF;
    };
    let Some(len) = ffi::byte_len_from_u32(data_len) else {
        return 0xFFFF;
    };
    let buffer = if owned {
        let Some(bytes) = (unsafe { ffi::bytes_from_addr(addr, len) }) else {
            return 0xFFFF;
        };
        MemBuffer::Owned(bytes.to_vec())
    } else {
        MemBuffer::External {
            ptr: addr,
            len,
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
    owned: f64,
) -> bool {
    let owned = owned != 0.0;
    let Some(tb) = resolve(handle) else {
        return false;
    };
    let Ok(id) = u8::try_from(id) else {
        return false;
    };
    if data_ptr == 0.0 || data_len == 0 {
        return tb.registry.replace(id, MemBuffer::Owned(Vec::new()));
    }
    let Some(addr) = ffi::addr_from_f64(data_ptr) else {
        return false;
    };
    let Some(len) = ffi::byte_len_from_u32(data_len) else {
        return false;
    };
    let buffer = if owned {
        let Some(bytes) = (unsafe { ffi::bytes_from_addr(addr, len) }) else {
            return false;
        };
        MemBuffer::Owned(bytes.to_vec())
    } else {
        MemBuffer::External {
            ptr: addr,
            len,
        }
    };
    tb.registry.replace(id, buffer)
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
        if let Ok(id) = u8::try_from(id) {
            tb.set_text_from_mem(id);
        }
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
    ffi::copy_raw_to_f64(out.as_ptr(), out.len(), out_ptr, max_len)
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
    ffi::copy_raw_to_f64(out.as_ptr(), out.len(), out_ptr, max_len)
}

/// ExternalHighlight extern layout: start@0 u32, end@4 u32, style_id@8 u32,
/// priority@12 u8, hl_ref@14 u16 (size 16).
fn read_external_highlight(addr: usize) -> Option<(u32, u32, u32, u8, u16)> {
    Some((
        ffi::read_unaligned_addr(addr)?,
        ffi::read_unaligned_addr(ffi::checked_offset(addr, 4)?)?,
        ffi::read_unaligned_addr(ffi::checked_offset(addr, 8)?)?,
        ffi::read_unaligned_addr(ffi::checked_offset(addr, 12)?)?,
        ffi::read_unaligned_addr(ffi::checked_offset(addr, 14)?)?,
    ))
}

#[napi(js_name = "textBufferAddHighlight")]
pub fn text_buffer_add_highlight(handle: u32, line_idx: u32, hl_ptr: f64) {
    let Some(tb) = resolve(handle) else { return };
    if hl_ptr == 0.0 {
        return;
    }
    let Some(addr) = ffi::addr_from_f64(hl_ptr) else { return };
    let Some((start, end, style_id, priority, hl_ref)) = read_external_highlight(addr) else {
        return;
    };
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
    let Some(addr) = ffi::addr_from_f64(hl_ptr) else { return };
    let Some((start, end, style_id, priority, hl_ref)) = read_external_highlight(addr) else {
        return;
    };
    tb.add_highlight_by_char_range(start, end, style_id, priority, hl_ref, false);
}

#[napi(js_name = "textBufferRemoveHighlightsByRef")]
pub fn text_buffer_remove_highlights_by_ref(handle: u32, hl_ref: u32) {
    if let Some(tb) = resolve(handle) {
        if let Ok(hl_ref) = u16::try_from(hl_ref) {
            tb.remove_highlights_by_ref(hl_ref);
        }
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
    let highs = tb.line_highlights_at(line_idx as usize);
    if highs.is_empty() {
        let _ = ffi::write_unaligned_f64(out_count, 0u32);
        return 0.0;
    }
    let Some(count) = u32::try_from(highs.len()).ok() else {
        let _ = ffi::write_unaligned_f64(out_count, 0u32);
        return 0.0;
    };
    let Some(capacity) = highs.len().checked_mul(16) else {
        let _ = ffi::write_unaligned_f64(out_count, 0u32);
        return 0.0;
    };
    let mut packed: Vec<u8> = Vec::with_capacity(capacity);
    for hl in highs {
        packed.extend_from_slice(&hl.col_start.to_le_bytes());
        packed.extend_from_slice(&hl.col_end.to_le_bytes());
        packed.extend_from_slice(&hl.style_id.to_le_bytes());
        packed.push(hl.priority);
        packed.push(0); // padding
        packed.extend_from_slice(&hl.hl_ref.to_le_bytes());
    }
    let _ = ffi::write_unaligned_f64(out_count, count);
    let boxed = packed.into_boxed_slice();
    let len = boxed.len();
    let ptr = Box::into_raw(boxed) as *mut u8;
    // freeLineHighlights reconstructs from (ptr, count*16)
    let handle = ffi::addr_to_f64(ptr as usize);
    if handle == 0.0 {
        drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
    }
    handle
}

#[napi(js_name = "textBufferFreeLineHighlights")]
pub fn text_buffer_free_line_highlights(ptr: f64, count: u32) {
    if ptr == 0.0 || count == 0 {
        return;
    }
    let Some(count) = ffi::record_count(count) else {
        return;
    };
    let Some(raw) = ffi::addr_from_f64(ptr).map(|addr| addr as *mut u8) else {
        return;
    };
    let Some(len) = count.checked_mul(16) else {
        return;
    };
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(raw, len)) });
}

#[napi(js_name = "textBufferAppendFromMemId")]
pub fn text_buffer_append_from_mem_id(handle: u32, id: u32) {
    if let Some(tb) = resolve(handle) {
        if let Ok(id) = u8::try_from(id) {
            tb.append_from_mem(id);
        }
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
        let Some(bytes) = (unsafe { ffi::bytes_from_f64(name_ptr, name_len) }) else {
            return 0;
        };
        std::str::from_utf8(bytes).unwrap_or("")
    };
    style.register(
        name,
        StyleDefinition {
            fg: ffi::read_rgba_f64(fg),
            bg: ffi::read_rgba_f64(bg),
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
    let Some(bytes) = (unsafe { ffi::bytes_from_f64(name_ptr, name_len) }) else {
        return 0;
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
pub fn text_buffer_load_file(handle: u32, path_ptr: f64, path_len: u32) -> bool {
    let Some(tb) = resolve(handle) else {
        return false;
    };
    if path_ptr == 0.0 || path_len == 0 {
        return false;
    }
    let Some(bytes) = (unsafe { ffi::bytes_from_f64(path_ptr, path_len) }) else {
        return false;
    };
    let Ok(path) = std::str::from_utf8(bytes) else {
        return false;
    };
    let Ok(contents) = std::fs::read(path) else {
        return false;
    };
    let len = contents.len();
    tb.set_text(crate::mem_registry::MemBuffer::Owned(contents), len)
        .is_some()
}
