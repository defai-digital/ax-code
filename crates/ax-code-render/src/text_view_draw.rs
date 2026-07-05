//! ADR-046 Slice C5d — bufferDrawTextBufferView, ported from the Zig
//! reference (`buffer.zig` drawTextBufferInternal, opentui v0.4.1).
//!
//! Walks the view's virtual lines, resolving per-column styles from the
//! line's style spans (event-sweep over highlights, computed per line),
//! applying the selection per cell, packing multi-byte graphemes through the
//! pool, and writing cells with alpha blending (with the transparent-text
//! fast path). Truncation/ellipsis branches land with the truncate tranche.

use crate::buffer::{
    Cell, DEFAULT_SPACE_CHAR, OptimizedBuffer, Rgba, alpha, is_continuation_char, is_grapheme_char,
    pack_grapheme_start,
};
use crate::handles::{self, Kind};
use crate::pool::{GRAPHEME_ID_MASK, GraphemePool};
use crate::segment::StyleSpan;
use crate::syntax_style::SyntaxStyle;
use crate::text_buffer::TextBuffer;
use crate::text_buffer_view::TextBufferView;
use crate::unicode::find_pos_by_width;

fn rgb_color(r: u16, g: u16, b: u16, a: u16) -> Rgba {
    [r, g, b, a]
}

fn link_id(attributes: u32) -> u32 {
    attributes >> 8
}

/// Zig `rebuildLineSpans`: event sweep over one line's highlights. Highest
/// priority wins; the reference breaks priority ties by hash-map iteration
/// order (nondeterministic upstream), here the LOWEST index among the
/// highest-priority actives wins.
fn build_line_spans(tb: &TextBuffer, line_idx: usize, line_width: u32) -> Vec<StyleSpan> {
    let highlights = tb.line_highlights_at(line_idx);
    if highlights.is_empty() {
        return Vec::new();
    }
    #[derive(Clone, Copy)]
    struct Event {
        col: u32,
        is_start: bool,
        hl_idx: usize,
    }
    let mut events: Vec<Event> = Vec::with_capacity(highlights.len() * 2);
    for (idx, hl) in highlights.iter().enumerate() {
        events.push(Event {
            col: hl.col_start,
            is_start: true,
            hl_idx: idx,
        });
        events.push(Event {
            col: hl.col_end,
            is_start: false,
            hl_idx: idx,
        });
    }
    events.sort_by(|a, b| {
        a.col
            .cmp(&b.col)
            .then_with(|| b.is_start.cmp(&a.is_start).reverse()) // ends before starts
            .then_with(|| a.hl_idx.cmp(&b.hl_idx))
    });
    let mut spans = Vec::new();
    let mut active: Vec<usize> = Vec::new();
    let mut current_col: u32 = 0;
    for event in &events {
        // Stop processing events beyond the line boundary. The trailing span
        // logic below will emit any remaining styled region to line_width.
        if event.col >= line_width {
            break;
        }
        let mut current_priority: i32 = -1;
        let mut current_style: u32 = 0;
        for &hl_idx in &active {
            let hl = &highlights[hl_idx];
            if hl.priority as i32 > current_priority {
                current_priority = hl.priority as i32;
                current_style = hl.style_id;
            }
        }
        if event.col > current_col {
            spans.push(StyleSpan {
                col: current_col,
                style_id: current_style,
                next_col: event.col,
            });
            current_col = event.col;
        }
        if event.is_start {
            if !active.contains(&event.hl_idx) {
                active.push(event.hl_idx);
            }
        } else {
            active.retain(|&i| i != event.hl_idx);
        }
    }
    // Emit the trailing span to line_width. Active highlights whose end events
    // were not processed (they extend past the last event / to line end) still
    // carry a style that must be applied to the remainder of the line.
    if !events.is_empty() && current_col < line_width {
        let mut trailing_priority: i32 = -1;
        let mut trailing_style: u32 = 0;
        for &hl_idx in &active {
            let hl = &highlights[hl_idx];
            if hl.priority as i32 > trailing_priority {
                trailing_priority = hl.priority as i32;
                trailing_style = hl.style_id;
            }
        }
        spans.push(StyleSpan {
            col: current_col,
            style_id: trailing_style,
            next_col: line_width,
        });
    }
    spans
}

fn resolve_style(
    style: Option<&SyntaxStyle>,
    style_id: u32,
    default: (Rgba, Rgba, u32),
) -> (Rgba, Rgba, u32) {
    let (mut fg, mut bg, mut attrs) = default;
    if style_id != 0 {
        if let Some(s) = style {
            if let Some(def) = s.resolve_by_id(style_id) {
                if let Some(f) = def.fg {
                    fg = f;
                }
                if let Some(b) = def.bg {
                    bg = b;
                }
                attrs |= def.attributes;
            }
        }
    }
    (fg, bg, attrs)
}

impl OptimizedBuffer {
    fn cell_in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && (x as u32) < self.width && y >= 0 && (y as u32) < self.height
    }

    fn try_set_transparent_text_cell_fast(
        &mut self,
        index: usize,
        ch: u32,
        fg: Rgba,
        attributes: u32,
    ) -> bool {
        if alpha(fg) != 255 {
            return false;
        }
        if link_id(attributes) != 0 {
            return false;
        }
        if is_grapheme_char(ch) || is_continuation_char(ch) {
            return false;
        }
        let dest_char = self.char[index];
        let dest_attributes = self.attributes[index];
        if link_id(dest_attributes) != 0 {
            return false;
        }
        if is_grapheme_char(dest_char) || is_continuation_char(dest_char) {
            return false;
        }
        if ch == DEFAULT_SPACE_CHAR
            && dest_char != 0
            && dest_char != DEFAULT_SPACE_CHAR
            && crate::buffer::encoded_char_width(dest_char) == 1
        {
            return true;
        }
        self.char[index] = ch;
        self.fg[index] = fg;
        self.attributes[index] = attributes;
        true
    }

    pub fn draw_text_buffer_view(
        &mut self,
        pool: &mut GraphemePool,
        view: &mut TextBufferView,
        x: i32,
        y: i32,
    ) {
        let opacity = self.current_opacity();
        if opacity == 0.0 {
            return;
        }
        let Some(tb_ptr) = handles::get(view.text_buffer, Kind::TextBuffer) else {
            return;
        };
        let tb = unsafe { &mut *(tb_ptr as *mut TextBuffer) };
        view.update_virtual_lines();

        let syntax_style: Option<&SyntaxStyle> = tb
            .syntax_style
            .and_then(|h| handles::get(h, Kind::SyntaxStyle))
            .map(|p| unsafe { &*(p as *const SyntaxStyle) });

        let viewport = view.viewport;
        let all_count = view.caches_ref().starts.len();
        // getVirtualLines applies the viewport window
        let (win_start, win_end) = match viewport {
            Some(vp) => {
                let s = (vp.y as usize).min(all_count);
                (s, (s + vp.height as usize).min(all_count))
            }
            None => (0, all_count),
        };
        if win_end <= win_start {
            return;
        }
        let vline_count = win_end - win_start;

        let first_visible: usize = if y < 0 { (-y) as usize } else { 0 };
        let buffer_bottom = self.height;
        let last_possible: usize = if y >= buffer_bottom as i32 {
            0
        } else if y < 0 {
            vline_count.min(first_visible + buffer_bottom as usize)
        } else {
            vline_count.min((buffer_bottom - y as u32) as usize)
        };
        if first_visible >= vline_count || last_possible == 0 || first_visible >= last_possible {
            return;
        }

        let horizontal_offset: u32 = viewport.map_or(0, |vp| vp.x);
        let viewport_width: u32 = viewport.map_or(u32::MAX, |vp| vp.width);

        let text_defaults = (tb.default_fg, tb.default_bg, tb.default_attributes);
        let default_fg = text_defaults.0.unwrap_or(rgb_color(255, 255, 255, 255));
        let default_bg = text_defaults.1.unwrap_or(rgb_color(0, 0, 0, 0));
        let default_attributes = text_defaults.2.unwrap_or(0);

        let tab_width = tb.tab_width;
        let width_method = tb.width_method;
        let selection = view.selection;
        let tab_indicator = view.tab_indicator;
        let tab_indicator_color = view.tab_indicator_color;

        let mut current_y = y + first_visible as i32;
        for slice_idx in first_visible..last_possible {
            if current_y >= buffer_bottom as i32 {
                break;
            }
            let vline_idx = win_start + slice_idx;
            let vline = view.caches_ref().vlines[vline_idx].clone();
            let mut current_x = x;
            let mut column_in_line: u32 = 0;
            let mut global_char_pos: u32 = vline.col_offset;

            // getVirtualLineSpans: spans come from the SOURCE line
            let source_line = vline.source_line as usize;
            let line_width = tb.line_width_at(vline.source_line);
            let spans = build_line_spans(tb, source_line, line_width);
            let col_offset = vline.source_col_offset;

            let mut span_idx: usize = 0;
            let mut line_fg = default_fg;
            let mut line_bg = default_bg;
            let mut line_attributes = default_attributes;

            let start_col = col_offset + horizontal_offset;
            while span_idx < spans.len() && spans[span_idx].next_col <= start_col {
                span_idx += 1;
            }
            let mut next_change_col: u32 = if span_idx < spans.len() {
                spans[span_idx].next_col
            } else {
                u32::MAX
            };
            if span_idx < spans.len()
                && spans[span_idx].col <= start_col
                && spans[span_idx].style_id != 0
            {
                let resolved = resolve_style(
                    syntax_style,
                    spans[span_idx].style_id,
                    (line_fg, line_bg, line_attributes),
                );
                line_fg = resolved.0;
                line_bg = resolved.1;
                line_attributes = resolved.2;
            }

            for vchunk in &vline.chunks {
                let chunk = vchunk.chunk;
                let chunk_bytes = tb
                    .registry
                    .get(chunk.mem_id)
                    .map(|b| b[chunk.byte_start as usize..chunk.byte_end as usize].to_vec())
                    .unwrap_or_default();
                let is_ascii = (chunk.flags & crate::segment::FLAG_ASCII_ONLY) != 0;
                let specials = {
                    let tc = crate::segment::TextChunk::new(
                        chunk.mem_id,
                        chunk.byte_start,
                        chunk.byte_end,
                        0,
                        chunk.flags,
                    );
                    tc.graphemes(&tb.registry, tab_width, width_method)
                };

                if current_x >= self.width as i32 {
                    global_char_pos += vchunk.width;
                    current_x += vchunk.width as i32;
                    continue;
                }
                let col_end = vchunk.grapheme_start + vchunk.width;
                let mut col = vchunk.grapheme_start;
                let mut special_idx: usize = 0;
                let mut byte_offset: u32 = 0;

                if vchunk.grapheme_start > 0 {
                    let text = std::str::from_utf8(&chunk_bytes).unwrap_or("");
                    byte_offset = find_pos_by_width(
                        text,
                        vchunk.grapheme_start,
                        tab_width,
                        is_ascii,
                        false,
                        width_method,
                    )
                    .byte_offset;
                    let mut init_col: u32 = 0;
                    while init_col < vchunk.grapheme_start && special_idx < specials.len() {
                        let g = &specials[special_idx];
                        if (g.col_offset) < vchunk.grapheme_start {
                            special_idx += 1;
                            init_col = g.col_offset + g.width;
                        } else {
                            break;
                        }
                    }
                }

                while col < col_end {
                    let at_special =
                        special_idx < specials.len() && specials[special_idx].col_offset == col;
                    let (grapheme_bytes, g_width): (Vec<u8>, u32) = if at_special {
                        let g = specials[special_idx];
                        let bytes = chunk_bytes[g.byte_offset..g.byte_offset + g.byte_len].to_vec();
                        byte_offset = (g.byte_offset + g.byte_len) as u32;
                        special_idx += 1;
                        (bytes, g.width)
                    } else {
                        if byte_offset as usize >= chunk_bytes.len() {
                            break;
                        }
                        let b0 = chunk_bytes[byte_offset as usize];
                        let cp_len: u32 = if b0 < 0x80 {
                            1
                        } else if b0 & 0xE0 == 0xC0 {
                            2
                        } else if b0 & 0xF0 == 0xE0 {
                            3
                        } else if b0 & 0xF8 == 0xF0 {
                            4
                        } else {
                            1
                        };
                        let next = (byte_offset + cp_len).min(chunk_bytes.len() as u32);
                        let bytes = chunk_bytes[byte_offset as usize..next as usize].to_vec();
                        byte_offset = next;
                        (bytes, 1)
                    };

                    if column_in_line < horizontal_offset {
                        global_char_pos += g_width;
                        column_in_line += g_width;
                        col += g_width;
                        continue;
                    }
                    if column_in_line >= horizontal_offset.saturating_add(viewport_width) {
                        global_char_pos += col_end - col;
                        break;
                    }
                    if current_x < -(g_width as i32) {
                        global_char_pos += g_width;
                        current_x += g_width as i32;
                        column_in_line += g_width;
                        col += g_width;
                        continue;
                    }
                    if current_x >= self.width as i32 {
                        global_char_pos += col_end - col;
                        break;
                    }
                    if !self.point_in_scissor(current_x, current_y) {
                        global_char_pos += g_width;
                        current_x += g_width as i32;
                        column_in_line += g_width;
                        col += g_width;
                        continue;
                    }

                    let selection_offset = global_char_pos; // truncation adjustments land later
                    let source_col_pos = col_offset + column_in_line;

                    if source_col_pos >= next_change_col && span_idx + 1 < spans.len() {
                        span_idx += 1;
                        let new_span = spans[span_idx];
                        line_fg = default_fg;
                        line_bg = default_bg;
                        line_attributes = default_attributes;
                        let resolved = resolve_style(
                            syntax_style,
                            new_span.style_id,
                            (line_fg, line_bg, line_attributes),
                        );
                        line_fg = resolved.0;
                        line_bg = resolved.1;
                        line_attributes = resolved.2;
                        next_change_col = new_span.next_col;
                    }

                    let mut final_fg = line_fg;
                    let mut final_bg = line_bg;
                    let final_attributes = line_attributes;

                    if let Some(sel) = selection {
                        for cell_idx in 0..g_width {
                            let off = selection_offset + cell_idx;
                            if off >= sel.start && off < sel.end {
                                if let Some(sel_bg) = sel.bg {
                                    final_bg = sel_bg;
                                    if let Some(sel_fg) = sel.fg {
                                        final_fg = sel_fg;
                                    }
                                } else {
                                    let temp = line_fg;
                                    final_fg = if alpha(line_bg) > 0 {
                                        line_bg
                                    } else {
                                        rgb_color(0, 0, 0, 255)
                                    };
                                    final_bg = temp;
                                }
                                break;
                            }
                        }
                    }

                    if g_width == 0 {
                        continue;
                    }

                    let mut draw_fg = final_fg;
                    let mut draw_bg = final_bg;
                    let draw_attributes = final_attributes;
                    if draw_attributes & (1 << 5) != 0 {
                        std::mem::swap(&mut draw_fg, &mut draw_bg);
                    }

                    let use_fast_path = self.current_opacity() == 1.0 && alpha(draw_bg) == 0;

                    if grapheme_bytes.len() == 1 && grapheme_bytes[0] == b'\t' {
                        let mut tab_col: u32 = 0;
                        while tab_col < g_width {
                            if current_x + tab_col as i32 >= self.width as i32 {
                                break;
                            }
                            let ch = if tab_col == 0 {
                                tab_indicator.unwrap_or(DEFAULT_SPACE_CHAR)
                            } else {
                                DEFAULT_SPACE_CHAR
                            };
                            let fg = if tab_col == 0 {
                                tab_indicator_color.unwrap_or(draw_fg)
                            } else {
                                draw_fg
                            };
                            let cx_i = current_x + tab_col as i32;
                            // Off-buffer cells: the reference writes to a wrapped
                            // index in ReleaseFast (UB that never touches the
                            // visible region); we simply skip while still advancing.
                            if !self.cell_in_bounds(cx_i, current_y) {
                                tab_col += 1;
                                continue;
                            }
                            let cx = cx_i as u32;
                            let cy = current_y as u32;
                            if use_fast_path {
                                let index = (cy * self.width + cx) as usize;
                                if self.try_set_transparent_text_cell_fast(
                                    index,
                                    ch,
                                    fg,
                                    draw_attributes,
                                ) {
                                    tab_col += 1;
                                    continue;
                                }
                            }
                            self.set_cell_with_alpha_blending(
                                pool,
                                cx,
                                cy,
                                Cell {
                                    char: ch,
                                    fg,
                                    bg: draw_bg,
                                    attributes: draw_attributes,
                                },
                            );
                            tab_col += 1;
                        }
                    } else {
                        let encoded_char: u32 = if grapheme_bytes.len() == 1
                            && g_width == 1
                            && grapheme_bytes[0] >= 32
                        {
                            grapheme_bytes[0] as u32
                        } else {
                            match pool.alloc(&grapheme_bytes) {
                                Some(gid) => pack_grapheme_start(gid & GRAPHEME_ID_MASK, g_width),
                                None => {
                                    global_char_pos += g_width;
                                    current_x += g_width as i32;
                                    col += g_width;
                                    continue;
                                }
                            }
                        };
                        // A grapheme whose start cell is off-buffer (left of 0 or
                        // past the width/height) draws nothing visible — the
                        // reference's wrapped-index write in ReleaseFast lands
                        // outside the compared region. Skip the write, keep advancing.
                        if self.cell_in_bounds(current_x, current_y) {
                            let mut fast_handled = false;
                            if use_fast_path {
                                let index =
                                    (current_y as u32 * self.width + current_x as u32) as usize;
                                if self.try_set_transparent_text_cell_fast(
                                    index,
                                    encoded_char,
                                    draw_fg,
                                    draw_attributes,
                                ) {
                                    fast_handled = true;
                                }
                            }
                            if !fast_handled {
                                self.set_cell_with_alpha_blending(
                                    pool,
                                    current_x as u32,
                                    current_y as u32,
                                    Cell {
                                        char: encoded_char,
                                        fg: draw_fg,
                                        bg: draw_bg,
                                        attributes: draw_attributes,
                                    },
                                );
                            }
                        }
                    }

                    global_char_pos += g_width;
                    current_x += g_width as i32;
                    column_in_line += g_width;
                    col += g_width;
                }
            }
            current_y += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mem_registry::MemBuffer;
    use crate::text_buffer::TextBuffer;
    use crate::unicode::WidthMethod;

    fn tb_with(text: &str) -> TextBuffer {
        let mut tb = TextBuffer::new(WidthMethod::Unicode);
        tb.set_text(MemBuffer::Owned(text.as_bytes().to_vec()), text.len());
        tb
    }

    #[test]
    fn highlight_extending_past_line_end_emits_trailing_span() {
        // Highlight covers cols 3..20 on a 10-wide line. The end event at col 20
        // is processed (sweep doesn't stop at line_width), leaving active NON-EMPTY
        // at the trailing-span check. OLD CODE: skipped the trailing span because
        // active.is_empty() was false. FIX: emit with highest-priority active style.
        let mut tb = tb_with("0123456789");
        let line_width = tb.line_width_at(0);
        assert_eq!(line_width, 10);
        tb.add_highlight(
            0, 3, 20, /*style_id=*/ 7, /*priority=*/ 1, 0, false,
        );
        let spans = build_line_spans(&tb, 0, line_width);
        // Expect: default span [0..3) + styled span [3..10) (clamped to line_width)
        let cols: Vec<_> = spans
            .iter()
            .map(|s| (s.col, s.style_id, s.next_col))
            .collect();
        assert_eq!(cols, vec![(0, 0, 3), (3, 7, 10)]);
    }

    #[test]
    fn highlight_at_start_extending_past_line_end() {
        // Highlight from col 0 past the line end. Active set is non-empty after
        // the end event at col 100; trailing span must still be emitted.
        let mut tb = tb_with("hello");
        let line_width = tb.line_width_at(0);
        assert_eq!(line_width, 5);
        tb.add_highlight(
            0, 0, 100, /*style_id=*/ 3, /*priority=*/ 2, 0, false,
        );
        let spans = build_line_spans(&tb, 0, line_width);
        let cols: Vec<_> = spans
            .iter()
            .map(|s| (s.col, s.style_id, s.next_col))
            .collect();
        assert_eq!(cols, vec![(0, 3, 5)]);
    }

    #[test]
    fn two_highlights_one_extends_past_line_end() {
        // hl0: [2..6) style=1 priority=1 — ends within the line
        // hl1: [5..20) style=2 priority=2 — extends PAST the line end
        // After hl0's end event at col 6, hl1 is still active (end at col 20).
        // Trailing span [6..10) must use hl1's style (priority 2).
        let mut tb = tb_with("0123456789");
        let line_width = tb.line_width_at(0);
        tb.add_highlight(0, 2, 6, 1, 1, 0, false);
        tb.add_highlight(0, 5, 20, 2, 2, 0, false);
        let spans = build_line_spans(&tb, 0, line_width);
        let cols: Vec<_> = spans
            .iter()
            .map(|s| (s.col, s.style_id, s.next_col))
            .collect();
        // [0..2) default, [2..5) hl0 only, [5..6) hl1 wins (priority 2 > 1),
        // [6..10) hl1 only (hl0 ended at 6, hl1 still active past 20)
        assert_eq!(cols, vec![(0, 0, 2), (2, 1, 5), (5, 2, 6), (6, 2, 10)]);
    }
}
