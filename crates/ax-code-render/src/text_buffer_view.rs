//! ADR-046 Slice C5a — TextBufferView (wrap=none tranche), ported from the
//! Zig reference (`text-buffer-view.zig`, opentui v0.4.1).
//!
//! The view projects a TextBuffer into virtual lines. With wrap off (or no
//! wrap width) each logical line maps to exactly one virtual line whose
//! col_offset accumulates in WEIGHT space (each break counts one unit —
//! walkLinesAndSegments semantics, NOT the cumulative-column space that
//! highlights use; found by differential fuzz). char/word wrapping and
//! drawing land in later tranches.

use crate::buffer::Rgba;
use crate::handles::{self, Kind};
use crate::segment::WrapMode;
use crate::text_buffer::TextBuffer;

#[derive(Clone, Copy)]
pub struct Viewport {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy)]
pub struct ChunkRef {
    pub mem_id: u8,
    pub byte_start: u32,
    pub byte_end: u32,
    pub flags: u8,
}

#[derive(Clone, Copy)]
pub struct VirtualChunk {
    pub grapheme_start: u32, // column offset into the source chunk
    pub width: u32,
    pub chunk: ChunkRef,
}

#[derive(Clone, Default)]
pub struct VirtualLine {
    pub chunks: Vec<VirtualChunk>,
    pub width_cols: u32,
    pub col_offset: u32,
    pub source_line: u32,
    pub source_col_offset: u32,
}

#[derive(Default)]
pub struct VirtualLineCaches {
    pub vlines: Vec<VirtualLine>,
    pub starts: Vec<u32>,
    pub widths: Vec<u32>,
    pub sources: Vec<u32>,
    pub wrap_indices: Vec<u32>,
    pub first_vline: Vec<u32>,
    pub vline_counts: Vec<u32>,
}

#[derive(Clone, Copy)]
pub struct Selection {
    pub start: u32,
    pub end: u32,
    pub bg: Option<Rgba>,
    pub fg: Option<Rgba>,
}

pub struct TextBufferView {
    pub text_buffer: u32, // handle
    pub selection: Option<Selection>,
    selection_anchor_offset: Option<u32>,
    pub viewport: Option<Viewport>,
    pub wrap_width: Option<u32>,
    pub wrap_mode: WrapMode,
    pub first_line_offset: u32,
    pub tab_indicator: Option<u32>,
    pub tab_indicator_color: Option<Rgba>,
    pub truncate: bool,
    dirty: bool,
    /// Content epoch of the text buffer the caches were built against
    /// (`TextBuffer::content_epoch`). `None` = never built.
    seen_epoch: Option<(u64, u64)>,
    caches: VirtualLineCaches,
    // Slices exposed through GetLineInfoDirect must stay alive between calls.
    info_starts: Vec<u32>,
    info_widths: Vec<u32>,
    info_sources: Vec<u32>,
    info_wraps: Vec<u32>,
}

fn resolve_tb(handle: u32) -> Option<&'static mut TextBuffer> {
    handles::get(handle, Kind::TextBuffer).map(|ptr| unsafe { &mut *(ptr as *mut TextBuffer) })
}

impl TextBufferView {
    pub fn new(text_buffer: u32) -> TextBufferView {
        TextBufferView {
            text_buffer,
            selection: None,
            selection_anchor_offset: None,
            viewport: None,
            wrap_width: None,
            wrap_mode: WrapMode::None,
            first_line_offset: 0,
            tab_indicator: None,
            tab_indicator_color: None,
            truncate: false,
            dirty: true,
            seen_epoch: None,
            caches: VirtualLineCaches::default(),
            info_starts: Vec::new(),
            info_widths: Vec::new(),
            info_sources: Vec::new(),
            info_wraps: Vec::new(),
        }
    }

    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    pub fn set_wrap_width(&mut self, width: Option<u32>) {
        if self.wrap_width != width {
            self.wrap_width = width;
            self.dirty = true;
        }
    }

    pub fn set_wrap_mode(&mut self, mode: WrapMode) {
        if self.wrap_mode != mode {
            self.wrap_mode = mode;
            self.dirty = true;
        }
    }

    pub fn set_first_line_offset(&mut self, offset: u32) {
        if self.first_line_offset != offset {
            self.first_line_offset = offset;
            self.dirty = true;
        }
    }

    /// Zig `setViewport`: setting a viewport CLOBBERS wrap_width with the
    /// viewport width (found by differential draw fuzz — a wrap width set
    /// before a viewport is silently overridden).
    pub fn set_viewport(&mut self, vp: Option<Viewport>) {
        self.viewport = vp;
        if let Some(viewport) = vp {
            if self.wrap_width != Some(viewport.width) {
                self.wrap_width = Some(viewport.width);
                self.dirty = true;
            }
        }
    }

    pub fn set_viewport_size(&mut self, width: u32, height: u32) {
        let (x, y) = self.viewport.map_or((0, 0), |vp| (vp.x, vp.y));
        self.set_viewport(Some(Viewport {
            x,
            y,
            width,
            height,
        }));
    }

    pub fn get_viewport(&self) -> Option<Viewport> {
        self.viewport
    }

    /// Zig `measureForDimensions` — (line_count, width_cols_max) laid out for
    /// `width`. No-wrap / width 0 uses logical line widths; wrap modes count
    /// virtual lines at `width` without permanently disturbing the view (the
    /// caches are rebuilt on the next real access).
    pub fn measure_for_dimensions(&mut self, width: u32, _height: u32) -> (u32, u32) {
        if width == 0 || self.wrap_mode == WrapMode::None {
            let Some(tb) = resolve_tb(self.text_buffer) else {
                return (0, 0);
            };
            let line_count = tb.get_line_count();
            let mut max = 0u32;
            for row in 0..line_count {
                max = max.max(tb.line_width_at(row));
            }
            return (line_count, max);
        }
        let saved_wrap = self.wrap_width;
        self.wrap_width = Some(width);
        self.dirty = true;
        self.update_virtual_lines();
        let line_count = self.caches.vlines.len() as u32;
        let max = self
            .caches
            .vlines
            .iter()
            .map(|v| v.width_cols)
            .max()
            .unwrap_or(0);
        self.wrap_width = saved_wrap;
        self.dirty = true;
        (line_count, max)
    }

    pub fn selection_anchor(&self) -> Option<u32> {
        self.selection_anchor_offset
    }

    /// Set the underlying text buffer handle (editor-view placeholder swap).
    pub fn set_text_buffer_handle(&mut self, handle: u32) {
        if self.text_buffer != handle {
            self.text_buffer = handle;
            self.dirty = true;
        }
    }

    pub fn text_buffer_handle(&self) -> u32 {
        self.text_buffer
    }

    /// Rebuild virtual lines and expose them (Zig `virtual_lines.items`).
    pub fn virtual_lines(&mut self) -> &[VirtualLine] {
        self.update_virtual_lines();
        &self.caches.vlines
    }

    /// Zig `findVisualLineIndex` — the virtual-line index containing
    /// (logical_row, logical_col), honoring wrap boundaries.
    pub fn find_visual_line_index(&mut self, logical_row: u32, logical_col: u32) -> u32 {
        self.update_virtual_lines();
        let vlines_len = self.caches.vlines.len() as u32;
        if vlines_len == 0 {
            return 0;
        }
        let first = &self.caches.first_vline;
        let counts = &self.caches.vline_counts;
        if first.is_empty() {
            return 0;
        }
        let clamped_row = if logical_row >= first.len() as u32 {
            first.len() as u32 - 1
        } else {
            logical_row
        };
        let first_vline_idx = first[clamped_row as usize];
        let vline_count = counts[clamped_row as usize];
        if vline_count == 0 {
            return first_vline_idx;
        }
        for i in 0..vline_count {
            let vline_idx = first_vline_idx + i;
            if vline_idx >= vlines_len {
                break;
            }
            let vline = &self.caches.vlines[vline_idx as usize];
            let start_col = vline.source_col_offset;
            let end_col = start_col + vline.width_cols;
            let is_last = i == vline_count - 1;
            let end_check = if is_last {
                logical_col <= end_col
            } else {
                logical_col < end_col
            };
            if logical_col >= start_col && end_check {
                return vline_idx;
            }
        }
        let last = first_vline_idx + vline_count - 1;
        if last < vlines_len { last } else { 0 }
    }

    /// Zig `updateVirtualLines`. Rebuilds only when the view's own settings
    /// changed (`dirty`) or the underlying buffer's content epoch moved —
    /// callers hit this on every draw/measure/selection query, and streaming
    /// output makes both the call rate and the line count grow together, so
    /// an unconditional rebuild degrades quadratically over a session.
    pub fn update_virtual_lines(&mut self) {
        let Some(tb) = resolve_tb(self.text_buffer) else {
            return;
        };
        let epoch = tb.content_epoch();
        if !self.dirty && self.seen_epoch == Some(epoch) {
            return;
        }
        self.caches = VirtualLineCaches::default();
        if self.wrap_mode == WrapMode::None || self.wrap_width.is_none() {
            let line_count = tb.get_line_count();
            let all_chunks = tb.all_line_chunks();
            let mut col_offset: u32 = 0;
            for row in 0..line_count {
                let idx = self.caches.starts.len() as u32;
                self.caches.first_vline.push(idx);
                self.caches.vline_counts.push(1);
                let mut vline = VirtualLine {
                    width_cols: 0,
                    col_offset,
                    source_line: row,
                    source_col_offset: 0,
                    chunks: Vec::new(),
                };
                let mut width: u32 = 0;
                if let Some(chunks) = all_chunks.get(row as usize) {
                    for (chunk_ref, chunk_width) in chunks {
                        width += chunk_width;
                        vline.chunks.push(VirtualChunk {
                            grapheme_start: 0,
                            width: *chunk_width,
                            chunk: *chunk_ref,
                        });
                    }
                }
                vline.width_cols = width;
                self.caches.starts.push(col_offset);
                self.caches.widths.push(width);
                self.caches.sources.push(row);
                self.caches.wrap_indices.push(0);
                self.caches.vlines.push(vline);
                col_offset += width + 1; // weight space: the break costs 1
            }
        } else {
            self.wrap_virtual_lines(tb);
        }
        self.dirty = false;
        self.seen_epoch = Some(epoch);
    }

    /// Faithful port of the Zig wrap engine (WrapContext): word mode backtracks
    /// to the last recorded wrap opportunity (possibly splitting a virtual
    /// chunk); char mode fits whole clusters per line with force-splits for
    /// oversize clusters at column 0.
    fn wrap_virtual_lines(&mut self, tb: &mut TextBuffer) {
        struct Wctx {
            out: VirtualLineCaches,
            wrap_w: u32,
            first_line_offset: u32,
            first_line_pending: bool,
            global_char_offset: u32,
            line_idx: u32,
            line_col_offset: u32,
            line_position: u32,
            current: VirtualLine,
            current_line_first_vline_idx: u32,
            current_line_vline_count: u32,
            last_wrap_chunk_count: u32,
            last_wrap_line_position: u32,
            last_wrap_global_offset: u32,
        }
        impl Wctx {
            fn line_wrap_width(&self) -> u32 {
                if !self.first_line_pending
                    || self.first_line_offset == 0
                    || self.first_line_offset >= self.wrap_w
                {
                    self.wrap_w
                } else {
                    self.wrap_w - self.first_line_offset
                }
            }
            fn commit(&mut self) {
                self.current.width_cols = self.line_position;
                self.current.source_line = self.line_idx;
                self.current.source_col_offset = self.line_col_offset;
                let v = std::mem::take(&mut self.current);
                self.out.starts.push(v.col_offset);
                self.out.widths.push(v.width_cols);
                self.out.sources.push(self.line_idx);
                self.out.wrap_indices.push(self.current_line_vline_count);
                self.out.vlines.push(v);
                self.current_line_vline_count += 1;
                self.line_col_offset += self.line_position;
                self.current = VirtualLine {
                    col_offset: self.global_char_offset,
                    ..Default::default()
                };
                self.line_position = 0;
                self.first_line_pending = false;
                self.last_wrap_chunk_count = 0;
                self.last_wrap_line_position = 0;
                self.last_wrap_global_offset = 0;
            }
            fn add_chunk(&mut self, chunk: ChunkRef, start: u32, width: u32) {
                self.current.chunks.push(VirtualChunk {
                    grapheme_start: start,
                    width,
                    chunk,
                });
                self.global_char_offset += width;
                self.line_position += width;
            }
        }
        let wrap_w = self.wrap_width.unwrap_or(0);
        let mut w = Wctx {
            out: VirtualLineCaches::default(),
            wrap_w,
            first_line_offset: self.first_line_offset,
            first_line_pending: self.first_line_offset > 0,
            global_char_offset: 0,
            line_idx: 0,
            line_col_offset: 0,
            line_position: 0,
            current: VirtualLine::default(),
            current_line_first_vline_idx: 0,
            current_line_vline_count: 0,
            last_wrap_chunk_count: 0,
            last_wrap_line_position: 0,
            last_wrap_global_offset: 0,
        };
        let tab_width = tb.tab_width;
        let method = tb.width_method;
        let is_word = self.wrap_mode == WrapMode::Word;
        let line_count = tb.get_line_count();
        // One rope walk for every row's working set — the per-row
        // line_chunks_full(row) variant re-walks the rope from the start each
        // call, which is O(lines²) across this loop.
        let all_chunks = tb.all_line_chunks_full();
        for row in 0..line_count {
            let chunks: &[_] = all_chunks.get(row as usize).map_or(&[], |v| v.as_slice());
            for (chunk_ref, chunk_width, bytes, graphemes, wrap_offsets) in chunks {
                let chunk_bytes: &[u8] = bytes;
                let is_ascii = (chunk_ref.flags & crate::segment::FLAG_ASCII_ONLY) != 0;
                if is_word {
                    let mut grapheme_idx: usize = 0;
                    let mut col_delta: i64 = 0;
                    let mut char_offset: u32 = 0;
                    let mut byte_offset: u32 = 0;
                    let mut wrap_idx: usize = 0;
                    while char_offset < *chunk_width {
                        let line_wrap_w = w.line_wrap_width();
                        let remaining_in_chunk = *chunk_width - char_offset;
                        let remaining_on_line = line_wrap_w.saturating_sub(w.line_position);
                        let mut last_wrap_that_fits: Option<u32> = None;
                        let mut saved_wrap_idx = wrap_idx;
                        while wrap_idx < wrap_offsets.len() {
                            let wb = wrap_offsets[wrap_idx];
                            let (break_col, break_width) = crate::unicode::char_offset_to_column(
                                wb.char_offset,
                                graphemes,
                                &mut grapheme_idx,
                                &mut col_delta,
                            );
                            if break_col < char_offset {
                                wrap_idx += 1;
                                continue;
                            }
                            let width_to_boundary = break_col - char_offset + break_width;
                            if width_to_boundary > remaining_on_line
                                || width_to_boundary > remaining_in_chunk
                            {
                                break;
                            }
                            last_wrap_that_fits = Some(width_to_boundary);
                            saved_wrap_idx = wrap_idx + 1;
                            wrap_idx += 1;
                        }
                        wrap_idx = saved_wrap_idx;
                        let mut to_add: u32;
                        let mut has_wrap_after = false;
                        if remaining_in_chunk <= remaining_on_line {
                            if let Some(boundary_w) = last_wrap_that_fits {
                                let would_fill =
                                    w.line_position + remaining_in_chunk >= line_wrap_w;
                                if would_fill && boundary_w < remaining_in_chunk {
                                    to_add = boundary_w;
                                } else {
                                    to_add = remaining_in_chunk;
                                }
                                has_wrap_after = true;
                            } else {
                                to_add = remaining_in_chunk;
                            }
                        } else if let Some(boundary_w) = last_wrap_that_fits {
                            to_add = boundary_w;
                            has_wrap_after = true;
                        } else if w.line_position == 0 {
                            let remaining = &chunk_bytes[byte_offset as usize..];
                            let r = crate::unicode::find_wrap_pos_by_width(
                                remaining,
                                remaining_on_line,
                                tab_width,
                                is_ascii,
                                method,
                            );
                            to_add = r.columns_used;
                            byte_offset += r.byte_offset;
                            if to_add == 0 {
                                to_add = 1;
                                let single = crate::unicode::find_wrap_pos_by_width(
                                    remaining, 1, tab_width, is_ascii, method,
                                );
                                byte_offset += single.byte_offset;
                            }
                        } else if w.last_wrap_chunk_count > 0
                            && w.last_wrap_chunk_count as usize <= w.current.chunks.len()
                        {
                            // backtrack: move everything after the last wrap point to a new line
                            let lw_count = w.last_wrap_chunk_count as usize;
                            let mut accumulated: u32 =
                                w.current.chunks[..lw_count].iter().map(|c| c.width).sum();
                            let mut saved: Vec<VirtualChunk> = Vec::new();
                            if accumulated > w.last_wrap_line_position {
                                let last = w.current.chunks[lw_count - 1];
                                let overhang = accumulated - w.last_wrap_line_position;
                                saved.push(VirtualChunk {
                                    grapheme_start: last.grapheme_start + last.width - overhang,
                                    width: overhang,
                                    chunk: last.chunk,
                                });
                                w.current.chunks[lw_count - 1].width -= overhang;
                                accumulated -= overhang;
                            }
                            let _ = accumulated;
                            saved.extend_from_slice(&w.current.chunks[lw_count..]);
                            w.line_position = w.last_wrap_line_position;
                            w.global_char_offset = w.last_wrap_global_offset;
                            w.current.chunks.truncate(lw_count);
                            w.commit();
                            for vc in saved {
                                w.current.chunks.push(vc);
                                w.global_char_offset += vc.width;
                                w.line_position += vc.width;
                            }
                            continue;
                        } else {
                            w.commit();
                            if char_offset > 0 {
                                let pr = crate::unicode::find_pos_by_width(
                                    std::str::from_utf8(chunk_bytes).unwrap_or(""),
                                    char_offset,
                                    tab_width,
                                    is_ascii,
                                    false,
                                    method,
                                );
                                byte_offset = pr.byte_offset;
                            }
                            let remaining = &chunk_bytes[byte_offset as usize..];
                            let r = crate::unicode::find_wrap_pos_by_width(
                                remaining,
                                w.line_wrap_width(),
                                tab_width,
                                is_ascii,
                                method,
                            );
                            to_add = r.columns_used;
                            byte_offset += r.byte_offset;
                            if to_add == 0 {
                                to_add = 1;
                                let single = crate::unicode::find_wrap_pos_by_width(
                                    remaining, 1, tab_width, is_ascii, method,
                                );
                                byte_offset += single.byte_offset;
                            }
                        }
                        if to_add > 0 {
                            let position_before = w.line_position;
                            let offset_before = w.global_char_offset;
                            w.add_chunk(*chunk_ref, char_offset, to_add);
                            char_offset += to_add;
                            if has_wrap_after {
                                let wrap_pos_in_added =
                                    last_wrap_that_fits.map_or(to_add, |b| b.min(to_add));
                                w.last_wrap_chunk_count = w.current.chunks.len() as u32;
                                w.last_wrap_line_position = position_before + wrap_pos_in_added;
                                w.last_wrap_global_offset = offset_before + wrap_pos_in_added;
                            }
                            if w.line_position >= line_wrap_w
                                && char_offset < *chunk_width
                                && (has_wrap_after || w.last_wrap_chunk_count > 0)
                            {
                                w.commit();
                            }
                        }
                    }
                } else {
                    // char wrap
                    let mut byte_offset: usize = 0;
                    let mut char_offset: u32 = 0;
                    while char_offset < *chunk_width {
                        let line_wrap_w = w.line_wrap_width();
                        let remaining_width = line_wrap_w.saturating_sub(w.line_position);
                        if remaining_width == 0 {
                            if w.line_position > 0 {
                                w.commit();
                                continue;
                            }
                            let remaining = &chunk_bytes[byte_offset..];
                            let force = crate::unicode::find_wrap_pos_by_width(
                                remaining, 1, tab_width, is_ascii, method,
                            );
                            if force.grapheme_count > 0 {
                                w.add_chunk(*chunk_ref, char_offset, force.columns_used);
                                char_offset += force.columns_used;
                                byte_offset += force.byte_offset as usize;
                            } else {
                                break;
                            }
                            continue;
                        }
                        let remaining = &chunk_bytes[byte_offset..];
                        let r = crate::unicode::find_wrap_pos_by_width(
                            remaining,
                            remaining_width,
                            tab_width,
                            is_ascii,
                            method,
                        );
                        if r.grapheme_count == 0 {
                            if w.line_position > 0 {
                                w.commit();
                                continue;
                            }
                            let force = crate::unicode::find_wrap_pos_by_width(
                                remaining, 1000, tab_width, is_ascii, method,
                            );
                            if force.grapheme_count > 0 {
                                w.add_chunk(*chunk_ref, char_offset, force.columns_used);
                                char_offset += force.columns_used;
                                if char_offset < *chunk_width {
                                    w.commit();
                                }
                            }
                            break;
                        }
                        w.add_chunk(*chunk_ref, char_offset, r.columns_used);
                        char_offset += r.columns_used;
                        byte_offset += r.byte_offset as usize;
                        if w.line_position >= line_wrap_w && char_offset < *chunk_width {
                            w.commit();
                        }
                    }
                }
            }
            // line end
            let line_width = tb.line_width_at(row);
            if !w.current.chunks.is_empty() || line_width == 0 {
                w.current.width_cols = w.line_position;
                w.current.source_line = w.line_idx;
                w.current.source_col_offset = w.line_col_offset;
                let v = std::mem::take(&mut w.current);
                w.out.starts.push(v.col_offset);
                w.out.widths.push(v.width_cols);
                w.out.sources.push(w.line_idx);
                w.out.wrap_indices.push(w.current_line_vline_count);
                w.out.vlines.push(v);
                w.current_line_vline_count += 1;
            }
            w.out.first_vline.push(w.current_line_first_vline_idx);
            w.out.vline_counts.push(w.current_line_vline_count);
            w.global_char_offset += 1;
            w.line_idx += 1;
            w.line_col_offset = 0;
            w.line_position = 0;
            w.first_line_pending = false;
            w.current = VirtualLine {
                col_offset: w.global_char_offset,
                ..Default::default()
            };
            w.last_wrap_chunk_count = 0;
            w.last_wrap_line_position = 0;
            w.last_wrap_global_offset = 0;
            w.current_line_first_vline_idx = w.out.vlines.len() as u32;
            w.current_line_vline_count = 0;
        }
        self.caches = w.out;
    }

    pub fn virtual_line_count(&mut self) -> u32 {
        self.update_virtual_lines();
        self.caches.starts.len() as u32
    }

    /// Zig `getCachedLineInfo`: viewport-windowed slices of the caches plus
    /// the max width within the window. Refreshes the stable info buffers
    /// whose pointers GetLineInfoDirect hands out.
    pub fn refresh_line_info(&mut self) -> u32 {
        self.update_virtual_lines();
        let total = self.caches.starts.len();
        let (start, end) = match self.viewport {
            Some(vp) => {
                let s = (vp.y as usize).min(total);
                (s, (s + vp.height as usize).min(total))
            }
            None => (0, total),
        };
        self.info_starts = self.caches.starts[start..end].to_vec();
        self.info_widths = self.caches.widths[start..end].to_vec();
        self.info_sources = self.caches.sources[start..end].to_vec();
        self.info_wraps = self.caches.wrap_indices[start..end].to_vec();
        // Oracle-measured: the shipped binary reports width_cols_max = 0 from
        // GetLineInfoDirect regardless of viewport (the max lives in
        // measureForDimensions instead).
        0
    }

    pub fn caches_ref(&self) -> &VirtualLineCaches {
        &self.caches
    }

    pub fn info_slices(&self) -> (&[u32], &[u32], &[u32], &[u32]) {
        (
            &self.info_starts,
            &self.info_widths,
            &self.info_sources,
            &self.info_wraps,
        )
    }

    pub fn plain_text(&self) -> Vec<u8> {
        resolve_tb(self.text_buffer).map_or_else(Vec::new, |tb| tb.plain_text())
    }

    // --- selection (C5b) --------------------------------------------------------

    pub fn set_selection(&mut self, start: u32, end: u32, bg: Option<Rgba>, fg: Option<Rgba>) {
        self.selection = Some(Selection { start, end, bg, fg });
    }

    pub fn update_selection(&mut self, end: u32, bg: Option<Rgba>, fg: Option<Rgba>) {
        if let Some(sel) = self.selection {
            self.selection = Some(Selection {
                start: sel.start,
                end,
                bg,
                fg,
            });
        }
    }

    pub fn reset_selection(&mut self) {
        self.selection = None;
    }

    /// Zig `packSelectionInfo`: (start << 32) | end, all-ones when empty.
    pub fn pack_selection_info(&self) -> u64 {
        match self.selection {
            Some(sel) if sel.start != sel.end => ((sel.start as u64) << 32) | sel.end as u64,
            _ => u64::MAX,
        }
    }

    pub fn selected_text(&mut self, max_len: usize) -> Vec<u8> {
        let Some(sel) = self.selection else {
            return Vec::new();
        };
        if sel.start == sel.end {
            return Vec::new();
        }
        resolve_tb(self.text_buffer).map_or_else(Vec::new, |tb| {
            tb.get_text_range(sel.start, sel.end, max_len)
        })
    }

    fn text_end_offset(&mut self) -> u32 {
        self.update_virtual_lines();
        let n = self.caches.starts.len();
        if n == 0 {
            return 0;
        }
        self.caches.starts[n - 1] + self.caches.widths[n - 1]
    }

    /// Zig `coordsToCharOffset`: local (x, y) through the viewport into a
    /// weight offset, clamped to the virtual line grid.
    fn coords_to_char_offset(&mut self, x: i32, y: i32) -> Option<u32> {
        self.update_virtual_lines();
        let (y_off, x_off) = match self.viewport {
            Some(vp) => (
                vp.y as i32,
                if self.wrap_mode == WrapMode::None {
                    vp.x as i32
                } else {
                    0
                },
            ),
            None => (0, 0),
        };
        let n = self.caches.starts.len();
        if n == 0 {
            return Some(0);
        }
        let abs_y = y + y_off;
        let abs_x = x + x_off;
        let clamped_y = abs_y.clamp(0, n as i32 - 1) as usize;
        let line_start = self.caches.starts[clamped_y];
        let line_width = self.caches.widths[clamped_y] as i32;
        let local_x = abs_x.clamp(0, line_width);
        Some(line_start + local_x as u32)
    }

    /// Zig `setLocalSelectionStyle` (truncation paths land in C5c).
    pub fn set_local_selection(
        &mut self,
        anchor_x: i32,
        anchor_y: i32,
        focus_x: i32,
        focus_y: i32,
        bg: Option<Rgba>,
        fg: Option<Rgba>,
    ) -> bool {
        self.update_virtual_lines();
        let max_y = self.caches.starts.len() as i32 - 1;
        let anchor_above = anchor_y < 0;
        let focus_above = focus_y < 0;
        let anchor_below = anchor_y > max_y;
        let focus_below = focus_y > max_y;
        if (anchor_above && focus_above) || (anchor_below && focus_below) {
            let had = self.selection.is_some();
            self.selection = None;
            self.selection_anchor_offset = None;
            return had;
        }
        let end_offset = self.text_end_offset();
        let anchor_offset = if anchor_above || anchor_x < 0 {
            0
        } else if anchor_below {
            end_offset
        } else {
            match self.coords_to_char_offset(anchor_x, anchor_y) {
                Some(v) => v,
                None => {
                    let had = self.selection.is_some();
                    self.selection = None;
                    self.selection_anchor_offset = None;
                    return had;
                }
            }
        };
        let focus_offset = if focus_above || focus_x < 0 {
            0
        } else if focus_below {
            end_offset
        } else {
            match self.coords_to_char_offset(focus_x, focus_y) {
                Some(v) => v,
                None => {
                    let had = self.selection.is_some();
                    self.selection = None;
                    self.selection_anchor_offset = None;
                    return had;
                }
            }
        };
        self.selection_anchor_offset = Some(anchor_offset);
        let new_start = anchor_offset.min(focus_offset);
        let new_end = anchor_offset.max(focus_offset);
        let changed = match self.selection {
            Some(old) => old.start != new_start || old.end != new_end,
            None => true,
        };
        self.selection = Some(Selection {
            start: new_start,
            end: new_end,
            bg,
            fg,
        });
        changed
    }

    /// Zig `updateLocalSelectionStyle`: with an anchor pinned, only the focus
    /// moves; otherwise identical to setLocalSelection.
    pub fn update_local_selection(
        &mut self,
        anchor_x: i32,
        anchor_y: i32,
        focus_x: i32,
        focus_y: i32,
        bg: Option<Rgba>,
        fg: Option<Rgba>,
    ) -> bool {
        let Some(anchor_offset) = self.selection_anchor_offset else {
            return self.set_local_selection(anchor_x, anchor_y, focus_x, focus_y, bg, fg);
        };
        self.update_virtual_lines();
        let max_y = self.caches.starts.len() as i32 - 1;
        let end_offset = self.text_end_offset();
        let focus_offset = if focus_y < 0 || focus_x < 0 {
            0
        } else if focus_y > max_y {
            end_offset
        } else {
            match self.coords_to_char_offset(focus_x, focus_y) {
                Some(v) => v,
                None => return false,
            }
        };
        let new_start = anchor_offset.min(focus_offset);
        let new_end = anchor_offset.max(focus_offset);
        let changed = match self.selection {
            Some(old) => old.start != new_start || old.end != new_end,
            None => true,
        };
        self.selection = Some(Selection {
            start: new_start,
            end: new_end,
            bg,
            fg,
        });
        changed
    }

    pub fn reset_local_selection(&mut self) {
        self.selection = None;
        self.selection_anchor_offset = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handles;
    use crate::mem_registry::MemBuffer;
    use crate::unicode::WidthMethod;

    fn tb_handle_with(text: &str) -> (u32, *mut TextBuffer) {
        let mut tb = Box::new(TextBuffer::new(WidthMethod::Unicode));
        tb.set_text(MemBuffer::Owned(text.as_bytes().to_vec()), text.len());
        let ptr = Box::into_raw(tb);
        let handle = handles::insert(Kind::TextBuffer, ptr as usize);
        assert_ne!(handle, 0);
        (handle, ptr)
    }

    fn destroy_tb(handle: u32) {
        if let Some(ptr) = handles::remove(handle, Kind::TextBuffer) {
            drop(unsafe { Box::from_raw(ptr as *mut TextBuffer) });
        }
    }

    #[test]
    fn virtual_lines_refresh_when_buffer_content_changes() {
        let (handle, ptr) = tb_handle_with("one\ntwo");
        let mut view = TextBufferView::new(handle);
        assert_eq!(view.virtual_lines().len(), 2);
        // Mutate the buffer WITHOUT touching the view: the epoch gate must
        // notice the rope change and rebuild instead of serving stale caches.
        let tb = unsafe { &mut *ptr };
        tb.append(MemBuffer::Owned(b"\nthree".to_vec()), 6);
        assert_eq!(view.virtual_lines().len(), 3);
        // And with NO change, cached results are reused but stay correct.
        assert_eq!(view.virtual_lines().len(), 3);
        destroy_tb(handle);
    }

    #[test]
    fn virtual_lines_match_per_row_walk_with_cjk() {
        let text = "中文宽度 test\n🚀 emoji line\nplain ascii\n第二行中文字";
        let (handle, ptr) = tb_handle_with(text);
        let mut view = TextBufferView::new(handle);
        let tb = unsafe { &mut *ptr };
        let line_count = tb.get_line_count();
        let vlines = view.virtual_lines().to_vec();
        assert_eq!(vlines.len(), line_count as usize);
        for row in 0..line_count {
            // Batched single-walk collection must agree with the original
            // per-row rope walks (width and chunk refs).
            assert_eq!(vlines[row as usize].width_cols, tb.line_width_at(row));
            let per_row = tb.line_chunks(row);
            let batched = &vlines[row as usize].chunks;
            assert_eq!(batched.len(), per_row.len());
            for (vc, (chunk_ref, width)) in batched.iter().zip(per_row.iter()) {
                assert_eq!(vc.width, *width);
                assert_eq!(vc.chunk.byte_start, chunk_ref.byte_start);
                assert_eq!(vc.chunk.byte_end, chunk_ref.byte_end);
            }
        }
        destroy_tb(handle);
    }

    #[test]
    fn wrapped_virtual_lines_refresh_on_append() {
        let (handle, ptr) = tb_handle_with("中文宽度中文宽度中文宽度");
        let mut view = TextBufferView::new(handle);
        view.set_wrap_mode(WrapMode::Char);
        view.set_wrap_width(Some(8));
        let before = view.virtual_lines().len();
        assert!(before >= 3, "24 columns of CJK at wrap 8: got {before}");
        let tb = unsafe { &mut *ptr };
        tb.append(MemBuffer::Owned("中文宽度".as_bytes().to_vec()), 12);
        let after = view.virtual_lines().len();
        assert!(after > before, "append must invalidate wrapped caches");
        destroy_tb(handle);
    }

    #[test]
    fn shrinking_mem_buffer_does_not_panic() {
        // replaceMemBuffer can hand chunks a shorter backing buffer; reads must
        // clamp instead of panicking (this previously sliced out of range).
        let (handle, ptr) = tb_handle_with("hello wide 中文 world");
        let tb = unsafe { &mut *ptr };
        let mem_id = 0u8; // set_text registers the first slot
        assert!(tb.registry.replace(mem_id, MemBuffer::Owned(b"hi".to_vec())));
        tb.mark_content_changed();
        let mut view = TextBufferView::new(handle);
        let _ = view.virtual_lines().len();
        let plain = tb.plain_text();
        assert!(plain.len() <= 2, "clamped reads: got {:?}", plain);
        destroy_tb(handle);
    }
}
