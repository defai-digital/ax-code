//! ADR-046 Slice E — editor view (editor-view.zig).
//!
//! The view layer over an EditBuffer: owns a TextBufferView over the edit
//! buffer's text buffer, tracks the viewport with scroll margins, and provides
//! wrapping-aware visual cursor translation / movement and selection. The Zig
//! reference wires a `cursorChanged` event from the EditBuffer; this port polls
//! instead — `update_before_render` reconciles (resets desired_visual_col on an
//! external cursor change) at read/draw time, which matches the observable
//! behavior for edit→read and move sequences.

use crate::edit_buffer::{Cursor, EditBuffer};
use crate::handles::{self, Kind};
use crate::segment::WrapMode;
use crate::text_buffer_view::{TextBufferView, Viewport};

/// Absolute (document) visual coordinates for a logical position.
#[derive(Clone, Copy)]
pub struct VisualCursor {
    pub visual_row: u32,
    pub visual_col: u32,
    pub logical_row: u32,
    pub logical_col: u32,
    pub offset: u32,
}

pub struct EditorView {
    view: Box<TextBufferView>,
    view_handle: u32,
    edit_handle: u32,
    scroll_margin: f32,
    desired_visual_col: Option<u32>,
    selection_follow_cursor: bool,
    last_cursor: Option<(u32, u32)>,
    #[allow(dead_code)]
    tb_handle: u32,
}

fn eb_of(handle: u32) -> Option<&'static mut EditBuffer> {
    handles::get(handle, Kind::EditBuffer).map(|ptr| unsafe { &mut *(ptr as *mut EditBuffer) })
}

impl EditorView {
    pub fn create(
        edit_handle: u32,
        viewport_width: u32,
        viewport_height: u32,
    ) -> Option<Box<EditorView>> {
        let eb = eb_of(edit_handle)?;
        let tb_handle = eb.tb_handle;
        let mut view = Box::new(TextBufferView::new(tb_handle));
        view.set_viewport(Some(Viewport {
            x: 0,
            y: 0,
            width: viewport_width,
            height: viewport_height,
        }));
        let view_handle = handles::insert(Kind::TextBufferView, &*view as *const _ as usize);
        if view_handle == 0 {
            return None;
        }
        Some(Box::new(EditorView {
            view,
            view_handle,
            edit_handle,
            scroll_margin: 0.15,
            desired_visual_col: None,
            selection_follow_cursor: false,
            last_cursor: None,
            tb_handle,
        }))
    }

    pub fn invalidate_handles(&self) {
        handles::remove(self.view_handle, Kind::TextBufferView);
    }

    pub fn view_handle(&self) -> u32 {
        self.view_handle
    }

    fn eb(&self) -> Option<&'static mut EditBuffer> {
        eb_of(self.edit_handle)
    }

    fn primary_cursor(&self) -> Cursor {
        self.eb().map(|e| e.primary_cursor()).unwrap_or(Cursor {
            row: 0,
            col: 0,
            desired_col: 0,
            offset: 0,
        })
    }

    // --- wrapping-aware translation ------------------------------------------

    pub fn logical_to_visual_cursor(&mut self, logical_row: u32, logical_col: u32) -> VisualCursor {
        let (clamped_row, clamped_col, offset) = {
            let Some(eb) = self.eb() else {
                return VisualCursor {
                    visual_row: 0,
                    visual_col: 0,
                    logical_row,
                    logical_col,
                    offset: 0,
                };
            };
            let line_count = eb.tb.get_line_count();
            let clamped_row = if line_count > 0 {
                logical_row.min(line_count - 1)
            } else {
                0
            };
            let line_width = eb.tb.line_width_at(clamped_row);
            let clamped_col = logical_col.min(line_width);
            let offset = eb
                .tb
                .coords_to_offset(clamped_row, clamped_col)
                .unwrap_or(0);
            (clamped_row, clamped_col, offset)
        };

        let visual_row_idx = self.view.find_visual_line_index(clamped_row, clamped_col);
        let vlines = self.view.virtual_lines();
        if vlines.is_empty() || visual_row_idx as usize >= vlines.len() {
            return VisualCursor {
                visual_row: 0,
                visual_col: 0,
                logical_row: clamped_row,
                logical_col: clamped_col,
                offset,
            };
        }
        let vline = &vlines[visual_row_idx as usize];
        let vline_start_col = vline.source_col_offset;
        let visual_col = clamped_col.saturating_sub(vline_start_col);
        VisualCursor {
            visual_row: visual_row_idx,
            visual_col,
            logical_row: clamped_row,
            logical_col: clamped_col,
            offset,
        }
    }

    fn visual_to_logical_cursor(
        &mut self,
        visual_row: u32,
        visual_col: u32,
    ) -> Option<VisualCursor> {
        let (source_line, source_col_offset, width_cols) = {
            let vlines = self.view.virtual_lines();
            if visual_row as usize >= vlines.len() {
                return None;
            }
            let v = &vlines[visual_row as usize];
            (v.source_line, v.source_col_offset, v.width_cols)
        };
        let clamped_visual_col = visual_col.min(width_cols);
        let logical_col = source_col_offset + clamped_visual_col;
        let logical_row = source_line;
        let offset = self
            .eb()
            .and_then(|e| e.tb.coords_to_offset(logical_row, logical_col))
            .unwrap_or(0);
        Some(VisualCursor {
            visual_row,
            visual_col: clamped_visual_col,
            logical_row,
            logical_col,
            offset,
        })
    }

    fn clamp_visual_col_to_row(&mut self, visual_row: u32, visual_col: u32) -> u32 {
        let vlines = self.view.virtual_lines();
        if visual_row as usize >= vlines.len() {
            return visual_col;
        }
        let v = &vlines[visual_row as usize];
        let mut target = visual_col.min(v.width_cols);
        if target == v.width_cols && v.width_cols > 0 && (visual_row as usize + 1) < vlines.len() {
            let next = &vlines[visual_row as usize + 1];
            if next.source_line == v.source_line {
                target = v.width_cols - 1;
            }
        }
        target
    }

    // --- viewport / scroll ----------------------------------------------------

    pub fn get_viewport(&self) -> Option<Viewport> {
        self.view.get_viewport()
    }

    pub fn set_viewport(&mut self, vp: Option<Viewport>, move_cursor: bool) {
        self.view.set_viewport(vp);
        if move_cursor {
            self.make_cursor_visible();
        }
    }

    pub fn set_scroll_margin(&mut self, margin: f32) {
        self.scroll_margin = margin.clamp(0.0, 0.5);
    }

    pub fn set_selection_follow_cursor(&mut self, enabled: bool) {
        self.selection_follow_cursor = enabled;
    }

    pub fn set_wrap_mode(&mut self, mode: WrapMode) {
        self.view.set_wrap_mode(mode);
    }

    fn ensure_cursor_visible(&mut self, cursor_line: u32) {
        let Some(vp) = self.view.get_viewport() else {
            return;
        };
        if vp.height == 0 || vp.width == 0 {
            return;
        }
        let raw_margin_lines = ((vp.height as f32 * self.scroll_margin) as u32).max(1);
        let max_margin_lines = if vp.height > 1 {
            (vp.height - 1) / 2
        } else {
            0
        };
        let margin_lines = raw_margin_lines.min(max_margin_lines);

        let total_lines = self.view.virtual_line_count();
        let max_offset_y = total_lines.saturating_sub(vp.height);

        let mut new_offset_y = vp.y;
        let mut new_offset_x = vp.x;

        if cursor_line < vp.y + margin_lines {
            new_offset_y = cursor_line.saturating_sub(margin_lines);
        } else if cursor_line >= vp.y + vp.height - margin_lines {
            let desired = cursor_line + margin_lines - vp.height + 1;
            new_offset_y = desired.min(max_offset_y);
        }

        if self.view.wrap_mode == WrapMode::None {
            let raw_margin_cols = ((vp.width as f32 * self.scroll_margin) as u32).max(1);
            let max_margin_cols = if vp.width > 1 { (vp.width - 1) / 2 } else { 0 };
            let margin_cols = raw_margin_cols.min(max_margin_cols);
            let cursor_col = self.primary_cursor().col;
            if cursor_col < vp.x + margin_cols {
                new_offset_x = cursor_col.saturating_sub(margin_cols);
            } else if cursor_col >= vp.x + vp.width - margin_cols {
                new_offset_x = cursor_col + margin_cols - vp.width + 1;
            }
        }

        if new_offset_y != vp.y || new_offset_x != vp.x {
            self.view.set_viewport(Some(Viewport {
                x: new_offset_x,
                y: new_offset_y,
                width: vp.width,
                height: vp.height,
            }));
        }
    }

    pub fn make_cursor_visible(&mut self) {
        let Some(vp) = self.view.get_viewport() else {
            return;
        };
        let cursor = self.primary_cursor();
        let vcursor = self.logical_to_visual_cursor(cursor.row, cursor.col);
        let margin_lines = ((vp.height as f32 * self.scroll_margin) as u32).max(1);

        let above = vcursor.visual_row < vp.y;
        let below = vcursor.visual_row >= vp.y + vp.height;
        let too_top = vcursor.visual_row < vp.y + margin_lines;
        let too_bottom = vcursor.visual_row >= vp.y + vp.height - margin_lines;

        if above || below || too_top || too_bottom {
            let target_visual_row = if above || too_top {
                vp.y + margin_lines
            } else {
                vp.y + vp.height - margin_lines - 1
            };
            let source_line = {
                let vlines = self.view.virtual_lines();
                if (target_visual_row as usize) < vlines.len() {
                    Some(vlines[target_visual_row as usize].source_line)
                } else {
                    None
                }
            };
            if let Some(target_logical_row) = source_line {
                if let Some(eb) = self.eb() {
                    let line_width = eb.tb.line_width_at(target_logical_row);
                    let target_col = cursor.col.min(line_width);
                    if let Some(offset) = eb.tb.coords_to_offset(target_logical_row, target_col) {
                        eb.set_primary_cursor(Cursor {
                            row: target_logical_row,
                            col: target_col,
                            desired_col: target_col,
                            offset,
                        });
                        self.last_cursor = Some((target_logical_row, target_col));
                    }
                }
            }
        }
    }

    pub fn set_viewport_size(&mut self, width: u32, height: u32) {
        self.view.set_viewport_size(width, height);
        let Some(vp) = self.view.get_viewport() else {
            return;
        };
        let total_lines = self.view.virtual_line_count();
        let max_offset_y = total_lines.saturating_sub(vp.height);
        let mut new_offset_x = vp.x;
        if self.view.wrap_mode == WrapMode::None {
            let max_line_width = self.eb().map(|e| e.max_line_width()).unwrap_or(0);
            let max_offset_x = max_line_width.saturating_sub(vp.width);
            if vp.x > max_offset_x {
                new_offset_x = max_offset_x;
            }
        }
        if vp.y > max_offset_y || new_offset_x != vp.x {
            self.view.set_viewport(Some(Viewport {
                x: new_offset_x,
                y: vp.y.min(max_offset_y),
                width: vp.width,
                height: vp.height,
            }));
        }
        let cursor = self.primary_cursor();
        let vcursor = self.logical_to_visual_cursor(cursor.row, cursor.col);
        self.ensure_cursor_visible(vcursor.visual_row);
    }

    // --- render reconcile (poll for the cursorChanged event) -----------------

    fn update_before_render(&mut self) {
        // External cursor change resets the preserved visual column.
        let cur = self.primary_cursor();
        let key = (cur.row, cur.col);
        if self.last_cursor != Some(key) {
            self.desired_visual_col = None;
            self.last_cursor = Some(key);
        }
        let has_selection = self.view.selection.is_some();
        if !has_selection || self.selection_follow_cursor {
            let vcursor = self.logical_to_visual_cursor(cur.row, cur.col);
            self.ensure_cursor_visible(vcursor.visual_row);
        }
    }

    // --- cursor / text --------------------------------------------------------

    pub fn get_cursor(&self) -> (u32, u32) {
        let c = self.primary_cursor();
        (c.row, c.col)
    }

    pub fn set_cursor_by_offset(&mut self, offset: u32) {
        if let Some(eb) = self.eb() {
            eb.set_cursor_by_offset(offset);
        }
        self.update_before_render();
    }

    pub fn get_text(&self) -> Vec<u8> {
        self.eb().map(|e| e.get_text()).unwrap_or_default()
    }

    pub fn get_visual_cursor(&mut self) -> VisualCursor {
        self.update_before_render();
        let cursor = self.primary_cursor();
        let vcursor = self.logical_to_visual_cursor(cursor.row, cursor.col);
        let Some(vp) = self.view.get_viewport() else {
            return vcursor;
        };
        let vr = vcursor.visual_row.saturating_sub(vp.y);
        let vc = if self.view.wrap_mode == WrapMode::None {
            vcursor.visual_col.saturating_sub(vp.x)
        } else {
            vcursor.visual_col
        };
        VisualCursor {
            visual_row: vr,
            visual_col: vc,
            logical_row: vcursor.logical_row,
            logical_col: vcursor.logical_col,
            offset: vcursor.offset,
        }
    }

    fn move_visual(&mut self, up: bool) {
        let cursor = self.primary_cursor();
        let vcursor = self.logical_to_visual_cursor(cursor.row, cursor.col);
        let vlines_len = self.view.virtual_lines().len() as u32;
        let target_visual_row = if up {
            if vcursor.visual_row == 0 {
                return;
            }
            vcursor.visual_row - 1
        } else {
            if vcursor.visual_row + 1 >= vlines_len {
                return;
            }
            vcursor.visual_row + 1
        };
        if self.desired_visual_col.is_none() {
            self.desired_visual_col = Some(vcursor.visual_col);
        }
        let desired = self.desired_visual_col.unwrap();
        let target_visual_col = self.clamp_visual_col_to_row(target_visual_row, desired);
        if let Some(nv) = self.visual_to_logical_cursor(target_visual_row, target_visual_col) {
            if let Some(eb) = self.eb() {
                eb.set_primary_cursor(Cursor {
                    row: nv.logical_row,
                    col: nv.logical_col,
                    desired_col: nv.logical_col,
                    offset: nv.offset,
                });
            }
            self.ensure_cursor_visible(nv.visual_row);
            self.desired_visual_col = Some(desired);
            self.last_cursor = Some((nv.logical_row, nv.logical_col));
        }
    }

    pub fn move_up_visual(&mut self) {
        self.move_visual(true);
    }

    pub fn move_down_visual(&mut self) {
        self.move_visual(false);
    }

    pub fn get_eol(&mut self) -> VisualCursor {
        let lc = self.eb().map(|e| e.get_eol()).unwrap_or(Cursor {
            row: 0,
            col: 0,
            desired_col: 0,
            offset: 0,
        });
        self.logical_to_visual_cursor(lc.row, lc.col)
    }

    pub fn get_next_word_boundary(&mut self) -> VisualCursor {
        let lc = self.eb().map(|e| e.next_word_boundary()).unwrap_or(Cursor {
            row: 0,
            col: 0,
            desired_col: 0,
            offset: 0,
        });
        self.logical_to_visual_cursor(lc.row, lc.col)
    }

    pub fn get_prev_word_boundary(&mut self) -> VisualCursor {
        let lc = self.eb().map(|e| e.prev_word_boundary()).unwrap_or(Cursor {
            row: 0,
            col: 0,
            desired_col: 0,
            offset: 0,
        });
        self.logical_to_visual_cursor(lc.row, lc.col)
    }

    pub fn get_visual_sol(&mut self) -> VisualCursor {
        let cursor = self.primary_cursor();
        let vcursor = self.logical_to_visual_cursor(cursor.row, cursor.col);
        let (source_line, source_col_offset) = {
            let vlines = self.view.virtual_lines();
            if vcursor.visual_row as usize >= vlines.len() {
                let offset = self
                    .eb()
                    .and_then(|e| e.tb.coords_to_offset(cursor.row, 0))
                    .unwrap_or(0);
                return VisualCursor {
                    visual_row: vcursor.visual_row,
                    visual_col: 0,
                    logical_row: cursor.row,
                    logical_col: 0,
                    offset,
                };
            }
            let v = &vlines[vcursor.visual_row as usize];
            (v.source_line, v.source_col_offset)
        };
        let offset = self
            .eb()
            .and_then(|e| e.tb.coords_to_offset(source_line, source_col_offset))
            .unwrap_or(0);
        VisualCursor {
            visual_row: vcursor.visual_row,
            visual_col: 0,
            logical_row: source_line,
            logical_col: source_col_offset,
            offset,
        }
    }

    pub fn get_visual_eol(&mut self) -> VisualCursor {
        let cursor = self.primary_cursor();
        let vcursor = self.logical_to_visual_cursor(cursor.row, cursor.col);
        let vlines_len = self.view.virtual_lines().len();
        if vcursor.visual_row as usize >= vlines_len {
            return self.get_eol();
        }
        let (source_line, source_col_offset, width_cols) = {
            let vlines = self.view.virtual_lines();
            let v = &vlines[vcursor.visual_row as usize];
            (v.source_line, v.source_col_offset, v.width_cols)
        };
        let target_visual_col = self.clamp_visual_col_to_row(vcursor.visual_row, width_cols);
        let logical_col = source_col_offset + target_visual_col;
        let offset = self
            .eb()
            .and_then(|e| e.tb.coords_to_offset(source_line, logical_col))
            .unwrap_or(0);
        VisualCursor {
            visual_row: vcursor.visual_row,
            visual_col: target_visual_col,
            logical_row: source_line,
            logical_col,
            offset,
        }
    }

    // --- selection (delegate to the view; local selection syncs the cursor) --

    pub fn set_selection(
        &mut self,
        start: u32,
        end: u32,
        bg: Option<[u16; 4]>,
        fg: Option<[u16; 4]>,
    ) {
        self.view.set_selection(start, end, bg, fg);
    }

    pub fn update_selection(&mut self, end: u32, bg: Option<[u16; 4]>, fg: Option<[u16; 4]>) {
        self.view.update_selection(end, bg, fg);
    }

    pub fn reset_selection(&mut self) {
        self.view.reset_selection();
    }

    pub fn pack_selection_info(&self) -> u64 {
        self.view.pack_selection_info()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_local_selection(
        &mut self,
        ax: i32,
        ay: i32,
        fx: i32,
        fy: i32,
        bg: Option<[u16; 4]>,
        fg: Option<[u16; 4]>,
        update_cursor: bool,
        follow_cursor: bool,
    ) -> bool {
        self.selection_follow_cursor = follow_cursor;
        let changed = self.view.set_local_selection(ax, ay, fx, fy, bg, fg);
        if changed && update_cursor {
            self.sync_cursor_to_selection_focus();
        }
        changed
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_local_selection(
        &mut self,
        ax: i32,
        ay: i32,
        fx: i32,
        fy: i32,
        bg: Option<[u16; 4]>,
        fg: Option<[u16; 4]>,
        update_cursor: bool,
        follow_cursor: bool,
    ) -> bool {
        self.selection_follow_cursor = follow_cursor;
        let changed = self.view.update_local_selection(ax, ay, fx, fy, bg, fg);
        if changed && update_cursor {
            self.sync_cursor_to_selection_focus();
        }
        changed
    }

    pub fn reset_local_selection(&mut self) {
        self.selection_follow_cursor = false;
        self.view.reset_local_selection();
    }

    fn sync_cursor_to_selection_focus(&mut self) {
        let Some(sel) = self.view.selection else {
            return;
        };
        let anchor = self.view.selection_anchor();
        let focus_offset = match anchor {
            Some(a) if a == sel.start => sel.end,
            Some(_) => sel.start,
            None => sel.end,
        };
        if let Some(eb) = self.eb() {
            let Some((row, col)) = eb.tb.offset_to_coords(focus_offset) else {
                return;
            };
            let line_count = eb.tb.get_line_count();
            if row >= line_count {
                return;
            }
            let line_width = eb.tb.line_width_at(row);
            if col > line_width {
                return;
            }
            eb.set_primary_cursor(Cursor {
                row,
                col,
                desired_col: col,
                offset: focus_offset,
            });
        }
    }

    pub fn get_selected_text(&mut self, max_len: usize) -> Vec<u8> {
        self.view.selected_text(max_len)
    }

    pub fn delete_selected_text(&mut self) {
        let sel = self.view.selection;
        let Some(sel) = sel else { return };
        if let Some(eb) = self.eb() {
            let Some((sr, sc)) = eb.tb.offset_to_coords(sel.start) else {
                return;
            };
            let Some((er, ec)) = eb.tb.offset_to_coords(sel.end) else {
                return;
            };
            eb.delete_range(
                Cursor {
                    row: sr,
                    col: sc,
                    desired_col: sc,
                    offset: sel.start,
                },
                Cursor {
                    row: er,
                    col: ec,
                    desired_col: ec,
                    offset: sel.end,
                },
            );
        }
        self.view.reset_local_selection();
        self.update_before_render();
    }

    // --- misc getters / tab indicator ----------------------------------------

    /// Zig `editorViewGetVirtualLineCount` = getVirtualLines().len — the count
    /// of virtual lines VISIBLE in the viewport window (viewport.y .. y+height,
    /// clamped), not the total.
    pub fn get_virtual_line_count(&mut self) -> u32 {
        self.update_before_render();
        let total = self.view.virtual_line_count();
        match self.view.get_viewport() {
            Some(vp) => {
                let start = vp.y.min(total);
                let end = (start + vp.height).min(total);
                end - start
            }
            None => total,
        }
    }

    pub fn get_total_virtual_line_count(&mut self) -> u32 {
        self.view.virtual_line_count()
    }

    pub fn set_tab_indicator(&mut self, indicator: Option<u32>) {
        self.view.tab_indicator = indicator;
    }

    pub fn set_tab_indicator_color(&mut self, color: Option<[u16; 4]>) {
        self.view.tab_indicator_color = color;
    }

    /// Run the pre-render reconcile (public for the draw FFI).
    pub fn prepare_for_draw(&mut self) {
        self.update_before_render();
    }
}
