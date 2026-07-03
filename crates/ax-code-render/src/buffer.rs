//! ADR-046 Slice B — OptimizedBuffer cell-buffer core, transliterated from
//! the Zig reference (`buffer.zig` + `ansi.zig`, opentui v0.4.1).
//!
//! Covers the buffer symbol family through tranche 3: planes, clear/set/get,
//! alpha-blended set (bit-exact integer blending — including the reference's
//! round_div overflow-to-256 flowing into u16 lanes), fillRect fast paths,
//! scissor/opacity stacks, resize, zero-copy plane exposure, grapheme spans
//! (setInternal span cleanup + continuation cells + trackers), drawText,
//! writeResolvedChars, drawBox (borders/titles/fill + transparent-border
//! fast path), drawFrameBuffer (memcpy fast path + grapheme/link-aware
//! blit), and hyperlink cell tracking. Still deferred: text/editor view
//! draws (slices C/D) and grid/supersample/grayscale/packed/colorMatrix
//! (tranche 4).
//!
//! RGBA is `[4]u16`: each lane keeps the 8-bit channel in the low byte and
//! one byte of a 32-bit metadata word in the high byte (meta bits 0-7 =
//! palette slot, bits 8-9 = ColorIntent rgb/indexed/default).

use crate::pool::{GraphemePool, GraphemeTracker, LinkTracker};

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

pub fn grapheme_id_from_char(c: u32) -> u32 {
    c & crate::pool::GRAPHEME_ID_MASK
}

/// Zig packGraphemeStart: the encoded extent is capped at 4 cells even when
/// the logical cluster width is larger (wcwidth ZWJ families).
pub fn pack_grapheme_start(gid: u32, total_width: u32) -> u32 {
    let right = (total_width - 1).min(CHAR_EXT_MASK);
    CHAR_FLAG_GRAPHEME
        | ((right & CHAR_EXT_MASK) << CHAR_EXT_RIGHT_SHIFT)
        | (gid & crate::pool::GRAPHEME_ID_MASK)
}

fn pack_continuation(left: u32, right: u32, gid: u32) -> u32 {
    CHAR_FLAG_CONTINUATION
        | ((left & CHAR_EXT_MASK) << CHAR_EXT_LEFT_SHIFT)
        | ((right & CHAR_EXT_MASK) << CHAR_EXT_RIGHT_SHIFT)
        | (gid & crate::pool::GRAPHEME_ID_MASK)
}

// --- blending math (buffer.zig, bit-exact integer ops) ------------------------

#[inline]
fn mul_div_255(a: u32, b: u32) -> u32 {
    (a * b + 127) / 255
}

#[inline]
fn round_div(n: u32, d: u32) -> u32 {
    // The Zig reference @intCasts this to u8, but its rounding can reach 256
    // (e.g. src a=128 over dst a=1) and the shipped ReleaseFast binary lets
    // the overflowed value flow into the u16 lane verbatim. Mirrored: the
    // caller stores the raw value as u16.
    (n + d / 2) / d
}

/// Lane-raw color build for the blend path: values may exceed 255 (see
/// round_div) and land in the u16 lanes unclamped, meta 0.
fn rgb_color_raw(r: u32, g: u32, b: u32, a: u32) -> Rgba {
    [
        (r & 0xFFFF) as u16,
        (g & 0xFFFF) as u16,
        (b & 0xFFFF) as u16,
        (a & 0xFFFF) as u16,
    ]
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
    rgb_color_raw(
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
        out_a,
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

// --- graphics helpers (buffer.zig tranche 4) -----------------------------------

const BLOCK_CHAR: u32 = 0x2588;
const GRAYSCALE_CHARS: &[u8] =
    b" .'^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

const QUADRANT_CHARS: [u32; 16] = [
    32, 0x2597, 0x2596, 0x2584, 0x259D, 0x2590, 0x259E, 0x259F, 0x2598, 0x259A, 0x258C, 0x2599,
    0x2580, 0x259C, 0x259B, 0x2588,
];

fn color_distance(a: Rgba, b: Rgba) -> f32 {
    let dr = chan(a, 0) as f32 - chan(b, 0) as f32;
    let dg = chan(a, 1) as f32 - chan(b, 1) as f32;
    let db = chan(a, 2) as f32 - chan(b, 2) as f32;
    dr * dr + dg * dg + db * db
}

fn closest_color_index(pixel: Rgba, candidates: [Rgba; 2]) -> usize {
    if color_distance(pixel, candidates[0]) <= color_distance(pixel, candidates[1]) {
        0
    } else {
        1
    }
}

fn average_color_rgba(pixels: &[Rgba]) -> Rgba {
    if pixels.is_empty() {
        return rgb_color(0, 0, 0, 0);
    }
    let (mut r, mut g, mut b, mut a) = (0u32, 0u32, 0u32, 0u32);
    for p in pixels {
        r += chan(*p, 0);
        g += chan(*p, 1);
        b += chan(*p, 2);
        a += alpha(*p);
    }
    let len = pixels.len() as u32;
    rgb_color(
        ((r + len / 2) / len) as u8,
        ((g + len / 2) / len) as u8,
        ((b + len / 2) / len) as u8,
        ((a + len / 2) / len) as u8,
    )
}

fn chan_f(c: Rgba, i: usize) -> f32 {
    chan(c, i) as f32 / 255.0
}

fn luminance(color: Rgba) -> f32 {
    0.2126 * chan_f(color, 0) + 0.7152 * chan_f(color, 1) + 0.0722 * chan_f(color, 2)
}

fn get_pixel_color(idx: usize, data: &[u8], bgra: bool) -> Rgba {
    if idx + 3 >= data.len() {
        return rgb_color(255, 0, 255, 0); // transparent magenta for out-of-bounds
    }
    if bgra {
        rgb_color(data[idx + 2], data[idx + 1], data[idx], data[idx + 3])
    } else {
        rgb_color(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])
    }
}

fn render_quadrant_block(pixels: [Rgba; 4]) -> (u32, Rgba, Rgba) {
    let mut idx_a = 0usize;
    let mut idx_b = 1usize;
    let mut max_dist = color_distance(pixels[0], pixels[1]);
    for i in 0..4 {
        for j in (i + 1)..4 {
            let dist = color_distance(pixels[i], pixels[j]);
            if dist > max_dist {
                idx_a = i;
                idx_b = j;
                max_dist = dist;
            }
        }
    }
    let (cand_a, cand_b) = (pixels[idx_a], pixels[idx_b]);
    let (dark, light) = if luminance(cand_a) <= luminance(cand_b) {
        (cand_a, cand_b)
    } else {
        (cand_b, cand_a)
    };

    let bit_values = [8u8, 4, 2, 1];
    let mut bits = 0u8;
    for i in 0..4 {
        if closest_color_index(pixels[i], [dark, light]) == 0 {
            bits |= bit_values[i];
        }
    }
    if bits == 0 {
        (32, dark, average_color_rgba(&pixels))
    } else if bits == 15 {
        (QUADRANT_CHARS[15], average_color_rgba(&pixels), light)
    } else {
        (QUADRANT_CHARS[bits as usize], dark, light)
    }
}

fn get_grayscale_char(intensity: f32) -> u32 {
    if intensity < 0.01 {
        return b' ' as u32;
    }
    let clamped = intensity.clamp(0.0, 1.0);
    let index = (clamped * (GRAYSCALE_CHARS.len() - 1) as f32) as usize;
    GRAYSCALE_CHARS[index] as u32
}

fn rgba_component_to_u8(v: f32) -> u8 {
    if !v.is_finite() {
        return 0;
    }
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn rgba_from_floats(r: f32, g: f32, b: f32, a: f32) -> Rgba {
    rgb_color(
        rgba_component_to_u8(r),
        rgba_component_to_u8(g),
        rgba_component_to_u8(b),
        rgba_component_to_u8(a),
    )
}

fn apply_matrix4x4(
    matrix: &[f32; 16],
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    strength: f32,
) -> (f32, f32, f32, f32) {
    let nr = matrix[0] * r + matrix[1] * g + matrix[2] * b + matrix[3] * a;
    let ng = matrix[4] * r + matrix[5] * g + matrix[6] * b + matrix[7] * a;
    let nb = matrix[8] * r + matrix[9] * g + matrix[10] * b + matrix[11] * a;
    let na = matrix[12] * r + matrix[13] * g + matrix[14] * b + matrix[15] * a;
    (
        r + (nr - r) * strength,
        g + (ng - g) * strength,
        b + (nb - b) * strength,
        a + (na - a) * strength,
    )
}

fn matrix_apply_to(color: Rgba, matrix: &[f32; 16], strength: f32) -> Rgba {
    let (r, g, b, a) = apply_matrix4x4(
        matrix,
        chan_f(color, 0),
        chan_f(color, 1),
        chan_f(color, 2),
        alpha(color) as f32 / 255.0,
        strength,
    );
    rgba_from_floats(r, g, b, a)
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
    pub tracker: GraphemeTracker,
    pub link_tracker: LinkTracker,
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
            tracker: GraphemeTracker::default(),
            link_tracker: LinkTracker::default(),
        })
    }

    fn index(&self, x: u32, y: u32) -> usize {
        (y * self.width + x) as usize
    }

    fn current_scissor(&self) -> Option<ClipRect> {
        self.scissor_stack.last().copied()
    }

    pub(crate) fn point_in_scissor(&self, x: i32, y: i32) -> bool {
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

    pub fn clear(&mut self, pool: &mut GraphemePool, bg: Rgba, char: Option<u32>) {
        let cell_char = char.unwrap_or(DEFAULT_SPACE_CHAR);
        self.link_tracker.clear();
        self.tracker.clear(pool);
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
        let prev_link_id = link_id(self.attributes[index]);
        let new_link_id = link_id(cell.attributes);
        self.char[index] = cell.char;
        self.fg[index] = cell.fg;
        self.bg[index] = cell.bg;
        self.attributes[index] = cell.attributes;
        if prev_link_id != 0 && prev_link_id != new_link_id {
            self.link_tracker.remove_cell_ref(prev_link_id);
        }
        if new_link_id != 0 && new_link_id != prev_link_id {
            self.link_tracker.add_cell_ref(new_link_id);
        }
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
    pub fn set(&mut self, pool: &mut GraphemePool, x: u32, y: u32, cell: Cell) {
        let Some(index) = self.validate_and_index(x, y) else {
            return;
        };
        let prev_char = self.char[index];
        // Zig captures this BEFORE span cleanup zeroes attributes; the
        // grapheme branch below uses this pre-cleanup value while the simple
        // path (write_cell) re-reads — mirrored asymmetry.
        let prev_link_id_at_entry = link_id(self.attributes[index]);
        let mut tracker_replaced = false;

        // Overwriting part of a grapheme span with a different char clears the span.
        if (is_grapheme_char(prev_char) || is_continuation_char(prev_char))
            && prev_char != cell.char
        {
            let row_start = (y * self.width) as usize;
            let row_end = row_start + self.width as usize - 1;
            let left = char_left_extent(prev_char) as usize;
            let right = char_right_extent(prev_char) as usize;
            let id = grapheme_id_from_char(prev_char);

            let new_grapheme_id = if is_grapheme_char(cell.char) {
                let new_width = char_right_extent(cell.char) + 1;
                if x + new_width > self.width {
                    None
                } else {
                    Some(grapheme_id_from_char(cell.char))
                }
            } else {
                None
            };
            self.tracker.replace(pool, Some(id), new_grapheme_id);
            tracker_replaced = true;

            let span_start = index - left.min(index - row_start);
            let span_end = index + right.min(row_end - index);
            for i in span_start..=span_end {
                let span_char = self.char[i];
                if !(is_grapheme_char(span_char) || is_continuation_char(span_char)) {
                    continue;
                }
                if grapheme_id_from_char(span_char) != id {
                    continue;
                }
                let span_link_id = link_id(self.attributes[i]);
                if span_link_id != 0 {
                    self.link_tracker.remove_cell_ref(span_link_id);
                }
                self.char[i] = DEFAULT_SPACE_CHAR;
                self.attributes[i] = 0;
            }
        }

        if is_grapheme_char(cell.char) {
            let right = char_right_extent(cell.char);
            let width = 1 + right;

            if x + width > self.width {
                // Start cell would overflow the row: fill to EOL with spaces.
                let end_of_line = ((y + 1) * self.width) as usize;
                for i in index..end_of_line {
                    let eol_link_id = link_id(self.attributes[i]);
                    if eol_link_id != 0 {
                        self.link_tracker.remove_cell_ref(eol_link_id);
                    }
                }
                self.char[index..end_of_line].fill(DEFAULT_SPACE_CHAR);
                self.attributes[index..end_of_line].fill(cell.attributes);
                self.fg[index..end_of_line].fill(cell.fg);
                self.bg[index..end_of_line].fill(cell.bg);
                let new_link_id = link_id(cell.attributes);
                if new_link_id != 0 {
                    for _ in index..end_of_line {
                        self.link_tracker.add_cell_ref(new_link_id);
                    }
                }
                return;
            }

            let prev_link_id = prev_link_id_at_entry;
            self.char[index] = cell.char;
            self.fg[index] = cell.fg;
            self.bg[index] = cell.bg;
            self.attributes[index] = cell.attributes;

            let id = grapheme_id_from_char(cell.char);
            let is_same_grapheme_start = is_grapheme_char(prev_char) && prev_char == cell.char;
            if !tracker_replaced && !is_same_grapheme_start {
                self.tracker.add(pool, id);
            }

            let new_link_id = link_id(cell.attributes);
            if prev_link_id != 0 && prev_link_id != new_link_id {
                self.link_tracker.remove_cell_ref(prev_link_id);
            }
            if new_link_id != 0 && new_link_id != prev_link_id {
                self.link_tracker.add_cell_ref(new_link_id);
            }

            if width > 1 {
                let row_end_index = ((y * self.width) + self.width - 1) as usize;
                let max_right = (right as usize).min(row_end_index - index);
                if max_right > 0 {
                    self.fg[index + 1..index + 1 + max_right].fill(cell.fg);
                    self.bg[index + 1..index + 1 + max_right].fill(cell.bg);
                    self.attributes[index + 1..index + 1 + max_right].fill(cell.attributes);
                    for k in 1..=max_right {
                        self.char[index + k] =
                            pack_continuation(k as u32, (max_right - k) as u32, id);
                    }
                }
            }
        } else {
            self.write_cell(index, cell);
        }
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

    pub fn set_cell_with_alpha_blending(
        &mut self,
        pool: &mut GraphemePool,
        x: u32,
        y: u32,
        cell: Cell,
    ) {
        if !self.point_in_scissor(x as i32, y as i32) {
            return;
        }
        let opacity = self.current_opacity();
        if is_fully_transparent(opacity, cell.fg, cell.bg) {
            return;
        }
        if is_fully_opaque(opacity, cell.fg, cell.bg) {
            self.set(pool, x, y, cell);
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
                self.set(pool, x, y, blended);
            }
            None => self.set(pool, x, y, effective),
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

    pub fn fill_rect(
        &mut self,
        pool: &mut GraphemePool,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        bg: Rgba,
    ) {
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
        if self.tracker.has_any() || self.link_tracker.has_any() {
            // Grapheme/link-aware slow path: full blending setter per cell.
            for fy in cs_y..=ce_y {
                for fx in cs_x..=ce_x {
                    self.set_cell_with_alpha_blending(
                        pool,
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
        } else if has_alpha {
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

    pub fn resize(&mut self, pool: &mut GraphemePool, width: u32, height: u32) {
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
        self.clear(pool, rgb_color(0, 0, 0, 255), None);
    }

    /// Zig `drawText`: walks the Slice A grapheme pipeline, allocating pool
    /// ids for non-trivial clusters and writing start + continuation cells.
    pub fn draw_text(
        &mut self,
        pool: &mut GraphemePool,
        text: &str,
        x: u32,
        y: u32,
        fg: Rgba,
        bg: Option<Rgba>,
        attributes: u32,
    ) {
        use crate::unicode::{WidthMethod, find_grapheme_info, width_at_unicode, width_at_wcwidth};
        if x >= self.width || y >= self.height || text.is_empty() {
            return;
        }
        let opacity = self.current_opacity();
        if is_fully_transparent(opacity, fg, bg.unwrap_or(rgb_color(0, 0, 0, 0))) {
            return;
        }
        let method = WidthMethod::from_code(self.width_method);
        let tab_width: u8 = 2;
        let specials = find_grapheme_info(text, method, tab_width);
        let bytes = text.as_bytes();

        let mut advance_cells: u32 = 0;
        let mut byte_offset: usize = 0;
        let mut col: u32 = 0;
        let mut special_idx: usize = 0;

        while byte_offset < bytes.len() {
            let char_x = x + advance_cells;
            if char_x >= self.width {
                break;
            }
            let at_special =
                special_idx < specials.len() && specials[special_idx].col_offset == col;
            let (g_start, g_len, g_width) = if at_special {
                let g = &specials[special_idx];
                special_idx += 1;
                byte_offset = g.byte_offset + g.byte_len;
                (g.byte_offset, g.byte_len, g.width)
            } else {
                byte_offset += 1;
                (byte_offset - 1, 1, 1)
            };

            if !self.point_in_scissor(char_x as i32, y as i32) {
                advance_cells += g_width;
                col += g_width;
                continue;
            }

            let bg_color = match bg {
                Some(b) => b,
                None => match self.get(char_x, y) {
                    Some(existing) => existing.bg,
                    None => rgb_color(0, 0, 0, 255),
                },
            };

            let anchor = if at_special {
                specials[special_idx - 1].byte_offset
            } else {
                byte_offset - 1
            };
            let cell_width = match method {
                WidthMethod::Unicode => width_at_unicode(bytes, anchor, tab_width),
                WidthMethod::Wcwidth => width_at_wcwidth(bytes, anchor, tab_width),
            };
            if cell_width == 0 {
                col += g_width;
                continue;
            }

            if g_len == 1 && bytes[g_start] == b'\t' {
                for tab_col in 0..g_width {
                    let tab_x = char_x + tab_col;
                    if tab_x >= self.width {
                        break;
                    }
                    let cell = Cell {
                        char: DEFAULT_SPACE_CHAR,
                        fg,
                        bg: bg_color,
                        attributes,
                    };
                    if is_rgba_with_alpha(bg_color) {
                        self.set_cell_with_alpha_blending(pool, tab_x, y, cell);
                    } else {
                        self.set(pool, tab_x, y, cell);
                    }
                }
                advance_cells += g_width;
                col += g_width;
                continue;
            }

            let encoded_char = if g_len == 1 && cell_width == 1 && bytes[g_start] >= 32 {
                bytes[g_start] as u32
            } else {
                let Some(gid) = pool.alloc(&bytes[g_start..g_start + g_len]) else {
                    return;
                };
                pack_grapheme_start(gid, cell_width)
            };

            let cell = Cell {
                char: encoded_char,
                fg,
                bg: bg_color,
                attributes,
            };
            if is_rgba_with_alpha(bg_color) {
                self.set_cell_with_alpha_blending(pool, char_x, y, cell);
            } else {
                self.set(pool, char_x, y, cell);
            }

            advance_cells += cell_width;
            col += g_width;
        }
    }

    /// Zig `writeResolvedChars`: resolve the char plane back to UTF-8
    /// (grapheme ids via the pool, continuations skipped, NUL/invalid as space).
    /// Zig `writeResolvedChars`: resolve the char plane back to UTF-8.
    /// NOTE the reference's `continue` statements skip the end-of-row newline
    /// check — continuation cells and NUL/invalid cells never emit a newline
    /// even at row boundaries. Mirrored exactly.
    pub fn write_resolved_chars(
        &self,
        pool: &mut GraphemePool,
        out: &mut Vec<u8>,
        add_line_breaks: bool,
    ) {
        let total = (self.width * self.height) as usize;
        for i in 0..total {
            let c = self.char[i];
            if is_grapheme_char(c) {
                match pool.get(grapheme_id_from_char(c)) {
                    Some(bytes) => out.extend_from_slice(bytes),
                    None => out.push(b' '),
                }
            } else if is_continuation_char(c) {
                continue; // skips the newline check (Zig behavior)
            } else if c == 0 || c > 0x10FFFF {
                out.push(b' ');
                continue; // skips the newline check (Zig behavior)
            } else {
                match char::from_u32(c) {
                    Some(ch) => {
                        let mut buf = [0u8; 4];
                        out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                    }
                    None => {
                        out.push(b' ');
                        continue; // Zig utf8Encode failure path
                    }
                }
            }
            if add_line_breaks && (i + 1) % self.width as usize == 0 {
                out.push(b'\n');
            }
        }
    }

    fn is_single_width_border_char(c: u32) -> bool {
        if c == 0 {
            return true;
        }
        if c > 0x10FFFF {
            return false;
        }
        crate::unicode::codepoint_width(c) == 1
    }

    fn can_use_transparent_border_fast_path(
        &self,
        border_chars: &[u32; 11],
        border_color: Rgba,
        background_color: Rgba,
    ) -> bool {
        self.current_opacity() == 1.0
            && alpha(border_color) == 255
            && alpha(background_color) == 0
            && !self.tracker.has_any()
            && !self.link_tracker.has_any()
            && Self::is_single_width_border_char(border_chars[0])
            && Self::is_single_width_border_char(border_chars[1])
            && Self::is_single_width_border_char(border_chars[2])
            && Self::is_single_width_border_char(border_chars[3])
            && Self::is_single_width_border_char(border_chars[4])
            && Self::is_single_width_border_char(border_chars[5])
    }

    fn compute_box_title_layout(
        &self,
        title: Option<&str>,
        border_side: bool,
        is_at_actual_side: bool,
        start_x: i32,
        end_x: i32,
        width: u32,
        alignment: u8,
    ) -> (bool, i32, i32, i32) {
        let Some(text) = title else {
            return (false, start_x, 0, 0);
        };
        if text.is_empty() || !border_side || !is_at_actual_side {
            return (false, start_x, 0, 0);
        }
        let method = crate::unicode::WidthMethod::from_code(self.width_method);
        let title_length = crate::unicode::calculate_text_width(text, 2, method) as i32;
        let min_title_space = 4;
        if (width as i32) < title_length + min_title_space {
            return (false, start_x, 0, 0);
        }
        let padding = 2;
        let mut title_x = start_x + padding;
        if alignment == 1 {
            title_x = start_x + padding.max((width as i32 - title_length).div_euclid(2));
        } else if alignment == 2 {
            title_x = start_x + width as i32 - padding - title_length;
        }
        title_x = (start_x + padding).max(title_x.min(end_x - title_length));
        (true, title_x, title_x, title_x + title_length - 1)
    }

    /// Zig `drawBox`. border_chars layout: [topLeft, topRight, bottomLeft,
    /// bottomRight, horizontal, vertical, topT, bottomT, leftT, rightT, cross].
    #[allow(clippy::too_many_arguments)]
    pub fn draw_box(
        &mut self,
        pool: &mut GraphemePool,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        border_chars: &[u32; 11],
        sides: (bool, bool, bool, bool), // top, right, bottom, left
        border_color: Rgba,
        background_color: Rgba,
        title_color: Rgba,
        should_fill: bool,
        title: Option<&str>,
        title_alignment: u8,
        bottom_title: Option<&str>,
        bottom_title_alignment: u8,
    ) {
        let (top, right_side, bottom, left) = sides;
        let opacity = self.current_opacity();
        let border_bg_transparent = is_fully_transparent(opacity, border_color, background_color);
        let has_title = title.is_some() || bottom_title.is_some();
        let title_visible =
            has_title && !is_fully_transparent(opacity, title_color, background_color);
        if border_bg_transparent && !title_visible {
            return;
        }

        let start_x = x.max(0);
        let start_y = y.max(0);
        let end_x = (self.width as i32 - 1).min(x + width as i32 - 1);
        let end_y = (self.height as i32 - 1).min(y + height as i32 - 1);
        if start_x > end_x || start_y > end_y {
            return;
        }
        let box_width = (end_x - start_x + 1) as u32;
        let box_height = (end_y - start_y + 1) as u32;
        if !self.rect_in_scissor(start_x, start_y, box_width, box_height) {
            return;
        }

        let at_left = start_x == x;
        let at_right = end_x == x + width as i32 - 1;
        let at_top = start_y == y;
        let at_bottom = end_y == y + height as i32 - 1;

        let title_layout = self.compute_box_title_layout(
            title,
            top,
            at_top,
            start_x,
            end_x,
            width,
            title_alignment,
        );
        let bottom_layout = self.compute_box_title_layout(
            bottom_title,
            bottom,
            at_bottom,
            start_x,
            end_x,
            width,
            bottom_title_alignment,
        );

        if should_fill {
            if !top && !right_side && !bottom && !left {
                self.fill_rect(
                    pool,
                    start_x as u32,
                    start_y as u32,
                    box_width,
                    box_height,
                    background_color,
                );
            } else {
                let inner_start_x = start_x + if left && at_left { 1 } else { 0 };
                let inner_start_y = start_y + if top && at_top { 1 } else { 0 };
                let inner_end_x = end_x - if right_side && at_right { 1 } else { 0 };
                let inner_end_y = end_y - if bottom && at_bottom { 1 } else { 0 };
                if inner_end_x >= inner_start_x && inner_end_y >= inner_start_y {
                    self.fill_rect(
                        pool,
                        inner_start_x as u32,
                        inner_start_y as u32,
                        (inner_end_x - inner_start_x + 1) as u32,
                        (inner_end_y - inner_start_y + 1) as u32,
                        background_color,
                    );
                }
            }
        }

        let left_border_only = left && at_left && !top && !bottom;
        let right_border_only = right_side && at_right && !top && !bottom;
        let bottom_only_with_verticals = bottom && at_bottom && !top && (left || right_side);
        let top_only_with_verticals = top && at_top && !bottom && (left || right_side);
        let extend_to_top = left_border_only || right_border_only || bottom_only_with_verticals;
        let extend_to_bottom = left_border_only || right_border_only || top_only_with_verticals;
        let fast =
            self.can_use_transparent_border_fast_path(border_chars, border_color, background_color);

        let mut put = |buf: &mut Self, cx: i32, cy: i32, ch: u32| {
            if fast {
                let index = buf.index(cx as u32, cy as u32);
                buf.char[index] = ch;
                buf.fg[index] = border_color;
                buf.attributes[index] = 0;
            } else {
                buf.set_cell_with_alpha_blending(
                    pool,
                    cx as u32,
                    cy as u32,
                    Cell {
                        char: ch,
                        fg: border_color,
                        bg: background_color,
                        attributes: 0,
                    },
                );
            }
        };

        if top || bottom {
            if top && at_top {
                for draw_x in start_x..=end_x {
                    if start_y >= 0 && start_y < self.height as i32 {
                        if title_layout.0 && draw_x >= title_layout.2 && draw_x <= title_layout.3 {
                            continue;
                        }
                        let mut ch = border_chars[4];
                        if draw_x == start_x && at_left {
                            ch = if left {
                                border_chars[0]
                            } else {
                                border_chars[4]
                            };
                        } else if draw_x == end_x && at_right {
                            ch = if right_side {
                                border_chars[1]
                            } else {
                                border_chars[4]
                            };
                        }
                        put(self, draw_x, start_y, ch);
                    }
                }
            }
            if bottom && at_bottom {
                for draw_x in start_x..=end_x {
                    if end_y >= 0 && end_y < self.height as i32 {
                        if bottom_layout.0 && draw_x >= bottom_layout.2 && draw_x <= bottom_layout.3
                        {
                            continue;
                        }
                        let mut ch = border_chars[4];
                        if draw_x == start_x && at_left {
                            ch = if left {
                                border_chars[2]
                            } else {
                                border_chars[4]
                            };
                        } else if draw_x == end_x && at_right {
                            ch = if right_side {
                                border_chars[3]
                            } else {
                                border_chars[4]
                            };
                        }
                        put(self, draw_x, end_y, ch);
                    }
                }
            }
        }

        let vertical_start_y = if extend_to_top {
            start_y
        } else {
            start_y + if top && at_top { 1 } else { 0 }
        };
        let vertical_end_y = if extend_to_bottom {
            end_y
        } else {
            end_y - if bottom && at_bottom { 1 } else { 0 }
        };

        if left || right_side {
            for draw_y in vertical_start_y..=vertical_end_y {
                if left && at_left && start_x >= 0 && start_x < self.width as i32 {
                    put(self, start_x, draw_y, border_chars[5]);
                }
                if right_side && at_right && end_x >= 0 && end_x < self.width as i32 {
                    put(self, end_x, draw_y, border_chars[5]);
                }
            }
        }

        if title_layout.0 {
            if let Some(text) = title {
                self.draw_text(
                    pool,
                    text,
                    title_layout.1 as u32,
                    start_y as u32,
                    title_color,
                    Some(background_color),
                    0,
                );
            }
        }
        if bottom_layout.0 {
            if let Some(text) = bottom_title {
                self.draw_text(
                    pool,
                    text,
                    bottom_layout.1 as u32,
                    end_y as u32,
                    title_color,
                    Some(background_color),
                    0,
                );
            }
        }
    }

    /// Zig `drawFrameBuffer`: blit another buffer into this one. Fast path
    /// memcpy when neither side tracks graphemes/links and the source ignores
    /// alpha; otherwise per-cell blending with continuation-cell awareness.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_frame_buffer(
        &mut self,
        pool: &mut GraphemePool,
        dest_x: i32,
        dest_y: i32,
        src: &OptimizedBuffer,
        source_x: Option<u32>,
        source_y: Option<u32>,
        source_width: Option<u32>,
        source_height: Option<u32>,
    ) {
        if self.width == 0 || self.height == 0 || src.width == 0 || src.height == 0 {
            return;
        }
        let opacity = self.current_opacity();
        if opacity == 0.0 {
            return;
        }
        let src_x = source_x.unwrap_or(0);
        let src_y = source_y.unwrap_or(0);
        let src_w = source_width.unwrap_or(src.width);
        let src_h = source_height.unwrap_or(src.height);
        if src_x >= src.width || src_y >= src.height || src_w == 0 || src_h == 0 {
            return;
        }
        let clamped_w = src_w.min(src.width - src_x);
        let clamped_h = src_h.min(src.height - src_y);

        let start_dx = dest_x.max(0);
        let start_dy = dest_y.max(0);
        let end_dx = (self.width as i32 - 1).min(dest_x + clamped_w as i32 - 1);
        let end_dy = (self.height as i32 - 1).min(dest_y + clamped_h as i32 - 1);
        if start_dx > end_dx || start_dy > end_dy {
            return;
        }
        let dest_w = (end_dx - start_dx + 1) as u32;
        let dest_h = (end_dy - start_dy + 1) as u32;
        if !self.rect_in_scissor(start_dx, start_dy, dest_w, dest_h) {
            return;
        }

        let grapheme_aware = self.tracker.has_any() || src.tracker.has_any();
        let link_aware = self.link_tracker.has_any() || src.link_tracker.has_any();

        let Some(clipped) = self.clip_rect_to_scissor(start_dx, start_dy, dest_w, dest_h) else {
            return;
        };
        let cs_x = start_dx.max(clipped.x);
        let cs_y = start_dy.max(clipped.y);
        let ce_x = end_dx.min(clipped.x + clipped.width as i32 - 1);
        let ce_y = end_dy.min(clipped.y + clipped.height as i32 - 1);

        if !grapheme_aware && !src.respect_alpha && !link_aware {
            let mut dy = cs_y;
            while dy <= ce_y {
                let rel_dy = dy - dest_y;
                let sy = src_y + rel_dy as u32;
                if sy < src.height {
                    let rel_dx = cs_x - dest_x;
                    let sx = src_x + rel_dx as u32;
                    if sx < src.width {
                        let dest_row = self.index(cs_x as u32, dy as u32);
                        let src_row = ((sy * src.width) + sx) as usize;
                        let copy_w = ((ce_x - cs_x + 1) as u32).min(src.width - sx) as usize;
                        self.char[dest_row..dest_row + copy_w]
                            .copy_from_slice(&src.char[src_row..src_row + copy_w]);
                        self.fg[dest_row..dest_row + copy_w]
                            .copy_from_slice(&src.fg[src_row..src_row + copy_w]);
                        self.bg[dest_row..dest_row + copy_w]
                            .copy_from_slice(&src.bg[src_row..src_row + copy_w]);
                        self.attributes[dest_row..dest_row + copy_w]
                            .copy_from_slice(&src.attributes[src_row..src_row + copy_w]);
                    }
                }
                dy += 1;
            }
            return;
        }

        let mut dy = cs_y;
        while dy <= ce_y {
            let mut last_drawn_grapheme_id: u32 = 0;
            let mut dx = cs_x;
            while dx <= ce_x {
                let rel_dx = dx - dest_x;
                let rel_dy = dy - dest_y;
                let sx = src_x + rel_dx as u32;
                let sy = src_y + rel_dy as u32;
                if sx >= src.width || sy >= src.height {
                    dx += 1;
                    continue;
                }
                let src_index = ((sy * src.width) + sx) as usize;
                if src_index >= src.char.len() {
                    dx += 1;
                    continue;
                }
                let src_char = src.char[src_index];
                let src_fg = src.fg[src_index];
                let src_bg = src.bg[src_index];
                let src_attr = src.attributes[src_index];
                if alpha(src_bg) == 0 && alpha(src_fg) == 0 {
                    dx += 1;
                    continue;
                }
                if grapheme_aware {
                    if is_continuation_char(src_char) {
                        let gid = grapheme_id_from_char(src_char);
                        if gid != last_drawn_grapheme_id {
                            self.set_cell_with_alpha_blending(
                                pool,
                                dx as u32,
                                dy as u32,
                                Cell {
                                    char: DEFAULT_SPACE_CHAR,
                                    fg: src_fg,
                                    bg: src_bg,
                                    attributes: src_attr,
                                },
                            );
                        }
                        dx += 1;
                        continue;
                    }
                    if is_grapheme_char(src_char) {
                        last_drawn_grapheme_id = grapheme_id_from_char(src_char);
                    }
                    self.set_cell_with_alpha_blending(
                        pool,
                        dx as u32,
                        dy as u32,
                        Cell {
                            char: src_char,
                            fg: src_fg,
                            bg: src_bg,
                            attributes: src_attr,
                        },
                    );
                    dx += 1;
                    continue;
                }
                self.set_cell_with_alpha_blending_raw(
                    dx as u32,
                    dy as u32,
                    Cell {
                        char: src_char,
                        fg: src_fg,
                        bg: src_bg,
                        attributes: src_attr,
                    },
                );
                dx += 1;
            }
            dy += 1;
        }
    }

    /// Zig `drawSuperSampleBuffer`: 2x2 pixel quadrant-block rendering.
    pub fn draw_super_sample_buffer(
        &mut self,
        pool: &mut GraphemePool,
        pos_x: u32,
        pos_y: u32,
        pixel_data: &[u8],
        format: u8,
        aligned_bytes_per_row: u32,
    ) {
        let bpp = 4usize;
        let is_bgra = format == 0;
        for y_cell in pos_y..self.height {
            for x_cell in pos_x..self.width {
                if !self.point_in_scissor(x_cell as i32, y_cell as i32) {
                    continue;
                }
                let rx = ((x_cell - pos_x) * 2) as usize;
                let ry = ((y_cell - pos_y) * 2) as usize;
                let tl = ry * aligned_bytes_per_row as usize + rx * bpp;
                let bl = (ry + 1) * aligned_bytes_per_row as usize + rx * bpp;
                let pixels = [
                    get_pixel_color(tl, pixel_data, is_bgra),
                    get_pixel_color(tl + bpp, pixel_data, is_bgra),
                    get_pixel_color(bl, pixel_data, is_bgra),
                    get_pixel_color(bl + bpp, pixel_data, is_bgra),
                ];
                let (ch, fg, bg) = render_quadrant_block(pixels);
                self.set_cell_with_alpha_blending(
                    pool,
                    x_cell,
                    y_cell,
                    Cell {
                        char: ch,
                        fg,
                        bg,
                        attributes: 0,
                    },
                );
            }
        }
    }

    /// Zig `drawPackedBuffer`: 48-byte packed cells (bg f32x4, fg f32x4, char u32).
    pub fn draw_packed_buffer(
        &mut self,
        pool: &mut GraphemePool,
        data: &[u8],
        pos_x: u32,
        pos_y: u32,
        terminal_width_cells: u32,
        terminal_height_cells: u32,
    ) {
        const CELL_SIZE: usize = 48;
        let num_cells = data.len() / CELL_SIZE;
        for i in 0..num_cells {
            let off = i * CELL_SIZE;
            let cell_x = pos_x + (i as u32 % terminal_width_cells);
            let cell_y = pos_y + (i as u32 / terminal_width_cells);
            if cell_x >= terminal_width_cells || cell_y >= terminal_height_cells {
                continue;
            }
            if cell_x >= self.width || cell_y >= self.height {
                continue;
            }
            if !self.point_in_scissor(cell_x as i32, cell_y as i32) {
                continue;
            }
            let f = |o: usize| f32::from_le_bytes(data[off + o..off + o + 4].try_into().unwrap());
            let bg = rgba_from_floats(f(0), f(4), f(8), f(12));
            let fg = rgba_from_floats(f(16), f(20), f(24), f(28));
            let mut ch = u32::from_le_bytes(data[off + 32..off + 36].try_into().unwrap());
            if ch == 0 || ch > 0x10FFFF {
                ch = DEFAULT_SPACE_CHAR;
            }
            if ch < 32 || (ch > 126 && ch < 0x2580) {
                ch = BLOCK_CHAR;
            }
            self.set_cell_with_alpha_blending(
                pool,
                cell_x,
                cell_y,
                Cell {
                    char: ch,
                    fg,
                    bg,
                    attributes: 0,
                },
            );
        }
    }

    /// Zig `drawGrayscaleBuffer`: intensity map to ASCII ramp.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_grayscale_buffer(
        &mut self,
        pool: &mut GraphemePool,
        pos_x: i32,
        pos_y: i32,
        intensities: &[f32],
        src_width: u32,
        src_height: u32,
        fg_color: Option<Rgba>,
        bg_color: Option<Rgba>,
    ) {
        let bg = bg_color.unwrap_or(rgb_color(0, 0, 0, 0));
        if src_width == 0 || src_height == 0 {
            return;
        }
        if pos_x >= self.width as i32 || pos_y >= self.height as i32 {
            return;
        }
        let start_x: u32 = if pos_x < 0 { (-pos_x) as u32 } else { 0 };
        let start_y: u32 = if pos_y < 0 { (-pos_y) as u32 } else { 0 };
        let dest_start_x: u32 = if pos_x < 0 { 0 } else { pos_x as u32 };
        let dest_start_y: u32 = if pos_y < 0 { 0 } else { pos_y as u32 };
        if start_x >= src_width || start_y >= src_height {
            return;
        }
        let visible_w = (src_width - start_x).min(self.width - dest_start_x);
        let visible_h = (src_height - start_y).min(self.height - dest_start_y);
        if visible_w == 0 || visible_h == 0 {
            return;
        }
        let base_fg = fg_color.unwrap_or(rgb_color(255, 255, 255, 255));
        let opacity = self.current_opacity();
        let aware = self.tracker.has_any() || self.link_tracker.has_any();

        for dy in 0..visible_h {
            for dx in 0..visible_w {
                let dest_x = dest_start_x + dx;
                let dest_y = dest_start_y + dy;
                if !self.point_in_scissor(dest_x as i32, dest_y as i32) {
                    continue;
                }
                let intensity = intensities[((start_y + dy) * src_width + (start_x + dx)) as usize];
                if intensity < 0.01 {
                    continue;
                }
                let ch = get_grayscale_char(intensity);
                let gray = intensity.clamp(0.0, 1.0);
                let fg = apply_opacity(base_fg, opacity_to_u8(gray * opacity));
                let cell = Cell {
                    char: ch,
                    fg,
                    bg,
                    attributes: 0,
                };
                if aware {
                    self.set_cell_with_alpha_blending(pool, dest_x, dest_y, cell);
                } else {
                    self.set_cell_with_alpha_blending_raw(dest_x, dest_y, cell);
                }
            }
        }
    }

    /// Zig `drawGrayscaleBufferSupersampled`: 2x2 intensity averaging.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_grayscale_buffer_supersampled(
        &mut self,
        pool: &mut GraphemePool,
        pos_x: i32,
        pos_y: i32,
        intensities: &[f32],
        src_width: u32,
        src_height: u32,
        fg_color: Option<Rgba>,
        bg_color: Option<Rgba>,
    ) {
        let bg = bg_color.unwrap_or(rgb_color(0, 0, 0, 0));
        let term_w = src_width / 2;
        let term_h = src_height / 2;
        if term_w == 0 || term_h == 0 {
            return;
        }
        if pos_x >= self.width as i32 || pos_y >= self.height as i32 {
            return;
        }
        let start_x: u32 = if pos_x < 0 { (-pos_x) as u32 } else { 0 };
        let start_y: u32 = if pos_y < 0 { (-pos_y) as u32 } else { 0 };
        let dest_start_x: u32 = if pos_x < 0 { 0 } else { pos_x as u32 };
        let dest_start_y: u32 = if pos_y < 0 { 0 } else { pos_y as u32 };
        if start_x >= term_w || start_y >= term_h {
            return;
        }
        let visible_w = (term_w - start_x).min(self.width - dest_start_x);
        let visible_h = (term_h - start_y).min(self.height - dest_start_y);
        if visible_w == 0 || visible_h == 0 {
            return;
        }
        let base_fg = fg_color.unwrap_or(rgb_color(255, 255, 255, 255));
        let opacity = self.current_opacity();
        let aware = self.tracker.has_any() || self.link_tracker.has_any();
        let max_idx = (src_height * src_width) as usize;

        for dy in 0..visible_h {
            for dx in 0..visible_w {
                let dest_x = dest_start_x + dx;
                let dest_y = dest_start_y + dy;
                if !self.point_in_scissor(dest_x as i32, dest_y as i32) {
                    continue;
                }
                let qx = (start_x + dx) * 2;
                let qy = (start_y + dy) * 2;
                let idx = |x: u32, y: u32| (y * src_width + x) as usize;
                let tl = if idx(qx, qy) < max_idx {
                    intensities[idx(qx, qy)]
                } else {
                    0.0
                };
                let tr = if idx(qx + 1, qy) < max_idx && qx + 1 < src_width {
                    intensities[idx(qx + 1, qy)]
                } else {
                    0.0
                };
                let bl = if idx(qx, qy + 1) < max_idx && qy + 1 < src_height {
                    intensities[idx(qx, qy + 1)]
                } else {
                    0.0
                };
                let br =
                    if idx(qx + 1, qy + 1) < max_idx && qx + 1 < src_width && qy + 1 < src_height {
                        intensities[idx(qx + 1, qy + 1)]
                    } else {
                        0.0
                    };
                let avg = (tl + tr + bl + br) / 4.0;
                if avg < 0.01 {
                    continue;
                }
                let ch = get_grayscale_char(avg);
                let gray = avg.clamp(0.0, 1.0);
                let fg = apply_opacity(base_fg, opacity_to_u8(gray * opacity));
                let cell = Cell {
                    char: ch,
                    fg,
                    bg,
                    attributes: 0,
                };
                if aware {
                    self.set_cell_with_alpha_blending(pool, dest_x, dest_y, cell);
                } else {
                    self.set_cell_with_alpha_blending_raw(dest_x, dest_y, cell);
                }
            }
        }
    }

    /// Zig `drawGrid`: table borders with intersection glyph selection. Raw
    /// plane writes for runs (no scissor on the memset segments — reference
    /// behavior), setRaw (scissored) for intersections.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_grid(
        &mut self,
        border_chars: &[u32; 11],
        border_fg: Rgba,
        border_bg: Rgba,
        column_offsets: &[i32],
        row_offsets: &[i32],
        draw_inner: bool,
        draw_outer: bool,
    ) {
        let column_count = column_offsets.len().saturating_sub(1) as u32;
        let row_count = row_offsets.len().saturating_sub(1) as u32;
        if row_count == 0 || column_count == 0 {
            return;
        }
        if !draw_inner && !draw_outer {
            return;
        }
        let opacity = self.current_opacity();
        if is_fully_transparent(opacity, border_fg, border_bg) {
            return;
        }
        let h_char = border_chars[4];
        let v_char = border_chars[5];
        let buf_w = self.width as i32;
        let buf_h = self.height as i32;

        for row_idx in 0..=row_count {
            let is_outer_row = row_idx == 0 || row_idx == row_count;
            let should_draw_horizontal = if is_outer_row { draw_outer } else { draw_inner };
            let border_y = row_offsets[row_idx as usize];
            if border_y >= buf_h {
                break;
            }
            if should_draw_horizontal && border_y >= 0 {
                for col_border_idx in 0..=column_count {
                    let is_outer_col = col_border_idx == 0 || col_border_idx == column_count;
                    let should_draw_vertical = if is_outer_col { draw_outer } else { draw_inner };
                    if !should_draw_vertical {
                        continue;
                    }
                    let bx = column_offsets[col_border_idx as usize];
                    if bx >= buf_w {
                        break;
                    }
                    if bx < 0 {
                        continue;
                    }
                    let has_up = row_idx > 0 && should_draw_vertical;
                    let has_down = row_idx < row_count && should_draw_vertical;
                    let has_left = col_border_idx > 0;
                    let has_right = col_border_idx < column_count;
                    let ch = table_border_intersection(
                        border_chars,
                        has_up,
                        has_down,
                        has_left,
                        has_right,
                    );
                    // setRaw: scissored plane write with link upkeep
                    if let Some(index) = self.validate_and_index(bx as u32, border_y as u32) {
                        self.write_cell(
                            index,
                            Cell {
                                char: ch,
                                fg: border_fg,
                                bg: border_bg,
                                attributes: 0,
                            },
                        );
                    }
                }
                for col_idx in 0..column_count {
                    let has_boundary_after = if col_idx < column_count - 1 {
                        draw_inner
                    } else {
                        draw_outer
                    };
                    let boundary_padding: i32 = if has_boundary_after { 0 } else { 1 };
                    let start_x = column_offsets[col_idx as usize] + 1;
                    let end_x = column_offsets[col_idx as usize + 1] + boundary_padding;
                    if start_x >= buf_w {
                        break;
                    }
                    if end_x <= 0 {
                        continue;
                    }
                    let cs = start_x.max(0) as usize;
                    let ce = end_x.min(buf_w) as usize;
                    if cs < ce {
                        let row_base = border_y as usize * self.width as usize;
                        self.char[row_base + cs..row_base + ce].fill(h_char);
                        self.fg[row_base + cs..row_base + ce].fill(border_fg);
                        self.bg[row_base + cs..row_base + ce].fill(border_bg);
                        self.attributes[row_base + cs..row_base + ce].fill(0);
                    }
                }
            }
            if row_idx >= row_count {
                break;
            }
            let has_row_boundary_after = if row_idx < row_count - 1 {
                draw_inner
            } else {
                draw_outer
            };
            let row_boundary_padding: i32 = if has_row_boundary_after { 0 } else { 1 };
            let content_start_y = border_y + 1;
            let content_end_y = row_offsets[row_idx as usize + 1] + row_boundary_padding;
            let mut cy = content_start_y;
            while cy < content_end_y && cy < buf_h {
                if cy < 0 {
                    cy += 1;
                    continue;
                }
                let row_base = cy as usize * self.width as usize;
                for col_border_idx in 0..=column_count {
                    let is_outer_col = col_border_idx == 0 || col_border_idx == column_count;
                    let should_draw_vertical = if is_outer_col { draw_outer } else { draw_inner };
                    if !should_draw_vertical {
                        continue;
                    }
                    let bx = column_offsets[col_border_idx as usize];
                    if bx >= buf_w {
                        break;
                    }
                    if bx < 0 {
                        continue;
                    }
                    let idx = row_base + bx as usize;
                    self.char[idx] = v_char;
                    self.fg[idx] = border_fg;
                    self.bg[idx] = border_bg;
                    self.attributes[idx] = 0;
                }
                cy += 1;
            }
        }
    }

    /// Zig `colorMatrix` (masked per-cell 4x4 color transform).
    pub fn color_matrix(&mut self, matrix: &[f32], cell_mask: &[f32], strength: f32, target: u8) {
        if matrix.len() < 16 || cell_mask.len() < 3 {
            return;
        }
        if target == 0 {
            return;
        }
        if !strength.is_finite() {
            return;
        }
        let mat: [f32; 16] = matrix[0..16].try_into().unwrap();
        let max_u32_f = u32::MAX as f32;
        let len = cell_mask.len() - (cell_mask.len() % 3);
        let mut i = 0;
        while i < len {
            let x_f = cell_mask[i];
            let y_f = cell_mask[i + 1];
            if x_f < 0.0
                || y_f < 0.0
                || !x_f.is_finite()
                || !y_f.is_finite()
                || x_f > max_u32_f
                || y_f > max_u32_f
            {
                i += 3;
                continue;
            }
            let x = x_f as u32;
            let y = y_f as u32;
            let cell_strength = cell_mask[i + 2] * strength;
            if x >= self.width
                || y >= self.height
                || !cell_strength.is_finite()
                || cell_strength == 0.0
            {
                i += 3;
                continue;
            }
            let index = (y * self.width + x) as usize;
            if target & 1 != 0 {
                self.fg[index] = matrix_apply_to(self.fg[index], &mat, cell_strength);
            }
            if target & 2 != 0 {
                self.bg[index] = matrix_apply_to(self.bg[index], &mat, cell_strength);
            }
            i += 3;
        }
    }

    /// Zig `colorMatrixUniform`: whole-buffer 4x4 color transform.
    pub fn color_matrix_uniform(&mut self, matrix: &[f32], strength: f32, target: u8) {
        if matrix.len() < 16 || strength == 0.0 || target == 0 || !strength.is_finite() {
            return;
        }
        let mat: [f32; 16] = matrix[0..16].try_into().unwrap();
        let size = (self.width * self.height) as usize;
        for index in 0..size {
            if target & 1 != 0 {
                self.fg[index] = matrix_apply_to(self.fg[index], &mat, strength);
            }
            if target & 2 != 0 {
                self.bg[index] = matrix_apply_to(self.bg[index], &mat, strength);
            }
        }
    }

    pub fn get_real_char_size(&self, pool: &mut GraphemePool) -> u32 {
        let total_chars = self.width * self.height;
        let grapheme_count = self.tracker.cell_count();
        let total_grapheme_bytes = self.tracker.total_bytes(pool);
        (total_chars - grapheme_count) * 4 + total_grapheme_bytes
    }
}

/// Zig `tableBorderIntersectionByConnections`.
fn table_border_intersection(bc: &[u32; 11], up: bool, down: bool, left: bool, right: bool) -> u32 {
    match (up, down, left, right) {
        (true, true, true, true) => bc[10],
        (false, true, false, true) => bc[0],
        (false, true, true, false) => bc[1],
        (true, false, false, true) => bc[2],
        (true, false, true, false) => bc[3],
        (true, true, false, true) => bc[8],
        (true, true, true, false) => bc[9],
        (false, true, true, true) => bc[6],
        (true, false, true, true) => bc[7],
        (false, false, l, r) if l || r => bc[4],
        (u, d, false, false) if u || d => bc[5],
        _ => bc[10],
    }
}
