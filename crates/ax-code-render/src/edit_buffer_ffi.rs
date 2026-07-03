//! ADR-046 Slice D — napi exports for EditBuffer. Cursor structs marshal
//! through the 12-byte ExternalLogicalCursor layout (row@0, col@4, offset@8).

use crate::edit_buffer::{Cursor, EditBuffer};
use crate::handles::{self, Kind};
use crate::unicode::WidthMethod;
use napi_derive::napi;

fn resolve(handle: u32) -> Option<&'static mut EditBuffer> {
    handles::get(handle, Kind::EditBuffer).map(|ptr| unsafe { &mut *(ptr as *mut EditBuffer) })
}

fn write_cursor(out_ptr: f64, c: &Cursor) {
    if out_ptr == 0.0 {
        return;
    }
    let base = (out_ptr as u64) as usize;
    unsafe {
        std::ptr::write_unaligned(base as *mut u32, c.row);
        std::ptr::write_unaligned((base + 4) as *mut u32, c.col);
        std::ptr::write_unaligned((base + 8) as *mut u32, c.offset);
    }
}

#[napi(js_name = "createEditBuffer")]
pub fn create_edit_buffer(width_method: u32, _event_sink_handle: u32) -> u32 {
    let mut eb = EditBuffer::new(WidthMethod::from_code(width_method));
    // register the inner text buffer so views/renderers can target it
    let tb_ptr = (&mut *eb.tb) as *mut crate::text_buffer::TextBuffer as usize;
    let tb_handle = handles::insert(Kind::TextBuffer, tb_ptr);
    eb.tb_handle = tb_handle;
    let ptr = Box::into_raw(Box::new(eb)) as usize;
    let handle = handles::insert(Kind::EditBuffer, ptr);
    if handle == 0 {
        drop(unsafe { Box::from_raw(ptr as *mut EditBuffer) });
    }
    handle
}

#[napi(js_name = "destroyEditBuffer")]
pub fn destroy_edit_buffer(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::EditBuffer) {
        let eb = unsafe { Box::from_raw(ptr as *mut EditBuffer) };
        if eb.tb_handle != 0 {
            handles::remove(eb.tb_handle, Kind::TextBuffer);
        }
        drop(eb);
    }
}

#[napi(js_name = "editBufferGetTextBuffer")]
pub fn edit_buffer_get_text_buffer(handle: u32) -> u32 {
    resolve(handle).map_or(0, |eb| eb.tb_handle)
}

#[napi(js_name = "editBufferGetId")]
pub fn edit_buffer_get_id(handle: u32) -> u32 {
    handle
}

#[napi(js_name = "editBufferInsertText")]
pub fn edit_buffer_insert_text(handle: u32, text_ptr: f64, text_len: u32) {
    let Some(eb) = resolve(handle) else { return };
    if text_ptr == 0.0 || text_len == 0 {
        return;
    }
    let bytes = unsafe { std::slice::from_raw_parts((text_ptr as u64) as usize as *const u8, text_len as usize) };
    eb.insert_text(bytes);
}

#[napi(js_name = "editBufferInsertChar")]
pub fn edit_buffer_insert_char(handle: u32, text_ptr: f64, text_len: u32) {
    edit_buffer_insert_text(handle, text_ptr, text_len);
}

#[napi(js_name = "editBufferNewLine")]
pub fn edit_buffer_new_line(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.insert_text(b"\n");
    }
}

#[napi(js_name = "editBufferDeleteCharBackward")]
pub fn edit_buffer_delete_char_backward(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.backspace();
    }
}

#[napi(js_name = "editBufferDeleteChar")]
pub fn edit_buffer_delete_char(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.delete_forward();
    }
}

#[napi(js_name = "editBufferDeleteLine")]
pub fn edit_buffer_delete_line(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.delete_line();
    }
}

#[napi(js_name = "editBufferDeleteRange")]
pub fn edit_buffer_delete_range(handle: u32, start_row: u32, start_col: u32, end_row: u32, end_col: u32) {
    if let Some(eb) = resolve(handle) {
        eb.delete_range(
            Cursor { row: start_row, col: start_col, ..Default::default() },
            Cursor { row: end_row, col: end_col, ..Default::default() },
        );
    }
}

#[napi(js_name = "editBufferMoveCursorLeft")]
pub fn edit_buffer_move_left(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.move_left();
    }
}

#[napi(js_name = "editBufferMoveCursorRight")]
pub fn edit_buffer_move_right(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.move_right();
    }
}

#[napi(js_name = "editBufferMoveCursorUp")]
pub fn edit_buffer_move_up(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.move_up();
    }
}

#[napi(js_name = "editBufferMoveCursorDown")]
pub fn edit_buffer_move_down(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.move_down();
    }
}

#[napi(js_name = "editBufferSetCursor")]
pub fn edit_buffer_set_cursor(handle: u32, row: u32, col: u32) {
    if let Some(eb) = resolve(handle) {
        eb.set_cursor(row, col);
    }
}

#[napi(js_name = "editBufferSetCursorToLineCol")]
pub fn edit_buffer_set_cursor_to_line_col(handle: u32, row: u32, col: u32) {
    if let Some(eb) = resolve(handle) {
        eb.set_cursor(row, col);
    }
}

#[napi(js_name = "editBufferSetCursorByOffset")]
pub fn edit_buffer_set_cursor_by_offset(handle: u32, offset: u32) {
    if let Some(eb) = resolve(handle) {
        eb.set_cursor_by_offset(offset);
    }
}

#[napi(js_name = "editBufferGetCursorPosition")]
pub fn edit_buffer_get_cursor_position(handle: u32, out_ptr: f64) {
    let Some(eb) = resolve(handle) else {
        write_cursor(out_ptr, &Cursor::default());
        return;
    };
    let (row, col, offset) = eb.cursor_position();
    write_cursor(out_ptr, &Cursor { row, col, offset, desired_col: col });
}

#[napi(js_name = "editBufferGetCursor")]
pub fn edit_buffer_get_cursor(handle: u32, out_ptr: f64) {
    edit_buffer_get_cursor_position(handle, out_ptr);
}

#[napi(js_name = "editBufferGetNextWordBoundary")]
pub fn edit_buffer_get_next_word_boundary(handle: u32, out_ptr: f64) {
    let Some(eb) = resolve(handle) else {
        write_cursor(out_ptr, &Cursor::default());
        return;
    };
    let c = eb.next_word_boundary();
    write_cursor(out_ptr, &c);
}

#[napi(js_name = "editBufferGetPrevWordBoundary")]
pub fn edit_buffer_get_prev_word_boundary(handle: u32, out_ptr: f64) {
    let Some(eb) = resolve(handle) else {
        write_cursor(out_ptr, &Cursor::default());
        return;
    };
    let c = eb.prev_word_boundary();
    write_cursor(out_ptr, &c);
}

#[napi(js_name = "editBufferGetEOL")]
pub fn edit_buffer_get_eol(handle: u32, out_ptr: f64) {
    let Some(eb) = resolve(handle) else {
        write_cursor(out_ptr, &Cursor::default());
        return;
    };
    let c = eb.get_eol();
    write_cursor(out_ptr, &c);
}

#[napi(js_name = "editBufferGotoLine")]
pub fn edit_buffer_goto_line(handle: u32, line: u32) {
    if let Some(eb) = resolve(handle) {
        eb.goto_line(line);
    }
}

#[napi(js_name = "editBufferSetText")]
pub fn edit_buffer_set_text(handle: u32, text_ptr: f64, text_len: u32) {
    let Some(eb) = resolve(handle) else { return };
    let bytes = if text_ptr == 0.0 || text_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts((text_ptr as u64) as usize as *const u8, text_len as usize) }
    };
    eb.set_text(bytes);
}

#[napi(js_name = "editBufferReplaceText")]
pub fn edit_buffer_replace_text(handle: u32, text_ptr: f64, text_len: u32) {
    let Some(eb) = resolve(handle) else { return };
    let bytes = if text_ptr == 0.0 || text_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts((text_ptr as u64) as usize as *const u8, text_len as usize) }
    };
    eb.replace_text(bytes);
}

#[napi(js_name = "editBufferGetText")]
pub fn edit_buffer_get_text(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(eb) = resolve(handle) else { return 0 };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let text = eb.get_text();
    let copy = text.len().min(max_len as usize);
    unsafe { std::ptr::copy_nonoverlapping(text.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy) };
    copy as u32
}

#[napi(js_name = "editBufferGetTextRange")]
pub fn edit_buffer_get_text_range(handle: u32, start: u32, end: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(eb) = resolve(handle) else { return 0 };
    if out_ptr == 0.0 || max_len == 0 {
        return 0;
    }
    let text = eb.get_text_range(start, end, max_len as usize);
    let copy = text.len().min(max_len as usize);
    unsafe { std::ptr::copy_nonoverlapping(text.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy) };
    copy as u32
}

#[napi(js_name = "editBufferGetLineStartOffset")]
pub fn edit_buffer_get_line_start_offset(handle: u32, row: u32) -> u32 {
    resolve(handle).map_or(0, |eb| eb.line_start_offset(row))
}

#[napi(js_name = "editBufferOffsetToPosition")]
pub fn edit_buffer_offset_to_position(handle: u32, offset: u32, out_ptr: f64) -> bool {
    let Some(eb) = resolve(handle) else {
        write_cursor(out_ptr, &Cursor::default());
        return false;
    };
    match eb.tb.offset_to_coords(offset) {
        Some((row, col)) => {
            write_cursor(out_ptr, &Cursor { row, col, offset, desired_col: col });
            true
        }
        None => {
            write_cursor(out_ptr, &Cursor::default());
            false
        }
    }
}

#[napi(js_name = "editBufferPositionToOffset")]
pub fn edit_buffer_position_to_offset(handle: u32, row: u32, col: u32) -> i64 {
    resolve(handle).map_or(-1, |eb| eb.tb.coords_to_offset(row, col).map_or(-1, |o| o as i64))
}

#[napi(js_name = "editBufferUndo")]
pub fn edit_buffer_undo(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(eb) = resolve(handle) else { return 0 };
    if max_len == 0 || out_ptr == 0.0 {
        return 0;
    }
    let meta = eb.undo();
    let copy = meta.len().min(max_len as usize);
    unsafe { std::ptr::copy_nonoverlapping(meta.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy) };
    copy as u32
}

#[napi(js_name = "editBufferRedo")]
pub fn edit_buffer_redo(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(eb) = resolve(handle) else { return 0 };
    if max_len == 0 || out_ptr == 0.0 {
        return 0;
    }
    let meta = eb.redo();
    let copy = meta.len().min(max_len as usize);
    unsafe { std::ptr::copy_nonoverlapping(meta.as_ptr(), (out_ptr as u64) as usize as *mut u8, copy) };
    copy as u32
}

#[napi(js_name = "editBufferCanUndo")]
pub fn edit_buffer_can_undo(handle: u32) -> bool {
    resolve(handle).is_some_and(|eb| eb.can_undo())
}

#[napi(js_name = "editBufferCanRedo")]
pub fn edit_buffer_can_redo(handle: u32) -> bool {
    resolve(handle).is_some_and(|eb| eb.can_redo())
}

#[napi(js_name = "editBufferClearHistory")]
pub fn edit_buffer_clear_history(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.clear_history();
    }
}

#[napi(js_name = "editBufferClear")]
pub fn edit_buffer_clear(handle: u32) {
    if let Some(eb) = resolve(handle) {
        eb.clear();
    }
}
