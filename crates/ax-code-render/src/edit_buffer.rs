//! ADR-046 Slice D — EditBuffer, ported from the Zig reference
//! (`edit-buffer.zig`, opentui v0.4.1).
//!
//! A single-cursor text editor over the TextBuffer/rope. Inserted text is
//! appended to a growable "add buffer" (registered once in the text buffer's
//! mem registry) and spliced into the rope by weight; chunks straddling an
//! edit boundary split via findPosByWidth. Undo/redo ride the rope's
//! root-snapshot history with the cursor encoded as `cursor:row:col:desired`
//! metadata. Cursor movement, word boundaries, and line ops mirror the
//! reference exactly.

use crate::mem_registry::MemBuffer;
use crate::segment::{FLAG_ASCII_ONLY, MARKER_LINESTART, Segment, TextChunk};
use crate::text_buffer::TextBuffer;
use crate::unicode::{
    WidthMethod, calculate_text_width, find_pos_by_width, is_ascii_only, is_word_codepoint,
};

#[derive(Clone, Copy, Default)]
pub struct Cursor {
    pub row: u32,
    pub col: u32,
    pub desired_col: u32,
    pub offset: u32,
}

pub struct EditBuffer {
    pub tb: Box<TextBuffer>,
    pub tb_handle: u32,
    add_mem_id: u8,
    add_len: usize,
    cursor: Cursor,
}

fn make_chunk(
    mem_id: u8,
    byte_start: u32,
    byte_end: u32,
    bytes: &[u8],
    tab: u8,
    method: WidthMethod,
) -> TextChunk {
    let text = std::str::from_utf8(bytes).unwrap_or("");
    let ascii = is_ascii_only(text);
    let flags = if !bytes.is_empty() && ascii {
        FLAG_ASCII_ONLY
    } else {
        0
    };
    let width = calculate_text_width(text, tab, method).min(65535) as u16;
    TextChunk::new(mem_id, byte_start, byte_end, width, flags)
}

fn encode_cursor(c: &Cursor) -> Vec<u8> {
    format!("cursor:{}:{}:{}", c.row, c.col, c.desired_col).into_bytes()
}

fn decode_cursor(bytes: &[u8]) -> Option<(u32, u32, u32)> {
    let s = std::str::from_utf8(bytes).ok()?;
    let rest = s.strip_prefix("cursor:")?;
    let mut parts = rest.split(':');
    let row = parts.next()?.parse().ok()?;
    let col = parts.next()?.parse().ok()?;
    let desired = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((row, col, desired))
}

impl EditBuffer {
    pub fn new(width_method: WidthMethod) -> EditBuffer {
        let mut tb = TextBuffer::new(width_method);
        // AddBuffer: one owned, growable mem slot for all inserted text.
        let add_mem_id = tb
            .registry
            .register(MemBuffer::Owned(Vec::with_capacity(65536)))
            .unwrap_or(0);
        EditBuffer {
            tb: Box::new(tb),
            tb_handle: 0,
            add_mem_id,
            add_len: 0,
            cursor: Cursor::default(),
        }
    }

    fn reset_add_buffer(&mut self) {
        self.tb.registry.clear();
        self.add_len = 0;
        self.add_mem_id = self
            .tb
            .registry
            .register(MemBuffer::Owned(Vec::with_capacity(65536)))
            .unwrap_or(0);
    }

    pub fn primary_cursor(&self) -> Cursor {
        self.cursor
    }

    /// Set the primary cursor directly (editor-view visual moves / recenter).
    pub fn set_primary_cursor(&mut self, cursor: Cursor) {
        self.cursor = cursor;
    }

    /// Max display width across all logical lines (editor-view horizontal clamp).
    pub fn max_line_width(&mut self) -> u32 {
        let line_count = self.tb.get_line_count();
        let mut max = 0u32;
        for row in 0..line_count {
            max = max.max(self.tb.line_width_at(row));
        }
        max
    }

    fn line_width(&mut self, row: u32) -> u32 {
        self.tb.line_width_at(row)
    }

    fn coords_to_offset(&mut self, row: u32, col: u32) -> u32 {
        self.tb.coords_to_offset(row, col).unwrap_or(0)
    }

    pub fn set_cursor(&mut self, row: u32, col: u32) {
        let line_count = self.tb.get_line_count();
        let clamped_row = row.min(line_count.saturating_sub(1));
        let line_width = self.line_width(clamped_row);
        let clamped_col = col.min(line_width);
        let offset = self.coords_to_offset(clamped_row, clamped_col);
        self.cursor = Cursor {
            row: clamped_row,
            col: clamped_col,
            desired_col: clamped_col,
            offset,
        };
    }

    pub fn set_cursor_by_offset(&mut self, offset: u32) {
        let (row, col) = self.tb.offset_to_coords(offset).unwrap_or((0, 0));
        self.set_cursor(row, col);
    }

    /// Append bytes to the add buffer and return (mem_id, byte_start).
    fn add_buffer_append(&mut self, bytes: &[u8]) -> (u8, u32) {
        let start = self.add_len as u32;
        // grow the owned mem slot
        let mut data = match self.tb.registry.get(self.add_mem_id) {
            Some(d) => d.to_vec(),
            None => Vec::new(),
        };
        data.truncate(self.add_len);
        data.extend_from_slice(bytes);
        self.add_len = data.len();
        self.tb
            .registry
            .replace(self.add_mem_id, MemBuffer::Owned(data));
        (self.add_mem_id, start)
    }

    fn chunk_splitter(
        tb_tab: u8,
        method: WidthMethod,
        bytes_of: impl Fn(&TextChunk) -> Vec<u8> + 'static,
    ) -> Box<dyn Fn(&Segment, u32) -> Option<(Segment, Segment)>> {
        Box::new(move |seg: &Segment, weight: u32| {
            let chunk = seg.as_text()?;
            let chunk_weight = chunk.width as u32;
            if weight == 0 {
                return Some((
                    Segment::Text(TextChunk::empty()),
                    Segment::Text(chunk.clone()),
                ));
            }
            if weight >= chunk_weight {
                return Some((
                    Segment::Text(chunk.clone()),
                    Segment::Text(TextChunk::empty()),
                ));
            }
            let bytes = bytes_of(chunk);
            let text = std::str::from_utf8(&bytes).unwrap_or("");
            let is_ascii = (chunk.flags & FLAG_ASCII_ONLY) != 0;
            let split =
                find_pos_by_width(text, weight, tb_tab, is_ascii, false, method).byte_offset;
            let left = make_chunk(
                chunk.mem_id,
                chunk.byte_start,
                chunk.byte_start + split,
                &bytes[..split as usize],
                tb_tab,
                method,
            );
            let right = make_chunk(
                chunk.mem_id,
                chunk.byte_start + split,
                chunk.byte_end,
                &bytes[split as usize..],
                tb_tab,
                method,
            );
            Some((Segment::Text(left), Segment::Text(right)))
        })
    }

    pub fn insert_text(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.auto_store_undo();
        let cursor = self.cursor;
        // Zig: coordsToOffset ... orelse return InvalidCursor. An invalid cursor
        // aborts the insert — it must NOT fall back to offset 0 (which would
        // splice the text at the buffer start).
        let Some(insert_offset) = self.tb.coords_to_offset(cursor.row, cursor.col) else {
            return;
        };
        let (mem_id, base_start) = self.add_buffer_append(bytes);
        let segments = self.tb.text_to_segments(bytes, mem_id, base_start, false);

        let mut inserted_width: u32 = 0;
        let mut width_after_last_break: u32 = 0;
        let mut num_breaks: u32 = 0;
        for seg in &segments {
            match seg {
                Segment::Brk => {
                    num_breaks += 1;
                    width_after_last_break = 0;
                }
                Segment::Text(chunk) => {
                    inserted_width += chunk.width as u32;
                    width_after_last_break += chunk.width as u32;
                }
                Segment::LineStart => {}
            }
        }

        if !segments.is_empty() {
            let splitter = self.make_splitter();
            self.tb
                .rope
                .insert_slice_by_weight(insert_offset, &segments, &splitter);
        }

        if num_breaks > 0 {
            let new_row = cursor.row + num_breaks;
            let new_col = width_after_last_break;
            let new_offset = self.coords_to_offset(new_row, new_col);
            self.cursor = Cursor {
                row: new_row,
                col: new_col,
                desired_col: new_col,
                offset: new_offset,
            };
        } else {
            let new_col = cursor.col + inserted_width;
            let new_offset = self.coords_to_offset(cursor.row, new_col);
            self.cursor = Cursor {
                row: cursor.row,
                col: new_col,
                desired_col: new_col,
                offset: new_offset,
            };
        }
    }

    fn make_splitter(&self) -> Box<dyn Fn(&Segment, u32) -> Option<(Segment, Segment)>> {
        let tab = self.tb.tab_width;
        let method = self.tb.width_method;
        // Snapshot the registry contents needed to fetch chunk bytes.
        let registry_snapshot = self.tb.registry.snapshot();
        Self::chunk_splitter(tab, method, move |chunk: &TextChunk| {
            registry_snapshot
                .get(&chunk.mem_id)
                .map(|buf| buf[chunk.byte_start as usize..chunk.byte_end as usize].to_vec())
                .unwrap_or_default()
        })
    }

    pub fn delete_range(&mut self, start: Cursor, end: Cursor) {
        let (mut start, mut end) = (start, end);
        if start.row > end.row || (start.row == end.row && start.col > end.col) {
            std::mem::swap(&mut start, &mut end);
        }
        if start.row == end.row && start.col == end.col {
            return;
        }
        self.auto_store_undo();
        let start_offset = self.coords_to_offset(start.row, start.col);
        let end_offset = self.coords_to_offset(end.row, end.col);
        if start_offset >= end_offset {
            return;
        }
        let splitter = self.make_splitter();
        self.tb
            .rope
            .delete_range_by_weight(start_offset, end_offset, &splitter);

        let line_count = self.tb.get_line_count();
        let clamped_row = if start.row >= line_count {
            line_count.saturating_sub(1)
        } else {
            start.row
        };
        let line_width = if line_count > 0 {
            self.line_width(clamped_row)
        } else {
            0
        };
        let clamped_col = start.col.min(line_width);
        let offset = self.coords_to_offset(clamped_row, clamped_col);
        self.cursor = Cursor {
            row: clamped_row,
            col: clamped_col,
            desired_col: clamped_col,
            offset,
        };
    }

    pub fn backspace(&mut self) {
        let cursor = self.cursor;
        if cursor.row == 0 && cursor.col == 0 {
            return;
        }
        if cursor.col == 0 {
            if cursor.row > 0 {
                let prev_line_width = self.line_width(cursor.row - 1);
                self.delete_range(
                    Cursor {
                        row: cursor.row - 1,
                        col: prev_line_width,
                        ..Default::default()
                    },
                    Cursor {
                        row: cursor.row,
                        col: 0,
                        ..Default::default()
                    },
                );
            }
        } else {
            let prev_w = self.tb.prev_grapheme_width(cursor.row, cursor.col);
            if prev_w == 0 {
                return;
            }
            let target_col = cursor.col - prev_w;
            self.delete_range(
                Cursor {
                    row: cursor.row,
                    col: target_col,
                    ..Default::default()
                },
                Cursor {
                    row: cursor.row,
                    col: cursor.col,
                    ..Default::default()
                },
            );
        }
    }

    pub fn delete_forward(&mut self) {
        let cursor = self.cursor;
        // Zig deleteForward stores undo UNCONDITIONALLY here (before any no-op
        // check), so even a delete at buffer end pushes an undo entry and clears
        // redo — matching the reference's history bookkeeping. deleteRange then
        // stores a second (identical-root) entry on the real path.
        self.auto_store_undo();
        let line_width = self.line_width(cursor.row);
        let line_count = self.tb.get_line_count();
        if cursor.col < line_width {
            let w = self.tb.grapheme_width_at(cursor.row, cursor.col);
            if w == 0 {
                return;
            }
            self.delete_range(
                Cursor {
                    row: cursor.row,
                    col: cursor.col,
                    ..Default::default()
                },
                Cursor {
                    row: cursor.row,
                    col: cursor.col + w,
                    ..Default::default()
                },
            );
        } else if cursor.row + 1 < line_count {
            self.delete_range(
                Cursor {
                    row: cursor.row,
                    col: line_width,
                    ..Default::default()
                },
                Cursor {
                    row: cursor.row + 1,
                    col: 0,
                    ..Default::default()
                },
            );
        }
    }

    pub fn move_left(&mut self) {
        let mut c = self.cursor;
        if c.col > 0 {
            let prev_w = self.tb.prev_grapheme_width(c.row, c.col);
            c.col -= prev_w;
        } else if c.row > 0 {
            c.row -= 1;
            c.col = self.line_width(c.row);
        }
        c.desired_col = c.col;
        c.offset = self.coords_to_offset(c.row, c.col);
        self.cursor = c;
    }

    pub fn move_right(&mut self) {
        let mut c = self.cursor;
        let line_width = self.line_width(c.row);
        let line_count = self.tb.get_line_count();
        if c.col < line_width {
            let w = self.tb.grapheme_width_at(c.row, c.col);
            c.col += w;
        } else if c.row + 1 < line_count {
            c.row += 1;
            c.col = 0;
        }
        c.desired_col = c.col;
        c.offset = self.coords_to_offset(c.row, c.col);
        self.cursor = c;
    }

    pub fn move_up(&mut self) {
        let mut c = self.cursor;
        if c.row > 0 {
            if c.desired_col == 0 {
                c.desired_col = c.col;
            }
            c.row -= 1;
            let line_width = self.line_width(c.row);
            c.col = c.desired_col.min(line_width);
            c.offset = self.coords_to_offset(c.row, c.col);
        }
        self.cursor = c;
    }

    pub fn move_down(&mut self) {
        let mut c = self.cursor;
        let line_count = self.tb.get_line_count();
        if c.row + 1 < line_count {
            if c.desired_col == 0 {
                c.desired_col = c.col;
            }
            c.row += 1;
            let line_width = self.line_width(c.row);
            c.col = c.desired_col.min(line_width);
            c.offset = self.coords_to_offset(c.row, c.col);
        }
        self.cursor = c;
    }

    pub fn set_text(&mut self, text: &[u8]) {
        self.tb.rope.clear_history();
        self.tb.clear();
        self.reset_add_buffer();
        let (mem_id, base_start) = self.add_buffer_append(text);
        let segments = self.tb.text_to_segments(text, mem_id, base_start, true);
        self.tb.rope.set_items(&segments);
        self.set_cursor(0, 0);
    }

    pub fn replace_text(&mut self, text: &[u8]) {
        self.auto_store_undo();
        self.tb.clear();
        let (mem_id, base_start) = self.add_buffer_append(text);
        let segments = self.tb.text_to_segments(text, mem_id, base_start, true);
        self.tb.rope.set_items(&segments);
        self.set_cursor(0, 0);
    }

    pub fn get_text(&self) -> Vec<u8> {
        self.tb.plain_text()
    }

    pub fn delete_line(&mut self) {
        let cursor = self.cursor;
        let line_count = self.tb.get_line_count();
        if cursor.row >= line_count {
            return;
        }
        if cursor.row + 1 < line_count {
            self.delete_range(
                Cursor {
                    row: cursor.row,
                    col: 0,
                    ..Default::default()
                },
                Cursor {
                    row: cursor.row + 1,
                    col: 0,
                    ..Default::default()
                },
            );
        } else if cursor.row > 0 {
            let prev_line_width = self.line_width(cursor.row - 1);
            let curr_line_width = self.line_width(cursor.row);
            self.delete_range(
                Cursor {
                    row: cursor.row - 1,
                    col: prev_line_width,
                    ..Default::default()
                },
                Cursor {
                    row: cursor.row,
                    col: curr_line_width,
                    ..Default::default()
                },
            );
        } else {
            let curr_line_width = self.line_width(cursor.row);
            self.delete_range(
                Cursor {
                    row: cursor.row,
                    col: 0,
                    ..Default::default()
                },
                Cursor {
                    row: cursor.row,
                    col: curr_line_width,
                    ..Default::default()
                },
            );
        }
    }

    pub fn goto_line(&mut self, line: u32) {
        let line_count = self.tb.get_line_count();
        let target = line.min(line_count.saturating_sub(1));
        if line >= line_count {
            // Past the end: land at the last line's end column (reference quirk).
            let last_width = self.line_width(target);
            self.set_cursor(target, last_width);
        } else {
            self.set_cursor(target, 0);
        }
    }

    pub fn clear(&mut self) {
        self.tb.clear();
        self.set_cursor(0, 0);
    }

    // --- undo / redo ------------------------------------------------------------

    fn auto_store_undo(&mut self) {
        let meta = encode_cursor(&self.cursor);
        self.tb.rope.store_undo(&meta);
    }

    fn restore_cursor_from_meta(&mut self, meta: &[u8]) -> bool {
        if let Some((row, col, desired)) = decode_cursor(meta) {
            self.set_cursor(row, col);
            self.cursor.desired_col = desired;
            true
        } else {
            false
        }
    }

    pub fn undo(&mut self) -> Vec<u8> {
        let current_meta = encode_cursor(&self.cursor);
        let prev = self.tb.rope.undo(&current_meta).unwrap_or_default();
        if !self.restore_cursor_from_meta(&prev) {
            let c = self.cursor;
            self.set_cursor(c.row, c.col);
        }
        prev
    }

    pub fn redo(&mut self) -> Vec<u8> {
        let next = self.tb.rope.redo().unwrap_or_default();
        if !self.restore_cursor_from_meta(&next) {
            let c = self.cursor;
            self.set_cursor(c.row, c.col);
        }
        next
    }

    pub fn can_undo(&self) -> bool {
        self.tb.rope.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.tb.rope.can_redo()
    }

    pub fn clear_history(&mut self) {
        self.tb.rope.clear_history();
    }

    pub fn get_eol(&mut self) -> Cursor {
        let cursor = self.cursor;
        let line_count = self.tb.get_line_count();
        if cursor.row >= line_count {
            return cursor;
        }
        let line_width = self.line_width(cursor.row);
        let offset = self.coords_to_offset(cursor.row, line_width);
        Cursor {
            row: cursor.row,
            col: line_width,
            desired_col: line_width,
            offset,
        }
    }

    // --- word boundaries --------------------------------------------------------

    pub fn next_word_boundary(&mut self) -> Cursor {
        let cursor = self.cursor;
        let line_count = self.tb.get_line_count();
        if cursor.row >= line_count {
            return cursor;
        }
        let line_width = self.line_width(cursor.row);
        let chunks = self.tb.line_chunks_full(cursor.row);
        let mut cols_before: u32 = 0;
        let mut passed_cursor = false;
        for (chunk_ref, width, bytes, graphemes, wrap_offsets) in &chunks {
            let next_cols = cols_before + width;
            if cursor.col < next_cols || passed_cursor {
                let mut grapheme_idx: usize = 0;
                let mut col_delta: i64 = 0;
                let local_cursor_col = cursor.col.saturating_sub(cols_before);
                for wb in wrap_offsets.iter() {
                    let (break_col, break_width) = crate::unicode::char_offset_to_column(
                        wb.char_offset,
                        graphemes,
                        &mut grapheme_idx,
                        &mut col_delta,
                    );
                    if passed_cursor || break_col > local_cursor_col {
                        let target_col = cols_before + break_col + break_width;
                        if target_col <= line_width {
                            let offset = self.coords_to_offset(cursor.row, target_col);
                            return Cursor {
                                row: cursor.row,
                                col: target_col,
                                desired_col: target_col,
                                offset,
                            };
                        }
                    }
                    if !passed_cursor && break_col == local_cursor_col {
                        let bo = wb.byte_offset as usize;
                        if bo < bytes.len() {
                            let (cp, _) = crate::unicode::decode_at(bytes, bo);
                            if is_word_codepoint(cp) {
                                let target_col = cols_before + break_col + break_width;
                                if target_col <= line_width {
                                    let offset = self.coords_to_offset(cursor.row, target_col);
                                    return Cursor {
                                        row: cursor.row,
                                        col: target_col,
                                        desired_col: target_col,
                                        offset,
                                    };
                                }
                            }
                        }
                    }
                }
                passed_cursor = true;
            }
            cols_before = next_cols;
            let _ = chunk_ref;
        }
        if cursor.row + 1 < line_count {
            let offset = self.coords_to_offset(cursor.row + 1, 0);
            return Cursor {
                row: cursor.row + 1,
                col: 0,
                desired_col: 0,
                offset,
            };
        }
        let offset = self.coords_to_offset(cursor.row, line_width);
        Cursor {
            row: cursor.row,
            col: line_width,
            desired_col: line_width,
            offset,
        }
    }

    pub fn prev_word_boundary(&mut self) -> Cursor {
        let cursor = self.cursor;
        if cursor.row == 0 && cursor.col == 0 {
            return cursor;
        }
        let chunks = self.tb.line_chunks_full(cursor.row);
        let mut cols_before: u32 = 0;
        let mut last_boundary: Option<u32> = None;
        for (_chunk_ref, width, _bytes, graphemes, wrap_offsets) in &chunks {
            let next_cols = cols_before + width;
            let mut grapheme_idx: usize = 0;
            let mut col_delta: i64 = 0;
            for wb in wrap_offsets.iter() {
                let (break_col, break_width) = crate::unicode::char_offset_to_column(
                    wb.char_offset,
                    graphemes,
                    &mut grapheme_idx,
                    &mut col_delta,
                );
                let boundary_col = cols_before + break_col + break_width;
                if boundary_col < cursor.col {
                    last_boundary = Some(boundary_col);
                }
            }
            cols_before = next_cols;
            if cursor.col <= cols_before {
                break;
            }
        }
        if let Some(boundary_col) = last_boundary {
            let offset = self.coords_to_offset(cursor.row, boundary_col);
            return Cursor {
                row: cursor.row,
                col: boundary_col,
                desired_col: boundary_col,
                offset,
            };
        }
        if cursor.row > 0 {
            let prev_line_width = self.line_width(cursor.row - 1);
            let offset = self.coords_to_offset(cursor.row - 1, prev_line_width);
            return Cursor {
                row: cursor.row - 1,
                col: prev_line_width,
                desired_col: prev_line_width,
                offset,
            };
        }
        Cursor::default()
    }

    pub fn cursor_position(&self) -> (u32, u32, u32) {
        (self.cursor.row, self.cursor.col, self.cursor.offset)
    }

    pub fn get_text_range(&mut self, start: u32, end: u32, max_len: usize) -> Vec<u8> {
        self.tb.get_text_range(start, end, max_len)
    }

    pub fn line_start_offset(&mut self, row: u32) -> u32 {
        self.tb
            .rope
            .get_marker(MARKER_LINESTART, row)
            .map_or(0, |m| m.global_weight)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_into_empty_single_line() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.insert_text(b"hello");
        assert_eq!(eb.get_text(), b"hello");
        assert_eq!(eb.tb.get_line_count(), 1);
        assert_eq!(eb.tb.line_width_at(0), 5);
        let eol = eb.get_eol();
        assert_eq!((eol.row, eol.col), (0, 5));
    }

    #[test]
    fn insert_cjk_width() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.insert_text("世界".as_bytes());
        assert_eq!(eb.tb.get_line_count(), 1);
        assert_eq!(eb.tb.line_width_at(0), 4);
    }

    #[test]
    fn insert_two_steps() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.insert_text(b"ab");
        eb.insert_text(b"cd");
        assert_eq!(eb.get_text(), b"abcd");
        assert_eq!(eb.tb.line_width_at(0), 4);
    }

    #[test]
    fn repeated_set_text_reuses_registry_capacity() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        for i in 0..300 {
            eb.set_text(format!("value-{i}").as_bytes());
        }
        assert_eq!(eb.get_text(), b"value-299");
        assert_eq!(eb.tb.registry.used_slots(), 1);
    }

    #[test]
    fn repeated_replace_text_keeps_undo_text_available() {
        let mut eb = EditBuffer::new(WidthMethod::Unicode);
        eb.set_text(b"initial");
        for i in 0..300 {
            eb.replace_text(format!("value-{i}").as_bytes());
        }
        assert_eq!(eb.get_text(), b"value-299");
        assert!(eb.tb.registry.used_slots() < 255);
        eb.undo();
        assert_eq!(eb.get_text(), b"value-298");
    }
}
