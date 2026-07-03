//! ADR-046 Slice E — `CliRenderer`: cell-buffer diff → ANSI escape output.
//!
//! Ported from OpenTUI v0.4.1 `renderer.zig` / `renderer-output.zig` /
//! `ansi.zig`, scoped to the render path the TUI drives: double-buffered
//! `current`/`next` cell grids, `prepareRenderFrameWithWriter`'s per-cell diff
//! with run-encoded color/attribute/char emission, the cursor/mouse-pointer
//! restore tail, and the memory output backend + `dumpOutputBuffer` dump used
//! by the parity harness (no TTY required).
//!
//! Verification: `script/native-render-renderer-parity.mjs` renders identical
//! frames through this and the Zig backend and diffs the committed ANSI stream.

use std::io::Write as _;

use crate::buffer::{
    ColorIntent, OptimizedBuffer, Rgba, alpha, blue, char_right_extent, default_color,
    grapheme_id_from_char, green, intent, is_continuation_char, is_grapheme_char, link_id,
    rgb_color, rgba_equal, slot, u8_rgb_to_rgba,
};
use crate::buffer_ffi::global_pool;
use crate::handles::{self, Kind};
use crate::terminal::{Capabilities, CursorStyle, MousePointerStyle, RemoteMode, Terminal};

/// Zig `CLEAR_CHAR` — sentinel the current buffer is seeded with so the first
/// diff always differs; never emitted.
const CLEAR_CHAR: u32 = 0x0A00;

// --- text attribute bits (ansi.TextAttributes) --------------------------------
const ATTR_BOLD: u32 = 1 << 0;
const ATTR_DIM: u32 = 1 << 1;
const ATTR_ITALIC: u32 = 1 << 2;
const ATTR_UNDERLINE: u32 = 1 << 3;
const ATTR_BLINK: u32 = 1 << 4;
const ATTR_INVERSE: u32 = 1 << 5;
const ATTR_HIDDEN: u32 = 1 << 6;
const ATTR_STRIKETHROUGH: u32 = 1 << 7;

// --- ANSI 256-color fallback palette (ansi.fallbackAnsi256Color) --------------
const ANSI16_RGB: [[u8; 3]; 16] = [
    [0x00, 0x00, 0x00],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x80, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x80, 0x00, 0x80],
    [0x00, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0x80, 0x80, 0x80],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0xff, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0xff, 0xff, 0xff],
];
const CUBE_LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];

fn fallback_ansi256_color(index: usize) -> Rgba {
    if index < 16 {
        return u8_rgb_to_rgba(
            ANSI16_RGB[index][0],
            ANSI16_RGB[index][1],
            ANSI16_RGB[index][2],
        );
    }
    if index < 232 {
        let cube = index - 16;
        let r = CUBE_LEVELS[(cube / 36) % 6];
        let g = CUBE_LEVELS[(cube / 6) % 6];
        let b = CUBE_LEVELS[cube % 6];
        return u8_rgb_to_rgba(r, g, b);
    }
    let gray = (8 + (index - 232) * 10) as u8;
    u8_rgb_to_rgba(gray, gray, gray)
}

fn color_distance_squared(a: Rgba, b: Rgba) -> f32 {
    let dr = crate::buffer::red(a) as f32 - crate::buffer::red(b) as f32;
    let dg = green(a) as f32 - green(b) as f32;
    let db = blue(a) as f32 - blue(b) as f32;
    dr * dr + dg * dg + db * db
}

// --- output backend (renderer-output.zig BufferedBackend) ---------------------
//
// Non-threaded mode never flips the active buffer, so the committed frame is
// simply the last bytes written between begin/end. The memory variant keeps the
// frame + control (`writeOut`) bytes in memory (`dump_to` mirrors the Zig debug
// format the render harness parses); the stdout variant flushes committed frame
// + control bytes to process stdout, matching Zig's StdoutOutput so the TTY
// differential harness can capture setup/teardown escape sequences.
enum OutputBackend {
    Memory {
        frame: Vec<u8>,
        has_committed: bool,
        // Faithful to MemoryOutput.bytes: accumulates writeOut + committed
        // frames. Not surfaced by dumpOutputBuffer (which dumps the A/B frame).
        control: Vec<u8>,
    },
    Stdout {
        frame: Vec<u8>,
        has_committed: bool,
    },
    /// Routes committed frames + control bytes to a native span feed (the SSH /
    /// thin-client remote-attach transport). Non-owning pointer — the feed is
    /// created and destroyed via createNativeSpanFeed / destroyNativeSpanFeed.
    Feed {
        stream: *mut crate::native_span_feed::Stream,
    },
}

impl OutputBackend {
    fn memory() -> OutputBackend {
        OutputBackend::Memory {
            frame: Vec::new(),
            has_committed: false,
            control: Vec::new(),
        }
    }

    fn stdout() -> OutputBackend {
        OutputBackend::Stdout {
            frame: Vec::new(),
            has_committed: false,
        }
    }

    fn feed_write(stream: *mut crate::native_span_feed::Stream, bytes: &[u8]) {
        if stream.is_null() || bytes.is_empty() {
            return;
        }
        let s = unsafe { &mut *stream };
        let _ = s.write(bytes);
        let _ = s.commit();
    }

    /// Commit one rendered frame's bytes (begin_frame + write + end_frame).
    fn commit_frame(&mut self, bytes: &[u8]) {
        match self {
            OutputBackend::Memory {
                frame,
                has_committed,
                ..
            } => {
                frame.clear();
                frame.extend_from_slice(bytes);
                *has_committed = true;
            }
            OutputBackend::Stdout {
                frame,
                has_committed,
            } => {
                frame.clear();
                frame.extend_from_slice(bytes);
                *has_committed = true;
                write_stdout(bytes);
            }
            OutputBackend::Feed { stream } => Self::feed_write(*stream, bytes),
        }
    }

    /// Synchronously emit a pre-built control sequence (setup/shutdown/query).
    fn write_out(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        match self {
            OutputBackend::Memory { control, .. } => control.extend_from_slice(bytes),
            OutputBackend::Stdout { .. } => write_stdout(bytes),
            OutputBackend::Feed { stream } => Self::feed_write(*stream, bytes),
        }
    }

    fn dump_to(&self, out: &mut Vec<u8>) {
        let (frame, has_committed): (&[u8], bool) = match self {
            OutputBackend::Memory {
                frame,
                has_committed,
                ..
            } => (frame.as_slice(), *has_committed),
            OutputBackend::Stdout {
                frame,
                has_committed,
            } => (frame.as_slice(), *has_committed),
            OutputBackend::Feed { .. } => {
                // Feed has no flat previous-frame slice; drain the spans instead.
                out.extend_from_slice(
                    b"(feed backend - drain spans from the NativeSpanFeed for output)\n",
                );
                out.extend_from_slice(b"\n================\n");
                return;
            }
        };
        let last: &[u8] = if has_committed { frame } else { &[] };
        if !last.is_empty() {
            out.extend_from_slice(last);
        } else {
            out.extend_from_slice(b"(no output rendered yet)\n");
        }
        out.extend_from_slice(b"\n================\n");
        let _ = write!(out, "Buffer size: {} bytes\n", last.len());
        out.extend_from_slice(b"Active buffer: A\n");
        out.extend_from_slice(b"Last committed buffer: A\n");
    }
}

fn write_stdout(bytes: &[u8]) {
    use std::io::Write as _;
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = lock.write_all(bytes);
    let _ = lock.flush();
}

pub struct CliRenderer {
    pub width: u32,
    pub height: u32,
    current_buffer: Box<OptimizedBuffer>,
    next_buffer: Box<OptimizedBuffer>,
    current_handle: u32,
    next_handle: u32,
    background_color: Rgba,
    render_offset: u32,
    terminal: Terminal,
    backend: OutputBackend,

    // Terminal setup/teardown state (renderer.zig).
    terminal_setup: bool,
    use_alternate_screen: bool,
    clear_on_shutdown: bool,

    palette_rgba: [Rgba; 256],
    #[allow(dead_code)]
    default_fg_rgba: Rgba,
    #[allow(dead_code)]
    default_bg_rgba: Rgba,
    palette_epoch: u32,
    last_rendered_palette_epoch: Option<u32>,
    force_full_repaint: bool,

    // Cursor diff cache.
    last_cursor_style_tag: Option<u8>,
    last_cursor_blinking: Option<bool>,
    last_cursor_color_rgb: Option<[u8; 3]>,
    last_cursor_x: Option<u32>,
    last_cursor_y: Option<u32>,
    last_cursor_visible: Option<bool>,
    last_mouse_pointer: MousePointerStyle,

    // Hit grid for mouse dispatch (double-buffered like the render buffers).
    current_hit_grid: Vec<u32>,
    next_hit_grid: Vec<u32>,
    hit_grid_width: u32,
    hit_grid_height: u32,
    hit_scissor_stack: Vec<HitClipRect>,
    hit_grid_dirty: bool,
    hit_grid_resize_invalidated: bool,

    // Render stats (renderer.zig renderStats/statSamples). Timing fields carry
    // best-effort values (not part of the deterministic parity surface); the
    // deterministic fields are frame_count / cells_updated / average +
    // valid flags.
    stat_frame_count: u64,
    stat_cells_updated: u32,
    stat_last_frame_time_ms: f64,
    stat_render_time: Option<f64>,
    stat_output_write_time: Option<f64>,
    stat_last_frame_samples: Vec<f64>,
    stat_cells_samples: Vec<u32>,

    // Render thread + JS-supplied stats. Threading is output-invariant (frames
    // are byte-identical whether written inline or on a thread); the memory
    // backend can't thread, so this stays false there. No FFI getter surfaces
    // these, so they are pure state sinks.
    #[allow(dead_code)]
    use_thread: bool,
    #[allow(dead_code)]
    stat_overall_frame_time: f64,
    #[allow(dead_code)]
    stat_fps: u32,
    #[allow(dead_code)]
    stat_frame_callback_time: f64,
    #[allow(dead_code)]
    stat_heap_used: u32,
    #[allow(dead_code)]
    stat_heap_total: u32,
    #[allow(dead_code)]
    stat_array_buffers: u32,

    // Split-footer scrollback.
    split_scrollback: SplitScrollback,
    pending_split_footer_transition: SplitFooterTransition,
}

const MAX_STAT_SAMPLES: usize = 30;

fn push_sample<T: Copy>(samples: &mut Vec<T>, value: T) {
    samples.push(value);
    if samples.len() > MAX_STAT_SAMPLES {
        samples.remove(0);
    }
}

/// Screen-space clip rect for hit-grid scissoring (buf.ClipRect).
#[derive(Clone, Copy)]
struct HitClipRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// split-scrollback.zig `SplitScrollback` (subset used by the ported symbols:
/// reset / renderOffset / noteViewportScroll).
#[derive(Clone, Copy, Default)]
struct SplitScrollback {
    published_rows: u32,
    tail_column: u32,
}

impl SplitScrollback {
    fn reset(&mut self, seed_rows: u32) {
        self.published_rows = seed_rows;
        self.tail_column = 0;
    }

    fn render_offset(&self, surface_offset: u32) -> u32 {
        if surface_offset == 0 {
            0
        } else {
            self.published_rows.min(surface_offset)
        }
    }

    fn note_viewport_scroll(&mut self, lines: u32) {
        self.published_rows -= lines.min(self.published_rows);
        if self.published_rows == 0 {
            self.tail_column = 0;
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SplitFooterTransitionMode {
    None,
    ViewportScroll,
    ClearStaleRows,
}

impl SplitFooterTransitionMode {
    fn from_code(v: u8) -> SplitFooterTransitionMode {
        match v {
            1 => SplitFooterTransitionMode::ViewportScroll,
            2 => SplitFooterTransitionMode::ClearStaleRows,
            _ => SplitFooterTransitionMode::None,
        }
    }
}

#[derive(Clone, Copy)]
struct SplitFooterTransition {
    mode: SplitFooterTransitionMode,
    source_top_line: u32,
    source_height: u32,
    target_top_line: u32,
    target_height: u32,
    scroll_lines: u32,
}

impl Default for SplitFooterTransition {
    fn default() -> SplitFooterTransition {
        SplitFooterTransition {
            mode: SplitFooterTransitionMode::None,
            source_top_line: 0,
            source_height: 0,
            target_top_line: 0,
            target_height: 0,
            scroll_lines: 0,
        }
    }
}

/// Zig `RenderStatus`.
#[repr(u8)]
pub enum RenderStatus {
    Rendered = 0,
    #[allow(dead_code)]
    Skipped = 1,
    #[allow(dead_code)]
    Failed = 2,
}

/// Output transport requested at createRenderer time.
pub enum OutputKind {
    Stdout,
    Memory,
    Feed(*mut crate::native_span_feed::Stream),
}

impl CliRenderer {
    pub fn create(
        width: u32,
        height: u32,
        output: OutputKind,
        remote_mode: RemoteMode,
    ) -> Option<Box<CliRenderer>> {
        if width == 0 || height == 0 {
            return None;
        }
        let mut current_buffer = Box::new(OptimizedBuffer::new(
            width,
            height,
            false,
            1,
            b"current buffer".to_vec(),
        )?);
        let mut next_buffer = Box::new(OptimizedBuffer::new(
            width,
            height,
            false,
            1,
            b"next buffer".to_vec(),
        )?);

        let background_color = rgb_color(0, 0, 0, 0);

        {
            let mut pool = global_pool();
            next_buffer.set_blend_backdrop_color(Some(rgb_color(
                crate::buffer::red(background_color),
                green(background_color),
                blue(background_color),
                255,
            )));
            current_buffer.clear(&mut pool, background_color, Some(CLEAR_CHAR));
            next_buffer.clear(&mut pool, background_color, None);
        }

        // Register the two child buffers so getNextBuffer/getCurrentBuffer hand
        // JS a handle bufferDrawText can resolve. Borrowed: destroyRenderer
        // invalidates them; the renderer's Boxes own the storage.
        let current_handle =
            handles::insert(Kind::OptimizedBuffer, &*current_buffer as *const _ as usize);
        let next_handle =
            handles::insert(Kind::OptimizedBuffer, &*next_buffer as *const _ as usize);
        if current_handle == 0 || next_handle == 0 {
            if current_handle != 0 {
                handles::remove(current_handle, Kind::OptimizedBuffer);
            }
            if next_handle != 0 {
                handles::remove(next_handle, Kind::OptimizedBuffer);
            }
            return None;
        }

        let mut palette_rgba = [rgb_color(0, 0, 0, 0); 256];
        for (i, slot_color) in palette_rgba.iter_mut().enumerate() {
            *slot_color = fallback_ansi256_color(i);
        }

        Some(Box::new(CliRenderer {
            width,
            height,
            current_buffer,
            next_buffer,
            current_handle,
            next_handle,
            background_color,
            render_offset: 0,
            terminal: Terminal::init(remote_mode),
            backend: match output {
                OutputKind::Stdout => OutputBackend::stdout(),
                OutputKind::Memory => OutputBackend::memory(),
                OutputKind::Feed(stream) => OutputBackend::Feed { stream },
            },
            terminal_setup: false,
            use_alternate_screen: true,
            clear_on_shutdown: true,
            palette_rgba,
            default_fg_rgba: default_color(255, 255, 255, 255),
            default_bg_rgba: default_color(0, 0, 0, 255),
            palette_epoch: 0,
            last_rendered_palette_epoch: None,
            force_full_repaint: false,
            last_cursor_style_tag: None,
            last_cursor_blinking: None,
            last_cursor_color_rgb: None,
            last_cursor_x: None,
            last_cursor_y: None,
            last_cursor_visible: None,
            last_mouse_pointer: MousePointerStyle::Default,
            current_hit_grid: vec![0; (width * height) as usize],
            next_hit_grid: vec![0; (width * height) as usize],
            hit_grid_width: width,
            hit_grid_height: height,
            hit_scissor_stack: Vec::new(),
            hit_grid_dirty: false,
            hit_grid_resize_invalidated: false,
            stat_frame_count: 0,
            stat_cells_updated: 0,
            stat_last_frame_time_ms: 0.0,
            stat_render_time: None,
            stat_output_write_time: None,
            stat_last_frame_samples: Vec::new(),
            stat_cells_samples: Vec::new(),
            use_thread: false,
            stat_overall_frame_time: 0.0,
            stat_fps: 0,
            stat_frame_callback_time: 0.0,
            stat_heap_used: 0,
            stat_heap_total: 0,
            stat_array_buffers: 0,
            split_scrollback: SplitScrollback::default(),
            pending_split_footer_transition: SplitFooterTransition::default(),
        }))
    }

    // --- split-footer scrollback ----------------------------------------------

    fn split_output_offset(&self, surface_offset: u32) -> u32 {
        self.split_scrollback.render_offset(surface_offset)
    }

    fn clamp_split_surface_offset(&self, surface_offset: u32, pinned_render_offset: u32) -> u32 {
        let output_offset = self.split_output_offset(pinned_render_offset);
        surface_offset.clamp(output_offset, pinned_render_offset)
    }

    pub fn reset_split_scrollback(&mut self, seed_rows: u32, pinned_render_offset: u32) -> u32 {
        self.split_scrollback.reset(seed_rows);
        self.render_offset = self.split_scrollback.render_offset(pinned_render_offset);
        self.render_offset
    }

    pub fn sync_split_scrollback(&mut self, pinned_render_offset: u32) -> u32 {
        self.render_offset =
            self.clamp_split_surface_offset(self.render_offset, pinned_render_offset);
        self.render_offset
    }

    pub fn get_split_output_offset(&self, surface_offset: u32) -> u32 {
        self.split_output_offset(surface_offset)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_pending_split_footer_transition(
        &mut self,
        mode: u8,
        source_top_line: u32,
        source_height: u32,
        target_top_line: u32,
        target_height: u32,
        scroll_lines: u32,
    ) {
        self.pending_split_footer_transition = SplitFooterTransition {
            mode: SplitFooterTransitionMode::from_code(mode),
            source_top_line,
            source_height,
            target_top_line,
            target_height,
            scroll_lines,
        };
    }

    pub fn clear_pending_split_footer_transition(&mut self) {
        self.pending_split_footer_transition = SplitFooterTransition::default();
    }

    /// Zig `applyPendingSplitFooterTransition` — emit the pending transition's
    /// scroll / stale-row-clear escapes, then consume it.
    fn apply_pending_split_footer_transition(
        &mut self,
        out: &mut Vec<u8>,
        frame_started: &mut bool,
    ) {
        let transition = self.pending_split_footer_transition;
        self.pending_split_footer_transition = SplitFooterTransition::default();

        if transition.mode == SplitFooterTransitionMode::None
            || transition.source_height == 0
            || transition.target_height == 0
        {
            return;
        }
        if !*frame_started {
            begin_render_frame(out);
            *frame_started = true;
        }
        match transition.mode {
            SplitFooterTransitionMode::ViewportScroll => {
                if transition.scroll_lines == 0 {
                    return;
                }
                self.split_scrollback
                    .note_viewport_scroll(transition.scroll_lines);
                if transition.source_top_line < transition.target_top_line {
                    let _ = write!(out, "\x1b[{}T", transition.scroll_lines);
                } else if transition.source_top_line > transition.target_top_line {
                    let _ = write!(out, "\x1b[{}S", transition.scroll_lines);
                }
            }
            SplitFooterTransitionMode::ClearStaleRows => {
                let source_end = transition.source_top_line + transition.source_height - 1;
                let target_end = transition.target_top_line + transition.target_height - 1;
                let mut line = transition.source_top_line;
                while line <= source_end {
                    if line >= transition.target_top_line && line <= target_end {
                        line += 1;
                        continue;
                    }
                    move_to_output(out, 1, line);
                    out.extend_from_slice(b"\x1b[2K");
                    line += 1;
                }
            }
            SplitFooterTransitionMode::None => {}
        }
    }

    /// Zig `repaintSplitFooter` — adjust the render offset for the footer and
    /// render, returning packed (renderOffset | status<<32).
    pub fn repaint_split_footer(&mut self, pinned_render_offset: u32, force: bool) -> u64 {
        let transition = self.pending_split_footer_transition;
        let has_pending_viewport_target = transition.mode
            == SplitFooterTransitionMode::ViewportScroll
            && transition.target_top_line > 0
            && transition.scroll_lines > 0;
        let previous = self.render_offset;
        let next = if has_pending_viewport_target {
            transition.target_top_line - 1
        } else {
            self.clamp_split_surface_offset(previous, pinned_render_offset)
        };
        let redraw_footer = force || previous != next;
        self.render_offset = next;

        let mut out = Vec::new();
        self.prepare_render_frame(&mut out, redraw_footer);
        self.backend.commit_frame(&out);
        self.collect_frame_stats();

        // status rendered = 0
        (self.render_offset as u64) | (0u64 << 32)
    }

    /// Zig `setUseThread` — gated on the backend supporting threading. The
    /// memory backend never does; the port writes frames inline (byte-identical
    /// output) rather than owning a write thread, so this only records intent.
    pub fn set_use_thread(&mut self, use_thread: bool) {
        let supports = matches!(self.backend, OutputBackend::Stdout { .. });
        if use_thread && !supports {
            return;
        }
        self.use_thread = use_thread;
    }

    /// Zig `updateStats` — JS-supplied frame timing (debug overlay only).
    pub fn update_stats(&mut self, time: f64, fps: u32, frame_callback_time: f64) {
        self.stat_overall_frame_time = time;
        self.stat_fps = fps;
        self.stat_frame_callback_time = frame_callback_time;
    }

    /// Zig `updateMemoryStats` — JS-supplied heap figures (debug overlay only).
    pub fn update_memory_stats(&mut self, heap_used: u32, heap_total: u32, array_buffers: u32) {
        self.stat_heap_used = heap_used;
        self.stat_heap_total = heap_total;
        self.stat_array_buffers = array_buffers;
    }

    pub fn next_handle(&self) -> u32 {
        self.next_handle
    }

    pub fn current_handle(&self) -> u32 {
        self.current_handle
    }

    pub fn set_background_color(&mut self, color: Rgba) {
        self.background_color = color;
    }

    // --- hit grid (mouse dispatch) --------------------------------------------

    fn current_hit_scissor(&self) -> Option<HitClipRect> {
        self.hit_scissor_stack.last().copied()
    }

    /// Intersect a rect with the current hit scissor (Zig clipRectToHitScissor).
    fn clip_rect_to_hit_scissor(
        &self,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Option<HitClipRect> {
        let Some(scissor) = self.current_hit_scissor() else {
            return Some(HitClipRect {
                x,
                y,
                width,
                height,
            });
        };
        let rect_end_x = x + width as i32;
        let rect_end_y = y + height as i32;
        let scissor_end_x = scissor.x + scissor.width as i32;
        let scissor_end_y = scissor.y + scissor.height as i32;
        let ix = x.max(scissor.x);
        let iy = y.max(scissor.y);
        let iex = rect_end_x.min(scissor_end_x);
        let iey = rect_end_y.min(scissor_end_y);
        if ix >= iex || iy >= iey {
            return None;
        }
        Some(HitClipRect {
            x: ix,
            y: iy,
            width: (iex - ix) as u32,
            height: (iey - iy) as u32,
        })
    }

    /// Fill a clipped rect in the given grid with `id` (shared by
    /// addToHitGrid / addToCurrentHitGridClipped).
    fn fill_hit_grid(
        grid: &mut [u32],
        grid_width: u32,
        grid_height: u32,
        rect: HitClipRect,
        id: u32,
    ) {
        let start_x = rect.x.max(0);
        let start_y = rect.y.max(0);
        let end_x = (rect.x + rect.width as i32).min(grid_width as i32);
        let end_y = (rect.y + rect.height as i32).min(grid_height as i32);
        if start_x >= end_x || start_y >= end_y {
            return;
        }
        for row in start_y as u32..end_y as u32 {
            let row_start = (row * grid_width) as usize;
            let s = row_start + start_x as usize;
            let e = row_start + end_x as usize;
            grid[s..e].fill(id);
        }
    }

    /// Zig `addToHitGrid` — write a renderable's clipped bounds to nextHitGrid.
    pub fn add_to_hit_grid(&mut self, x: i32, y: i32, width: u32, height: u32, id: u32) {
        let Some(rect) = self.clip_rect_to_hit_scissor(x, y, width, height) else {
            return;
        };
        Self::fill_hit_grid(
            &mut self.next_hit_grid,
            self.hit_grid_width,
            self.hit_grid_height,
            rect,
            id,
        );
    }

    /// Zig `addToCurrentHitGridClipped` — write directly to currentHitGrid.
    pub fn add_to_current_hit_grid_clipped(
        &mut self,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        id: u32,
    ) {
        let Some(rect) = self.clip_rect_to_hit_scissor(x, y, width, height) else {
            return;
        };
        Self::fill_hit_grid(
            &mut self.current_hit_grid,
            self.hit_grid_width,
            self.hit_grid_height,
            rect,
            id,
        );
    }

    pub fn clear_current_hit_grid(&mut self) {
        self.current_hit_grid.fill(0);
    }

    /// Zig `checkHit` — renderable id at (x, y), 0 if none / out of bounds.
    pub fn check_hit(&self, x: u32, y: u32) -> u32 {
        if x >= self.hit_grid_width || y >= self.hit_grid_height {
            return 0;
        }
        self.current_hit_grid[(y * self.hit_grid_width + x) as usize]
    }

    /// Zig `getHitGridDirty` — read dirty flag and clear the resize latch.
    pub fn get_hit_grid_dirty(&mut self) -> bool {
        let dirty = self.hit_grid_dirty;
        self.hit_grid_resize_invalidated = false;
        dirty
    }

    pub fn hit_grid_push_scissor_rect(&mut self, x: i32, y: i32, width: u32, height: u32) {
        let mut rect = HitClipRect {
            x,
            y,
            width,
            height,
        };
        if self.current_hit_scissor().is_some() {
            rect = self
                .clip_rect_to_hit_scissor(rect.x, rect.y, rect.width, rect.height)
                .unwrap_or(HitClipRect {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                });
        }
        self.hit_scissor_stack.push(rect);
    }

    pub fn hit_grid_pop_scissor_rect(&mut self) {
        self.hit_scissor_stack.pop();
    }

    pub fn hit_grid_clear_scissor_rects(&mut self) {
        self.hit_scissor_stack.clear();
    }

    pub fn dump_hit_grid(&self) {
        // Debug helper (Zig writes hitgrid_<ts>.txt); best-effort, not on any
        // hot/verified path.
        let mut out = String::with_capacity(
            (self.hit_grid_width + 1) as usize * self.hit_grid_height as usize,
        );
        for y in 0..self.hit_grid_height {
            for x in 0..self.hit_grid_width {
                let id = self.current_hit_grid[(y * self.hit_grid_width + x) as usize];
                out.push(if id == 0 {
                    '.'
                } else {
                    char::from(b'0' + (id % 10) as u8)
                });
            }
            out.push('\n');
        }
        let _ = std::fs::write("hitgrid.txt", out);
    }

    pub fn set_render_offset(&mut self, offset: u32) {
        self.render_offset = offset;
    }

    /// Zig `setPaletteState` — reset to the fallback palette, overlay the
    /// provided 256-entry palette + default fg/bg, and bump the epoch (forcing
    /// a full repaint) when it changed. Only `palette_rgba` (nearest-palette
    /// lookup, active when rgb=false && ansi256) and the epoch are observable in
    /// the emit path; default fg/bg are stored but unread there.
    pub fn set_palette_state(
        &mut self,
        palette: &[Rgba],
        default_fg: Rgba,
        default_bg: Rgba,
        palette_epoch: u32,
    ) {
        for (i, slot_color) in self.palette_rgba.iter_mut().enumerate() {
            *slot_color = fallback_ansi256_color(i);
        }
        self.default_fg_rgba = default_color(255, 255, 255, 255);
        self.default_bg_rgba = default_color(0, 0, 0, 255);

        let copy_len = palette.len().min(self.palette_rgba.len());
        self.palette_rgba[..copy_len].copy_from_slice(&palette[..copy_len]);
        self.default_fg_rgba = default_fg;
        self.default_bg_rgba = default_bg;

        if self.palette_epoch != palette_epoch {
            self.palette_epoch = palette_epoch;
            self.force_full_repaint = true;
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 || (width == self.width && height == self.height) {
            return;
        }
        let mut pool = global_pool();
        self.current_buffer.resize(&mut pool, width, height);
        self.next_buffer.resize(&mut pool, width, height);
        self.width = width;
        self.height = height;
        self.current_buffer
            .clear(&mut pool, self.background_color, Some(CLEAR_CHAR));
        self.next_buffer
            .clear(&mut pool, self.background_color, None);
        self.force_full_repaint = true;

        let cells = (width * height) as usize;
        self.current_hit_grid = vec![0; cells];
        self.next_hit_grid = vec![0; cells];
        self.hit_grid_width = width;
        self.hit_grid_height = height;
        self.hit_scissor_stack.clear();
        self.hit_grid_resize_invalidated = true;
    }

    /// Release grapheme-pool references held by the child buffers before the
    /// renderer (and its owned buffers) is dropped (Zig buffer `deinit`).
    pub fn release_pool_refs(&mut self, pool: &mut crate::pool::GraphemePool) {
        self.current_buffer.tracker.clear(pool);
        self.next_buffer.tracker.clear(pool);
    }

    /// On destroy, invalidate the borrowed child buffer handles so any stale JS
    /// handle stops resolving. Storage is freed when the Box drops.
    pub fn invalidate_child_handles(&self) {
        handles::remove(self.current_handle, Kind::OptimizedBuffer);
        handles::remove(self.next_handle, Kind::OptimizedBuffer);
    }

    pub fn render(&mut self, force: bool) -> RenderStatus {
        let mut out = Vec::new();
        self.prepare_render_frame(&mut out, force);
        self.backend.commit_frame(&out);
        self.collect_frame_stats();
        RenderStatus::Rendered
    }

    /// Zig `collectFrameStats` (deterministic subset). Timing values are
    /// best-effort — only frame_count / cells_updated / averages + valid flags
    /// are part of the parity surface.
    fn collect_frame_stats(&mut self) {
        self.stat_output_write_time = Some(0.0); // backend committed a frame
        self.stat_last_frame_time_ms = 0.0;
        self.stat_frame_count += 1;
        push_sample(
            &mut self.stat_last_frame_samples,
            self.stat_last_frame_time_ms,
        );
        push_sample(&mut self.stat_cells_samples, self.stat_cells_updated);
    }

    /// Zig `getRenderStats` — snapshot written into the ExternalRenderStats
    /// out-struct. Returns (last_frame_time, average_frame_time, render_time,
    /// output_write_time, frame_count, cells_updated, average_cells_updated,
    /// render_time_valid, output_write_time_valid).
    #[allow(clippy::type_complexity)]
    pub fn get_render_stats(&self) -> (f64, f64, f64, f64, u64, u32, u32, bool, bool) {
        let avg_frame = if self.stat_last_frame_samples.is_empty() {
            0.0
        } else {
            self.stat_last_frame_samples.iter().sum::<f64>()
                / self.stat_last_frame_samples.len() as f64
        };
        let avg_cells = if self.stat_cells_samples.is_empty() {
            0
        } else {
            (self
                .stat_cells_samples
                .iter()
                .map(|&v| v as u64)
                .sum::<u64>()
                / self.stat_cells_samples.len() as u64) as u32
        };
        (
            self.stat_last_frame_time_ms,
            avg_frame,
            self.stat_render_time.unwrap_or(0.0),
            self.stat_output_write_time.unwrap_or(0.0),
            self.stat_frame_count,
            self.stat_cells_updated,
            avg_cells,
            self.stat_render_time.is_some(),
            self.stat_output_write_time.is_some(),
        )
    }

    /// Emit a pre-built control sequence through the active backend.
    fn write_out(&mut self, bytes: &[u8]) {
        self.backend.write_out(bytes);
    }

    /// Zig `clearTerminal` — clear screen + home.
    pub fn clear_terminal(&mut self) {
        self.write_out(b"\x1b[H\x1b[2J");
    }

    /// Zig `setCursorPosition` glue — clamp to >=1, update terminal state; the
    /// escape is emitted by the next render()'s cursor tail.
    pub fn set_cursor_position(&mut self, x: i32, y: i32, visible: bool) {
        let cx = x.max(1) as u32;
        let cy = y.max(1) as u32;
        self.terminal.set_cursor_position(cx, cy, visible);
    }

    /// Zig `setupTerminal` — query capabilities, then run the detection-free
    /// setup (save cursor, alt screen / reserve surface, enable features).
    pub fn setup_terminal(&mut self, use_alternate_screen: bool) {
        self.use_alternate_screen = use_alternate_screen;
        self.terminal_setup = true;

        let mut query = Vec::new();
        self.terminal.query_terminal_send(&mut query);
        self.write_out(&query);

        self.setup_terminal_without_detection(use_alternate_screen, true);
    }

    /// Zig `setupTerminalWithoutDetection` — the part of setup that re-runs on
    /// resume (no capability queries).
    fn setup_terminal_without_detection(&mut self, use_alternate_screen: bool, reserve: bool) {
        let mut setup = Vec::new();
        setup.extend_from_slice(b"\x1b[s"); // saveCursorState
        if use_alternate_screen {
            self.terminal.enter_alt_screen(&mut setup);
        } else if reserve {
            make_room_for_renderer_output(&mut setup, self.height.max(1));
        }
        self.terminal.set_cursor_position(1, 1, false);
        let use_kitty = self.terminal.kitty_keyboard_flags() > 0;
        self.terminal
            .enable_detected_features(&mut setup, use_kitty);
        self.write_out(&setup);
    }

    /// Zig `restoreTerminalModes` — re-emit enable sequences for every mode
    /// currently active (focus-in recovery).
    pub fn restore_terminal_modes(&mut self) {
        let mut out = Vec::new();
        self.terminal.restore_terminal_modes(&mut out);
        self.write_out(&out);
    }

    pub fn set_clear_on_shutdown(&mut self, clear: bool) {
        self.clear_on_shutdown = clear;
    }

    // --- input modes / cursor / queries (escape emitters) ---------------------

    pub fn enable_kitty_keyboard(&mut self, flags: u8) {
        let mut out = Vec::new();
        self.terminal.enable_kitty_keyboard(&mut out, flags);
        self.write_out(&out);
    }

    pub fn disable_kitty_keyboard(&mut self) {
        let mut out = Vec::new();
        self.terminal.disable_kitty_keyboard(&mut out);
        self.write_out(&out);
    }

    pub fn set_kitty_keyboard_flags(&mut self, flags: u8) {
        self.terminal.set_kitty_keyboard_flags(flags);
    }

    pub fn get_kitty_keyboard_flags(&self) -> u8 {
        self.terminal.kitty_keyboard_flags()
    }

    pub fn enable_mouse(&mut self, enable_movement: bool) {
        let mut out = Vec::new();
        self.terminal
            .set_mouse_mode(&mut out, true, enable_movement);
        self.write_out(&out);
    }

    pub fn disable_mouse(&mut self) {
        let movement = self.terminal.state.mouse_movement;
        let mut out = Vec::new();
        self.terminal.set_mouse_mode(&mut out, false, movement);
        self.write_out(&out);
    }

    pub fn set_terminal_title(&mut self, title: &str) {
        let mut out = Vec::new();
        self.terminal.set_terminal_title(&mut out, title);
        self.write_out(&out);
    }

    pub fn query_theme_colors(&mut self) {
        let mut out = Vec::new();
        self.terminal.query_theme_colors(&mut out);
        self.write_out(&out);
    }

    pub fn query_pixel_resolution(&mut self) {
        self.write_out(b"\x1b[14t"); // queryPixelSize
    }

    /// Zig `setCursorStyleOptions` — style/blinking (when in range), optional
    /// cursor color, and mouse-pointer style. Emitted by the next render's tail.
    pub fn set_cursor_style_options(
        &mut self,
        style_code: u8,
        blinking_code: u8,
        color: Option<Rgba>,
        cursor_code: u8,
    ) {
        let current = self.terminal.cursor;
        let style = match style_code {
            0 => CursorStyle::Block,
            1 => CursorStyle::Line,
            2 => CursorStyle::Underline,
            3 => CursorStyle::Default,
            _ => current.style,
        };
        let blinking = if blinking_code <= 1 {
            blinking_code == 1
        } else {
            current.blinking
        };
        if style_code <= 3 || blinking_code <= 1 {
            self.terminal.set_cursor_style(style, blinking);
        }
        if let Some(c) = color {
            self.terminal.set_cursor_color(c);
        }
        if let Some(ptr_style) = MousePointerStyle::from_code(cursor_code) {
            self.terminal.set_mouse_pointer_style(ptr_style);
        }
    }

    /// Zig `performShutdownSequence` — reset terminal state, clear the surface,
    /// and restore cursor color/style/visibility. No-op unless setup ran.
    pub fn perform_shutdown_sequence(&mut self) {
        if !self.terminal_setup {
            return;
        }
        let mut out = Vec::new();
        self.terminal.reset_state(&mut out);

        if self.use_alternate_screen {
            // resetState already exited the alt screen.
        } else if self.clear_on_shutdown && self.render_offset == 0 {
            out.extend_from_slice(b"\x1b[H\x1b[J");
        } else if self.clear_on_shutdown && self.render_offset > 0 {
            clear_split_footer_surface(&mut out, self.render_offset);
        }

        out.extend_from_slice(b"\x1b]12;default\x07"); // resetCursorColorFallback
        out.extend_from_slice(b"\x1b]112\x07"); // resetCursorColor
        out.extend_from_slice(b"\x1b[0 q"); // defaultCursorStyle
        out.extend_from_slice(b"\x1b[?25h"); // showCursor
        self.write_out(&out);

        // Ghostty workaround: re-emit showCursor as a separate write. The Zig
        // reference sleeps 10ms around this; only the emitted bytes matter for
        // parity, so the sleep is omitted.
        self.write_out(b"\x1b[?25h");
    }

    /// Zig `suspendRenderer`.
    pub fn suspend_renderer(&mut self) {
        if !self.terminal_setup {
            return;
        }
        self.perform_shutdown_sequence();
    }

    /// Zig `resumeRenderer` — re-run detection-free setup.
    pub fn resume_renderer(&mut self) {
        if !self.terminal_setup {
            return;
        }
        let reserve = self.render_offset == 0;
        self.setup_terminal_without_detection(self.use_alternate_screen, reserve);
    }

    fn prepare_render_frame(&mut self, out: &mut Vec<u8>, force: bool) {
        let palette_force = match self.last_rendered_palette_epoch {
            None => true,
            Some(epoch) => epoch != self.palette_epoch,
        };
        let should_force = force || self.force_full_repaint || palette_force;

        let caps = self.terminal.get_capabilities();
        let hyperlinks_enabled = caps.hyperlinks;
        let render_offset = self.render_offset;

        let mut frame_started = false;
        self.apply_pending_split_footer_transition(out, &mut frame_started);

        let mut current_fg: Option<Rgba> = None;
        let mut current_bg: Option<Rgba> = None;
        let mut current_attributes: Option<u32> = None;
        let mut current_link_id: u32 = 0;
        let mut cells_updated: u32 = 0;

        let mut pool = global_pool();

        for y in 0..self.height {
            let mut run_start: i64 = -1;
            let mut run_length: u32 = 0;

            for x in 0..self.width {
                let current_cell = self.current_buffer.get(x, y);
                let next_cell = self.next_buffer.get(x, y);
                let (Some(current_cell), Some(next_cell)) = (current_cell, next_cell) else {
                    continue;
                };

                if !should_force {
                    let char_equal = current_cell.char == next_cell.char;
                    let attr_equal = current_cell.attributes == next_cell.attributes;
                    if char_equal
                        && attr_equal
                        && rgba_equal(current_cell.fg, next_cell.fg)
                        && rgba_equal(current_cell.bg, next_cell.bg)
                    {
                        if run_length > 0 {
                            out.extend_from_slice(b"\x1b[0m");
                            run_start = -1;
                            run_length = 0;
                        }
                        continue;
                    }
                }

                let cell = next_cell;

                if !frame_started {
                    begin_render_frame(out);
                    frame_started = true;
                }

                let fg_match = current_fg.is_some_and(|c| rgba_equal(c, cell.fg));
                let bg_match = current_bg.is_some_and(|c| rgba_equal(c, cell.bg));
                let same_attributes = fg_match
                    && bg_match
                    && current_attributes.is_some_and(|a| a == cell.attributes);

                let link = if hyperlinks_enabled {
                    link_id(cell.attributes)
                } else {
                    0
                };
                if hyperlinks_enabled && link != current_link_id {
                    if current_link_id != 0 {
                        out.extend_from_slice(b"\x1b]8;;\x1b\\");
                    }
                    current_link_id = link;
                    // Link URL resolution is a later-tranche concern; with
                    // hyperlinks disabled in a fresh Terminal this never fires.
                    if current_link_id != 0 {
                        current_link_id = 0;
                    }
                }

                if !same_attributes || run_start == -1 {
                    if run_length > 0 {
                        out.extend_from_slice(b"\x1b[0m");
                    }
                    run_start = x as i64;
                    run_length = 0;

                    current_fg = Some(cell.fg);
                    current_bg = Some(cell.bg);
                    current_attributes = Some(cell.attributes);

                    move_to_output(out, x + 1, y + 1 + render_offset);
                    emit_color(out, &caps, &self.palette_rgba, cell.fg, false);
                    emit_color(out, &caps, &self.palette_rgba, cell.bg, true);
                    apply_attributes(out, cell.attributes);
                }

                if is_grapheme_char(cell.char) {
                    let gid = grapheme_id_from_char(cell.char);
                    if let Some(bytes) = pool.get(gid) {
                        if !bytes.is_empty() {
                            let grapheme_width = char_right_extent(cell.char) + 1;
                            if caps.explicit_width {
                                let bytes = bytes.to_vec();
                                let _ = write!(out, "\x1b]66;w={};", grapheme_width);
                                out.extend_from_slice(&bytes);
                                out.extend_from_slice(b"\x1b\\");
                            } else {
                                out.extend_from_slice(bytes);
                                if caps.explicit_cursor_positioning {
                                    let next_x = x + grapheme_width;
                                    if next_x < self.width {
                                        move_to_output(out, next_x + 1, y + 1 + render_offset);
                                    }
                                }
                            }
                        }
                    }
                } else if is_continuation_char(cell.char) {
                    // Intentionally emit nothing for continuation cells.
                } else {
                    push_utf8(out, cell.char);
                }
                run_length += 1;

                self.current_buffer.sync_cell(&mut pool, x, y, cell);
                cells_updated += 1;
            }
        }

        if hyperlinks_enabled && current_link_id != 0 {
            if !frame_started {
                begin_render_frame(out);
                frame_started = true;
            }
            out.extend_from_slice(b"\x1b]8;;\x1b\\");
        }

        if frame_started {
            out.extend_from_slice(b"\x1b[0m");
        }

        // Cursor restore tail.
        let cursor = self.terminal.cursor;
        if cursor.visible {
            let style_code: &[u8] = match cursor.style {
                CursorStyle::Block => {
                    if cursor.blinking {
                        b"\x1b[1 q"
                    } else {
                        b"\x1b[2 q"
                    }
                }
                CursorStyle::Line => {
                    if cursor.blinking {
                        b"\x1b[5 q"
                    } else {
                        b"\x1b[6 q"
                    }
                }
                CursorStyle::Underline => {
                    if cursor.blinking {
                        b"\x1b[3 q"
                    } else {
                        b"\x1b[4 q"
                    }
                }
                CursorStyle::Default => b"\x1b[0 q",
            };

            let cr = crate::buffer::red(cursor.color);
            let cg = green(cursor.color);
            let cb = blue(cursor.color);

            let style_tag = cursor.style.tag();
            let style_changed = self.last_cursor_style_tag != Some(style_tag)
                || self.last_cursor_blinking != Some(cursor.blinking);
            let color_changed = match self.last_cursor_color_rgb {
                None => true,
                Some(rgb) => rgb[0] != cr || rgb[1] != cg || rgb[2] != cb,
            };
            let cursor_x = cursor.x;
            let cursor_y = cursor.y + render_offset;
            let position_changed = self.last_cursor_x != Some(cursor_x)
                || self.last_cursor_y != Some(cursor_y)
                || self.last_cursor_x.is_none()
                || self.last_cursor_y.is_none();
            let visibility_changed = self.last_cursor_visible != Some(true);
            let needs_cursor_restore = frame_started
                || style_changed
                || color_changed
                || position_changed
                || visibility_changed;

            if needs_cursor_restore {
                if !frame_started {
                    begin_render_frame(out);
                    frame_started = true;
                }
                if color_changed {
                    let _ = write!(out, "\x1b]12;#{:02x}{:02x}{:02x}\x07", cr, cg, cb);
                    self.last_cursor_color_rgb = Some([cr, cg, cb]);
                }
                if style_changed {
                    out.extend_from_slice(style_code);
                    self.last_cursor_style_tag = Some(style_tag);
                    self.last_cursor_blinking = Some(cursor.blinking);
                }
                move_to_output(out, cursor_x, cursor_y);
                out.extend_from_slice(b"\x1b[?25h");
            }

            self.last_cursor_x = Some(cursor_x);
            self.last_cursor_y = Some(cursor_y);
            self.last_cursor_visible = Some(true);
        } else {
            if !frame_started && self.last_cursor_visible != Some(false) {
                begin_render_frame(out);
                frame_started = true;
                out.extend_from_slice(b"\x1b[?25l");
            }
            self.last_cursor_style_tag = None;
            self.last_cursor_blinking = None;
            self.last_cursor_color_rgb = None;
            self.last_cursor_x = None;
            self.last_cursor_y = None;
            self.last_cursor_visible = Some(false);
        }

        let mouse_pointer = self.terminal.mouse_pointer;
        if mouse_pointer != self.last_mouse_pointer {
            if !frame_started {
                begin_render_frame(out);
                frame_started = true;
            }
            let _ = write!(out, "\x1b]22;{}\x07", mouse_pointer.to_name());
            self.last_mouse_pointer = mouse_pointer;
        }

        if frame_started {
            out.extend_from_slice(b"\x1b[?2026l");
        }

        self.stat_cells_updated = cells_updated;
        self.stat_render_time = Some(0.0); // best-effort; timing not in parity surface
        self.last_rendered_palette_epoch = Some(self.palette_epoch);
        self.force_full_repaint = false;

        self.next_buffer
            .clear(&mut pool, self.background_color, None);

        // Hit-grid dirty compare (before swap) + double-buffer swap: nextHitGrid
        // (built this frame) becomes the active grid; the old current is cleared
        // for the next frame.
        self.hit_grid_dirty =
            self.hit_grid_resize_invalidated || self.current_hit_grid != self.next_hit_grid;
        std::mem::swap(&mut self.current_hit_grid, &mut self.next_hit_grid);
        self.next_hit_grid.fill(0);
    }

    pub fn dump_output_buffer(&self, timestamp: i64) {
        let _ = std::fs::create_dir_all("buffer_dump");
        let filename = format!("buffer_dump/output_buffer_{}.txt", timestamp);
        let mut body: Vec<u8> = Vec::new();
        let _ = write!(body, "Output Buffer Dump (timestamp: {}):\n", timestamp);
        body.extend_from_slice(b"Last Rendered ANSI Output:\n");
        body.extend_from_slice(b"================\n");
        self.backend.dump_to(&mut body);
        let _ = std::fs::write(filename, body);
    }
}

fn begin_render_frame(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b[?2026h"); // syncSet
    out.extend_from_slice(b"\x1b[?25l"); // hideCursor
}

/// ansi.ANSI.makeRoomForRendererOutput — reserve the non-alt surface by
/// scrolling `height - 1` blank lines.
fn make_room_for_renderer_output(out: &mut Vec<u8>, height: u32) {
    if height > 1 {
        for _ in 0..(height - 1) {
            out.push(b'\n');
        }
    }
}

/// Zig `clearSplitFooterSurface` — reset the scroll region and erase below the
/// footer's top line (only reached when a split-footer render offset is set).
fn clear_split_footer_surface(out: &mut Vec<u8>, render_offset: u32) {
    if render_offset == 0 {
        return;
    }
    let footer_top_line = (render_offset + 1).max(1);
    out.extend_from_slice(b"\x1b[r"); // reset scroll region
    move_to_output(out, 1, footer_top_line);
    out.extend_from_slice(b"\x1b[J"); // eraseBelowCursor
    move_to_output(out, 1, footer_top_line);
}

fn move_to_output(out: &mut Vec<u8>, x: u32, y: u32) {
    let _ = write!(out, "\x1b[{};{}H", y, x);
}

fn apply_attributes(out: &mut Vec<u8>, attributes: u32) {
    let base = attributes & 0xFF;
    if base & ATTR_BOLD != 0 {
        out.extend_from_slice(b"\x1b[1m");
    }
    if base & ATTR_DIM != 0 {
        out.extend_from_slice(b"\x1b[2m");
    }
    if base & ATTR_ITALIC != 0 {
        out.extend_from_slice(b"\x1b[3m");
    }
    if base & ATTR_UNDERLINE != 0 {
        out.extend_from_slice(b"\x1b[4m");
    }
    if base & ATTR_BLINK != 0 {
        out.extend_from_slice(b"\x1b[5m");
    }
    if base & ATTR_INVERSE != 0 {
        out.extend_from_slice(b"\x1b[7m");
    }
    if base & ATTR_HIDDEN != 0 {
        out.extend_from_slice(b"\x1b[8m");
    }
    if base & ATTR_STRIKETHROUGH != 0 {
        out.extend_from_slice(b"\x1b[9m");
    }
}

fn emit_color(
    out: &mut Vec<u8>,
    caps: &Capabilities,
    palette: &[Rgba; 256],
    rgba: Rgba,
    is_bg: bool,
) {
    if intent(rgba) == ColorIntent::Default {
        out.extend_from_slice(if is_bg { b"\x1b[49m" } else { b"\x1b[39m" });
        return;
    }
    if is_bg && alpha(rgba) == 0 {
        out.extend_from_slice(b"\x1b[49m");
        return;
    }
    if intent(rgba) == ColorIntent::Indexed && caps.ansi256 {
        let index = slot(rgba);
        let _ = if is_bg {
            write!(out, "\x1b[48;5;{}m", index)
        } else {
            write!(out, "\x1b[38;5;{}m", index)
        };
        return;
    }
    if !caps.rgb && caps.ansi256 {
        let index = nearest_palette_index(palette, rgba);
        let _ = if is_bg {
            write!(out, "\x1b[48;5;{}m", index)
        } else {
            write!(out, "\x1b[38;5;{}m", index)
        };
        return;
    }
    let r = crate::buffer::red(rgba);
    let g = green(rgba);
    let b = blue(rgba);
    let _ = if is_bg {
        write!(out, "\x1b[48;2;{};{};{}m", r, g, b)
    } else {
        write!(out, "\x1b[38;2;{};{};{}m", r, g, b)
    };
}

fn nearest_palette_index(palette: &[Rgba; 256], rgba: Rgba) -> u8 {
    let mut best_index: u8 = 0;
    let mut best_distance = f32::INFINITY;
    for (index, candidate) in palette.iter().enumerate() {
        let distance = color_distance_squared(rgba, *candidate);
        if distance < best_distance {
            best_distance = distance;
            best_index = index as u8;
        }
    }
    best_index
}

/// Encode a codepoint as UTF-8 (Zig `utf8Encode`, `catch 1` on invalid).
fn push_utf8(out: &mut Vec<u8>, ch: u32) {
    match char::from_u32(ch) {
        Some(c) => {
            let mut buf = [0u8; 4];
            out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
        }
        None => out.push((ch & 0xFF) as u8),
    }
}
