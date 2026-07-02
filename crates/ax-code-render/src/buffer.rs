//! ADR-046 Slice B — OptimizedBuffer cell-buffer core, transliterated from
//! the Zig reference (`buffer.zig` + `ansi.zig`, opentui v0.4.1).
//!
//! Tranche 1 scope: planes, clear/set/get, alpha-blended set (bit-exact
//! integer blending: mulDiv255 with +127 rounding), fillRect fast paths,
//! scissor stack (push intersects with the current top), multiplicative
//! opacity stack, resize (realloc + clear to opaque black), and zero-copy
//! plane exposure. Grapheme spans and hyperlink tracking land with the pool
//! in the next tranche — cells written through this tranche must be simple
//! (no 0x8/0xC flag bits in the char plane), which the differential harness
//! guarantees.
//!
//! RGBA is `[4]u16`: each lane keeps the 8-bit channel in the low byte and
//! one byte of a 32-bit metadata word in the high byte (meta bits 0-7 =
//! palette slot, bits 8-9 = ColorIntent rgb/indexed/default).

pub type Rgba = [u16; 4];

pub const DEFAULT_SPACE_CHAR: u32 = 32;

// --- RGBA lane helpers (ansi.zig) --------------------------------------------

#[inline]
fn chan(c: Rgba, i: usize) -> u32 {
    (c[i] & 0xFF) as u32
}
#[inline]
pub fn alpha(c: Rgba) -> u32 {
    chan(c, 3)
}

pub fn get_meta(c: Rgba) -> u32 {
    ((c[0] >> 8) as u32)
        | (((c[1] >> 8) as u32) << 8)
        | (((c[2] >> 8) as u32) << 16)
        | (((c[3] >> 8) as u32) << 24)
}

pub fn pack_rgba8(r: u8, g: u8, b: u8, a: u8, meta: u32) -> Rgba {
    [
        (r as u16) | (((meta & 0xFF) as u16) << 8),
        (g as u16) | ((((meta >> 8) & 0xFF) as u16) << 8),
        (b as u16) | ((((meta >> 16) & 0xFF) as u16) << 8),
        (a as u16) | ((((meta >> 24) & 0xFF) as u16) << 8),
    ]
}

/// ansi.rgbColor: literal RGB intent (meta = 0).
pub fn rgb_color(r: u8, g: u8, b: u8, a: u8) -> Rgba {
    pack_rgba8(r, g, b, a, 0)
}

// --- attributes (ansi.TextAttributes): low 8 bits = base, bits 8..31 = link id

pub fn link_id(attr: u32) -> u32 {
    (attr & (0x00FF_FFFF << 8)) >> 8
}
pub fn base_attributes(attr: u32) -> u32 {
    attr & 0xFF
}
pub fn with_link_id(base: u32, link: u32) -> u32 {
    (base & 0xFF) | ((link & 0x00FF_FFFF) << 8)
}

// --- grapheme char plane flags (grapheme.zig) ---------------------------------

pub const CHAR_FLAG_GRAPHEME: u32 = 0x8000_0000;
pub const CHAR_FLAG_CONTINUATION: u32 = 0xC000_0000;
const CHAR_EXT_RIGHT_SHIFT: u32 = 28;
const CHAR_EXT_LEFT_SHIFT: u32 = 26;
const CHAR_EXT_MASK: u32 = 0x3;

pub fn is_continuation_char(c: u32) -> bool {
    (c & 0xC000_0000) == CHAR_FLAG_CONTINUATION
}
pub fn is_grapheme_char(c: u32) -> bool {
    (c & 0xC000_0000) == CHAR_FLAG_GRAPHEME
}
fn char_right_extent(c: u32) -> u32 {
    (c >> CHAR_EXT_RIGHT_SHIFT) & CHAR_EXT_MASK
}
fn char_left_extent(c: u32) -> u32 {
    (c >> CHAR_EXT_LEFT_SHIFT) & CHAR_EXT_MASK
}

pub fn encoded_char_width(c: u32) -> u32 {
    if is_continuation_char(c) {
        char_left_extent(c) + 1 + char_right_extent(c)
    } else if is_grapheme_char(c) {
        char_right_extent(c) + 1
    } else {
        1
    }
}

// --- blending math (buffer.zig, bit-exact integer ops) ------------------------

#[inline]
fn mul_div_255(a: u32, b: u32) -> u32 {
    (a * b + 127) / 255
}

#[inline]
fn round_div(n: u32, d: u32) -> u8 {
    ((n + d / 2) / d) as u8
}

fn is_rgba_with_alpha(c: Rgba) -> bool {
    alpha(c) < 255
}

fn is_fully_opaque(opacity: f32, fg: Rgba, bg: Rgba) -> bool {
    opacity == 1.0 && !is_rgba_with_alpha(fg) && !is_rgba_with_alpha(bg)
}

fn is_fully_transparent(opacity: f32, fg: Rgba, bg: Rgba) -> bool {
    opacity == 0.0 || (alpha(fg) == 0 && alpha(bg) == 0)
}

fn blend_colors(src: Rgba, dst0: Rgba, backdrop: Option<Rgba>) -> Rgba {
    let sa = alpha(src);
    if sa == 0 {
        return dst0;
    }
    let dst = if alpha(dst0) == 0 {
        backdrop.unwrap_or(dst0)
    } else {
        dst0
    };
    if sa == 255 {
        return rgb_color(
            chan(src, 0) as u8,
            chan(src, 1) as u8,
            chan(src, 2) as u8,
            255,
        );
    }
    let da = alpha(dst);
    let inv = 255 - sa;
    let out_a = sa + mul_div_255(da, inv);
    if out_a == 0 {
        return rgb_color(0, 0, 0, 0);
    }
    if da == 255 {
        return rgb_color(
            ((chan(src, 0) * sa + chan(dst, 0) * inv + 127) / 255) as u8,
            ((chan(src, 1) * sa + chan(dst, 1) * inv + 127) / 255) as u8,
            ((chan(src, 2) * sa + chan(dst, 2) * inv + 127) / 255) as u8,
            255,
        );
    }
    rgb_color(
        round_div(
            chan(src, 0) * sa + mul_div_255(chan(dst, 0) * da, inv),
            out_a,
        ),
        round_div(
            chan(src, 1) * sa + mul_div_255(chan(dst, 1) * da, inv),
            out_a,
        ),
        round_div(
            chan(src, 2) * sa + mul_div_255(chan(dst, 2) * da, inv),
            out_a,
        ),
        out_a as u8,
    )
}

fn opacity_to_u8(opacity: f32) -> u8 {
    // ansi.rgbaComponentToU8
    if !opacity.is_finite() {
        return 0;
    }
    (opacity.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn apply_opacity(color: Rgba, opacity: u8) -> Rgba {
    pack_rgba8(
        chan(color, 0) as u8,
        chan(color, 1) as u8,
        chan(color, 2) as u8,
        mul_div_255(alpha(color), opacity as u32) as u8,
        get_meta(color),
    )
}

// --- OptimizedBuffer -----------------------------------------------------------

#[derive(Clone, Copy)]
pub struct Cell {
    pub char: u32,
    pub fg: Rgba,
    pub bg: Rgba,
    pub attributes: u32,
}

#[derive(Clone, Copy)]
struct ClipRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

pub struct OptimizedBuffer {
    pub char: Vec<u32>,
    pub fg: Vec<Rgba>,
    pub bg: Vec<Rgba>,
    pub attributes: Vec<u32>,
    pub width: u32,
    pub height: u32,
    pub respect_alpha: bool,
    blend_backdrop: Option<Rgba>,
    scissor_stack: Vec<ClipRect>,
    opacity_stack: Vec<f32>,
    pub id: Vec<u8>,
    pub width_method: u32,
}

impl OptimizedBuffer {
    pub fn new(
        width: u32,
        height: u32,
        respect_alpha: bool,
        width_method: u32,
        id: Vec<u8>,
    ) -> Option<OptimizedBuffer> {
        if width == 0 || height == 0 {
            return None;
        }
        let size = (width * height) as usize;
        Some(OptimizedBuffer {
            char: vec![0; size],
            fg: vec![rgb_color(0, 0, 0, 0); size],
            bg: vec![rgb_color(0, 0, 0, 0); size],
            attributes: vec![0; size],
            width,
            height,
            respect_alpha,
            blend_backdrop: None,
            scissor_stack: Vec::new(),
            opacity_stack: Vec::new(),
            id,
            width_method,
        })
    }

    fn index(&self, x: u32, y: u32) -> usize {
        (y * self.width + x) as usize
    }

    fn current_scissor(&self) -> Option<ClipRect> {
        self.scissor_stack.last().copied()
    }

    fn point_in_scissor(&self, x: i32, y: i32) -> bool {
        let Some(s) = self.current_scissor() else {
            return true;
        };
        x >= s.x && x < s.x + s.width as i32 && y >= s.y && y < s.y + s.height as i32
    }

    fn rect_in_scissor(&self, x: i32, y: i32, width: u32, height: u32) -> bool {
        let Some(s) = self.current_scissor() else {
            return true;
        };
        let rect_end_x = x + width as i32;
        let rect_end_y = y + height as i32;
        let s_end_x = s.x + s.width as i32;
        let s_end_y = s.y + s.height as i32;
        !(x >= s_end_x || rect_end_x <= s.x || y >= s_end_y || rect_end_y <= s.y)
    }

    fn clip_rect_to_scissor(&self, x: i32, y: i32, width: u32, height: u32) -> Option<ClipRect> {
        let Some(s) = self.current_scissor() else {
            return Some(ClipRect {
                x,
                y,
                width,
                height,
            });
        };
        let rect_end_x = x + width as i32;
        let rect_end_y = y + height as i32;
        let s_end_x = s.x + s.width as i32;
        let s_end_y = s.y + s.height as i32;
        let ix = x.max(s.x);
        let iy = y.max(s.y);
        let iex = rect_end_x.min(s_end_x);
        let iey = rect_end_y.min(s_end_y);
        if ix >= iex || iy >= iey {
            return None;
        }
        Some(ClipRect {
            x: ix,
            y: iy,
            width: (iex - ix) as u32,
            height: (iey - iy) as u32,
        })
    }

    pub fn push_scissor_rect(&mut self, x: i32, y: i32, width: u32, height: u32) {
        let rect = if self.current_scissor().is_some() {
            self.clip_rect_to_scissor(x, y, width, height)
                .unwrap_or(ClipRect {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                })
        } else {
            ClipRect {
                x,
                y,
                width,
                height,
            }
        };
        self.scissor_stack.push(rect);
    }

    pub fn pop_scissor_rect(&mut self) {
        self.scissor_stack.pop();
    }

    pub fn clear_scissor_rects(&mut self) {
        self.scissor_stack.clear();
    }

    pub fn current_opacity(&self) -> f32 {
        *self.opacity_stack.last().unwrap_or(&1.0)
    }

    pub fn push_opacity(&mut self, opacity: f32) {
        let effective = self.current_opacity() * opacity.clamp(0.0, 1.0);
        self.opacity_stack.push(effective);
    }

    pub fn pop_opacity(&mut self) {
        self.opacity_stack.pop();
    }

    pub fn clear_opacity(&mut self) {
        self.opacity_stack.clear();
    }

    pub fn clear(&mut self, bg: Rgba, char: Option<u32>) {
        let cell_char = char.unwrap_or(DEFAULT_SPACE_CHAR);
        self.char.fill(cell_char);
        self.attributes.fill(0);
        self.fg.fill(rgb_color(255, 255, 255, 255));
        self.bg.fill(bg);
    }

    fn validate_and_index(&self, x: u32, y: u32) -> Option<usize> {
        if x >= self.width || y >= self.height {
            return None;
        }
        if !self.point_in_scissor(x as i32, y as i32) {
            return None;
        }
        Some(self.index(x, y))
    }

    fn write_cell(&mut self, index: usize, cell: Cell) {
        // Tranche 1: link tracker ref-counting is deferred with the pool.
        self.char[index] = cell.char;
        self.fg[index] = cell.fg;
        self.bg[index] = cell.bg;
        self.attributes[index] = cell.attributes;
    }

    pub fn get(&self, x: u32, y: u32) -> Option<Cell> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let index = self.index(x, y);
        Some(Cell {
            char: self.char[index],
            fg: self.fg[index],
            bg: self.bg[index],
            attributes: self.attributes[index],
        })
    }

    /// Zig `set` (setInternal with span cleanup). Grapheme spans are a
    /// tranche-2 concern; simple cells reduce to a plane write.
    pub fn set(&mut self, x: u32, y: u32, cell: Cell) {
        let Some(index) = self.validate_and_index(x, y) else {
            return;
        };
        debug_assert!(
            !is_grapheme_char(self.char[index]) && !is_continuation_char(self.char[index]),
            "grapheme spans are tranche 2"
        );
        self.write_cell(index, cell);
    }

    fn blend_cells(&self, overlay: Cell, dest: Cell) -> Cell {
        let has_bg_alpha = is_rgba_with_alpha(overlay.bg);
        let has_fg_alpha = is_rgba_with_alpha(overlay.fg);
        if !(has_bg_alpha || has_fg_alpha) {
            return overlay;
        }
        let blended_bg = if has_bg_alpha {
            blend_colors(overlay.bg, dest.bg, self.blend_backdrop)
        } else {
            overlay.bg
        };
        let preserve_char = overlay.char == DEFAULT_SPACE_CHAR
            && dest.char != 0
            && dest.char != DEFAULT_SPACE_CHAR
            && encoded_char_width(dest.char) == 1;
        let final_char = if preserve_char {
            dest.char
        } else {
            overlay.char
        };
        let final_fg = if preserve_char {
            blend_colors(overlay.bg, dest.fg, self.blend_backdrop)
        } else if has_fg_alpha {
            blend_colors(overlay.fg, blended_bg, self.blend_backdrop)
        } else {
            overlay.fg
        };
        let base = if preserve_char {
            base_attributes(dest.attributes)
        } else {
            base_attributes(overlay.attributes)
        };
        let final_attributes = with_link_id(base, link_id(overlay.attributes));
        Cell {
            char: final_char,
            fg: final_fg,
            bg: blended_bg,
            attributes: final_attributes,
        }
    }

    pub fn set_cell_with_alpha_blending(&mut self, x: u32, y: u32, cell: Cell) {
        if !self.point_in_scissor(x as i32, y as i32) {
            return;
        }
        let opacity = self.current_opacity();
        if is_fully_transparent(opacity, cell.fg, cell.bg) {
            return;
        }
        if is_fully_opaque(opacity, cell.fg, cell.bg) {
            self.set(x, y, cell);
            return;
        }
        let o = opacity_to_u8(opacity);
        let effective = Cell {
            char: cell.char,
            fg: apply_opacity(cell.fg, o),
            bg: apply_opacity(cell.bg, o),
            attributes: cell.attributes,
        };
        match self.get(x, y) {
            Some(dest) => {
                let blended = self.blend_cells(effective, dest);
                self.set(x, y, blended);
            }
            None => self.set(x, y, effective),
        }
    }

    /// Raw variant: same math, plane writes without span/tracker upkeep.
    pub fn set_cell_with_alpha_blending_raw(&mut self, x: u32, y: u32, cell: Cell) {
        if !self.point_in_scissor(x as i32, y as i32) {
            return;
        }
        let opacity = self.current_opacity();
        if is_fully_transparent(opacity, cell.fg, cell.bg) {
            return;
        }
        if is_fully_opaque(opacity, cell.fg, cell.bg) {
            if let Some(index) = self.validate_and_index(x, y) {
                self.write_cell(index, cell);
            }
            return;
        }
        let o = opacity_to_u8(opacity);
        let effective = Cell {
            char: cell.char,
            fg: apply_opacity(cell.fg, o),
            bg: apply_opacity(cell.bg, o),
            attributes: cell.attributes,
        };
        let final_cell = match self.get(x, y) {
            Some(dest) => self.blend_cells(effective, dest),
            None => effective,
        };
        if let Some(index) = self.validate_and_index(x, y) {
            self.write_cell(index, final_cell);
        }
    }

    pub fn fill_rect(&mut self, x: u32, y: u32, width: u32, height: u32, bg: Rgba) {
        if self.width == 0 || self.height == 0 || width == 0 || height == 0 {
            return;
        }
        if x >= self.width || y >= self.height {
            return;
        }
        if !self.rect_in_scissor(x as i32, y as i32, width, height) {
            return;
        }
        let opacity = self.current_opacity();
        if is_fully_transparent(opacity, rgb_color(0, 0, 0, 0), bg) {
            return;
        }
        let end_x = (self.width - 1).min(x + width - 1);
        let end_y = (self.height - 1).min(y + height - 1);
        if x > end_x || y > end_y {
            return;
        }
        let Some(clipped) =
            self.clip_rect_to_scissor(x as i32, y as i32, end_x - x + 1, end_y - y + 1)
        else {
            return;
        };
        let cs_x = x.max(clipped.x as u32);
        let cs_y = y.max(clipped.y as u32);
        let ce_x = end_x.min((clipped.x + clipped.width as i32 - 1) as u32);
        let ce_y = end_y.min((clipped.y + clipped.height as i32 - 1) as u32);

        let has_alpha = is_rgba_with_alpha(bg) || opacity < 1.0;
        // Tranche 1: grapheme/link trackers are always empty (matching the
        // reference when no graphemes/links were drawn), so the tracker-aware
        // slow path is unreachable.
        if has_alpha {
            for fy in cs_y..=ce_y {
                for fx in cs_x..=ce_x {
                    self.set_cell_with_alpha_blending_raw(
                        fx,
                        fy,
                        Cell {
                            char: DEFAULT_SPACE_CHAR,
                            fg: rgb_color(255, 255, 255, 255),
                            bg,
                            attributes: 0,
                        },
                    );
                }
            }
        } else {
            for fy in cs_y..=ce_y {
                let row_start = self.index(cs_x, fy);
                let row_width = (ce_x - cs_x + 1) as usize;
                self.char[row_start..row_start + row_width].fill(DEFAULT_SPACE_CHAR);
                self.fg[row_start..row_start + row_width].fill(rgb_color(255, 255, 255, 255));
                self.bg[row_start..row_start + row_width].fill(bg);
                self.attributes[row_start..row_start + row_width].fill(0);
            }
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if self.width == width && self.height == height {
            return;
        }
        if width == 0 || height == 0 {
            return;
        }
        let size = (width * height) as usize;
        self.char.resize(size, 0);
        self.fg.resize(size, rgb_color(0, 0, 0, 0));
        self.bg.resize(size, rgb_color(0, 0, 0, 0));
        self.attributes.resize(size, 0);
        self.width = width;
        self.height = height;
        // Zig clears after resize (realloc leaves garbage / shrink needs cleanup).
        self.clear(rgb_color(0, 0, 0, 255), None);
    }

    pub fn get_real_char_size(&self) -> u32 {
        // Tranche 1: no graphemes tracked, so the size is one unit per cell.
        self.width * self.height
    }
}
