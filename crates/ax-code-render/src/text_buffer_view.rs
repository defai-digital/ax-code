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

#[derive(Default)]
pub struct VirtualLineCaches {
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
    dirty: bool,
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
            dirty: true,
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

    pub fn set_viewport(&mut self, vp: Option<Viewport>) {
        self.viewport = vp;
    }

    pub fn set_viewport_size(&mut self, width: u32, height: u32) {
        let (x, y) = self.viewport.map_or((0, 0), |vp| (vp.x, vp.y));
        self.viewport = Some(Viewport {
            x,
            y,
            width,
            height,
        });
        self.dirty = true;
    }

    /// Zig `updateVirtualLines`. NOTE: the view has no cheap content-epoch
    /// signal yet (registerView/isViewDirty land with the production flip),
    /// so it recomputes whenever any dependency may have changed — same
    /// observable results, more work. Only wrap=none/no-width is implemented
    /// in this tranche.
    pub fn update_virtual_lines(&mut self) {
        let Some(tb) = resolve_tb(self.text_buffer) else {
            return;
        };
        self.caches = VirtualLineCaches::default();
        if self.wrap_mode == WrapMode::None || self.wrap_width.is_none() {
            let line_count = tb.get_line_count();
            let mut col_offset: u32 = 0;
            for row in 0..line_count {
                let width = tb.line_width_at(row);
                let idx = self.caches.starts.len() as u32;
                self.caches.first_vline.push(idx);
                self.caches.vline_counts.push(1);
                self.caches.starts.push(col_offset);
                self.caches.widths.push(width);
                self.caches.sources.push(row);
                self.caches.wrap_indices.push(0);
                col_offset += width + 1; // weight space: the break costs 1
            }
        }
        // char/word wrap: later tranche
        self.dirty = false;
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
