//! ADR-046 Slice B — napi exports for the `buffer*` dlopen symbol family
//! (tranche 1 subset). Names and signatures mirror the Zig `lib.zig` export
//! glue so these become the production implementations when the overlay
//! promotes to the full symbol set. Colors arrive as raw addresses of
//! `[4]u16` values (the JS layer packs RGBA into u16 lanes before the call);
//! the overlay bridge narrows BigInt pointers to f64 numbers.

#![allow(clippy::too_many_arguments)]

use crate::buffer::{Cell, OptimizedBuffer, Rgba};
use crate::handles::{self, Kind};
use crate::pool::GraphemePool;
use napi_derive::napi;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Process-global grapheme pool, mirroring the Zig `initGlobalPool` arena.
pub(crate) fn global_pool() -> MutexGuard<'static, GraphemePool> {
    static POOL: OnceLock<Mutex<GraphemePool>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(GraphemePool::new()))
        .lock()
        .unwrap()
}

fn resolve(handle: u32) -> Option<&'static mut OptimizedBuffer> {
    handles::get(handle, Kind::OptimizedBuffer)
        .map(|ptr| unsafe { &mut *(ptr as *mut OptimizedBuffer) })
}

unsafe fn read_rgba(addr: f64) -> Rgba {
    let p = (addr as u64) as usize as *const u16;
    unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] }
}

#[napi(js_name = "createOptimizedBuffer")]
pub fn create_optimized_buffer(
    width: u32,
    height: u32,
    respect_alpha: f64,
    width_method: u32,
    id_ptr: f64,
    id_len: u32,
) -> u32 {
    let id = if id_ptr != 0.0 && id_len > 0 {
        let p = (id_ptr as u64) as usize as *const u8;
        unsafe { std::slice::from_raw_parts(p, id_len as usize) }.to_vec()
    } else {
        Vec::new()
    };
    let Some(buf) = OptimizedBuffer::new(width, height, respect_alpha != 0.0, width_method, id)
    else {
        return 0;
    };
    let ptr = Box::into_raw(Box::new(buf)) as usize;
    let handle = handles::insert(Kind::OptimizedBuffer, ptr);
    if handle == 0 {
        drop(unsafe { Box::from_raw(ptr as *mut OptimizedBuffer) });
    }
    handle
}

#[napi(js_name = "destroyOptimizedBuffer")]
pub fn destroy_optimized_buffer(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::OptimizedBuffer) {
        let mut buf = unsafe { Box::from_raw(ptr as *mut OptimizedBuffer) };
        buf.tracker.clear(&mut global_pool()); // release pool references (Zig deinit)
        drop(buf);
    }
}

#[napi(js_name = "bufferClear")]
pub fn buffer_clear(handle: u32, bg: f64) {
    if let Some(buf) = resolve(handle) {
        buf.clear(&mut global_pool(), unsafe { read_rgba(bg) }, None);
    }
}

#[napi(js_name = "bufferSetCell")]
pub fn buffer_set_cell(handle: u32, x: u32, y: u32, char: u32, fg: f64, bg: f64, attributes: u32) {
    if let Some(buf) = resolve(handle) {
        let cell = Cell {
            char,
            fg: unsafe { read_rgba(fg) },
            bg: unsafe { read_rgba(bg) },
            attributes,
        };
        buf.set(&mut global_pool(), x, y, cell);
    }
}

#[napi(js_name = "bufferSetCellWithAlphaBlending")]
pub fn buffer_set_cell_with_alpha_blending(
    handle: u32,
    x: u32,
    y: u32,
    char: u32,
    fg: f64,
    bg: f64,
    attributes: u32,
) {
    if let Some(buf) = resolve(handle) {
        let cell = Cell {
            char,
            fg: unsafe { read_rgba(fg) },
            bg: unsafe { read_rgba(bg) },
            attributes,
        };
        buf.set_cell_with_alpha_blending(&mut global_pool(), x, y, cell);
    }
}

#[napi(js_name = "bufferDrawChar")]
pub fn buffer_draw_char(handle: u32, char: u32, x: u32, y: u32, fg: f64, bg: f64, attributes: u32) {
    if let Some(buf) = resolve(handle) {
        let cell = Cell {
            char,
            fg: unsafe { read_rgba(fg) },
            bg: unsafe { read_rgba(bg) },
            attributes,
        };
        buf.set_cell_with_alpha_blending(&mut global_pool(), x, y, cell);
    }
}

#[napi(js_name = "bufferFillRect")]
pub fn buffer_fill_rect(handle: u32, x: u32, y: u32, width: u32, height: u32, bg: f64) {
    if let Some(buf) = resolve(handle) {
        buf.fill_rect(&mut global_pool(), x, y, width, height, unsafe {
            read_rgba(bg)
        });
    }
}

#[napi(js_name = "bufferPushScissorRect")]
pub fn buffer_push_scissor_rect(handle: u32, x: i32, y: i32, width: u32, height: u32) {
    if let Some(buf) = resolve(handle) {
        buf.push_scissor_rect(x, y, width, height);
    }
}

#[napi(js_name = "bufferPopScissorRect")]
pub fn buffer_pop_scissor_rect(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.pop_scissor_rect();
    }
}

#[napi(js_name = "bufferClearScissorRects")]
pub fn buffer_clear_scissor_rects(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.clear_scissor_rects();
    }
}

#[napi(js_name = "bufferPushOpacity")]
pub fn buffer_push_opacity(handle: u32, opacity: f64) {
    if let Some(buf) = resolve(handle) {
        buf.push_opacity(opacity as f32);
    }
}

#[napi(js_name = "bufferPopOpacity")]
pub fn buffer_pop_opacity(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.pop_opacity();
    }
}

#[napi(js_name = "bufferClearOpacity")]
pub fn buffer_clear_opacity(handle: u32) {
    if let Some(buf) = resolve(handle) {
        buf.clear_opacity();
    }
}

#[napi(js_name = "bufferGetCurrentOpacity")]
pub fn buffer_get_current_opacity(handle: u32) -> f64 {
    resolve(handle).map_or(1.0, |buf| buf.current_opacity() as f64)
}

#[napi(js_name = "bufferResize")]
pub fn buffer_resize(handle: u32, width: u32, height: u32) {
    if let Some(buf) = resolve(handle) {
        buf.resize(&mut global_pool(), width, height);
    }
}

#[napi(js_name = "getBufferWidth")]
pub fn get_buffer_width(handle: u32) -> u32 {
    resolve(handle).map_or(0, |buf| buf.width)
}

#[napi(js_name = "getBufferHeight")]
pub fn get_buffer_height(handle: u32) -> u32 {
    resolve(handle).map_or(0, |buf| buf.height)
}

#[napi(js_name = "bufferGetCharPtr")]
pub fn buffer_get_char_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.char.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetFgPtr")]
pub fn buffer_get_fg_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.fg.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetBgPtr")]
pub fn buffer_get_bg_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.bg.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetAttributesPtr")]
pub fn buffer_get_attributes_ptr(handle: u32) -> f64 {
    resolve(handle).map_or(0.0, |buf| buf.attributes.as_ptr() as usize as f64)
}

#[napi(js_name = "bufferGetRealCharSize")]
pub fn buffer_get_real_char_size(handle: u32) -> u32 {
    resolve(handle).map_or(0, |buf| buf.get_real_char_size(&mut global_pool()))
}

#[napi(js_name = "bufferGetRespectAlpha")]
pub fn buffer_get_respect_alpha(handle: u32) -> bool {
    resolve(handle).is_some_and(|buf| buf.respect_alpha)
}

#[napi(js_name = "bufferSetRespectAlpha")]
pub fn buffer_set_respect_alpha(handle: u32, respect_alpha: f64) {
    if let Some(buf) = resolve(handle) {
        buf.respect_alpha = respect_alpha != 0.0;
    }
}

#[napi(js_name = "bufferDrawText")]
#[allow(clippy::too_many_arguments)]
pub fn buffer_draw_text(
    handle: u32,
    text_ptr: f64,
    text_len: u32,
    x: u32,
    y: u32,
    fg: f64,
    bg: f64,
    attributes: u32,
) {
    let Some(buf) = resolve(handle) else { return };
    if text_ptr == 0.0 || text_len == 0 {
        return;
    }
    let p = (text_ptr as u64) as usize as *const u8;
    let bytes = unsafe { std::slice::from_raw_parts(p, text_len as usize) };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return;
    };
    let bg_color = if bg == 0.0 {
        None
    } else {
        Some(unsafe { read_rgba(bg) })
    };
    buf.draw_text(
        &mut global_pool(),
        text,
        x,
        y,
        unsafe { read_rgba(fg) },
        bg_color,
        attributes,
    );
}

#[napi(js_name = "bufferWriteResolvedChars")]
pub fn buffer_write_resolved_chars(
    handle: u32,
    output_ptr: f64,
    output_len: u32,
    add_line_breaks: f64,
) -> u32 {
    let Some(buf) = resolve(handle) else { return 0 };
    if output_len == 0 || output_ptr == 0.0 {
        return 0;
    }
    let mut resolved = Vec::new();
    buf.write_resolved_chars(&mut global_pool(), &mut resolved, add_line_breaks != 0.0);
    if resolved.len() > output_len as usize {
        return 0; // Zig: BufferTooSmall -> catch 0 in the export glue
    }
    let out = (output_ptr as u64) as usize as *mut u8;
    unsafe { std::ptr::copy_nonoverlapping(resolved.as_ptr(), out, resolved.len()) };
    resolved.len() as u32
}

#[napi(js_name = "bufferDrawBox")]
pub fn buffer_draw_box(
    handle: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    border_chars: f64,
    packed_options: u32,
    border_color: f64,
    background_color: f64,
    title_color: f64,
    title_ptr: f64,
    title_len: u32,
    bottom_title_ptr: f64,
    bottom_title_len: u32,
) {
    let Some(buf) = resolve(handle) else { return };
    let bc_ptr = (border_chars as u64) as usize as *const u32;
    if bc_ptr.is_null() {
        return;
    }
    let mut chars = [0u32; 11];
    unsafe { std::ptr::copy_nonoverlapping(bc_ptr, chars.as_mut_ptr(), 11) };
    let sides = (
        (packed_options & 0b1000) != 0,
        (packed_options & 0b0100) != 0,
        (packed_options & 0b0010) != 0,
        (packed_options & 0b0001) != 0,
    );
    let should_fill = ((packed_options >> 4) & 1) != 0;
    let title_alignment = ((packed_options >> 5) & 0b11) as u8;
    let bottom_alignment = ((packed_options >> 7) & 0b11) as u8;
    let read_str = |ptr: f64, len: u32| -> Option<String> {
        if ptr == 0.0 || len == 0 {
            return None;
        }
        let p = (ptr as u64) as usize as *const u8;
        let bytes = unsafe { std::slice::from_raw_parts(p, len as usize) };
        std::str::from_utf8(bytes).ok().map(|s| s.to_string())
    };
    let title = read_str(title_ptr, title_len);
    let bottom_title = read_str(bottom_title_ptr, bottom_title_len);
    buf.draw_box(
        &mut global_pool(),
        x,
        y,
        width,
        height,
        &chars,
        sides,
        unsafe { read_rgba(border_color) },
        unsafe { read_rgba(background_color) },
        unsafe { read_rgba(title_color) },
        should_fill,
        title.as_deref(),
        title_alignment,
        bottom_title.as_deref(),
        bottom_alignment,
    );
}

#[napi(js_name = "drawFrameBuffer")]
#[allow(clippy::too_many_arguments)]
pub fn draw_frame_buffer_export(
    handle: u32,
    dest_x: i32,
    dest_y: i32,
    src_handle: u32,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
) {
    let Some(buf) = resolve(handle) else { return };
    let Some(src) = resolve(src_handle) else {
        return;
    };
    if handle == src_handle {
        return; // aliasing guard; the JS layer never blits a buffer onto itself
    }
    // Zig treats ALL zero source params as "unset" (null).
    let sx = if source_x == 0 { None } else { Some(source_x) };
    let sy = if source_y == 0 { None } else { Some(source_y) };
    let sw = if source_width == 0 {
        None
    } else {
        Some(source_width)
    };
    let sh = if source_height == 0 {
        None
    } else {
        Some(source_height)
    };
    buf.draw_frame_buffer(&mut global_pool(), dest_x, dest_y, src, sx, sy, sw, sh);
}

#[napi(js_name = "attributesWithLink")]
pub fn attributes_with_link(base_attributes: u32, link_id: u32) -> u32 {
    crate::buffer::with_link_id(base_attributes, link_id)
}

#[napi(js_name = "attributesGetLinkId")]
pub fn attributes_get_link_id(attributes: u32) -> u32 {
    crate::buffer::link_id(attributes)
}

#[napi(js_name = "bufferDrawSuperSampleBuffer")]
pub fn buffer_draw_super_sample_buffer(
    handle: u32,
    x: u32,
    y: u32,
    pixel_data: f64,
    len: u32,
    format: u32,
    aligned_bytes_per_row: u32,
) {
    let Some(buf) = resolve(handle) else { return };
    if pixel_data == 0.0 {
        return;
    }
    let p = (pixel_data as u64) as usize as *const u8;
    let data = unsafe { std::slice::from_raw_parts(p, len as usize) };
    buf.draw_super_sample_buffer(
        &mut global_pool(),
        x,
        y,
        data,
        format as u8,
        aligned_bytes_per_row,
    );
}

#[napi(js_name = "bufferDrawPackedBuffer")]
pub fn buffer_draw_packed_buffer(
    handle: u32,
    data: f64,
    data_len: u32,
    pos_x: u32,
    pos_y: u32,
    terminal_width_cells: u32,
    terminal_height_cells: u32,
) {
    let Some(buf) = resolve(handle) else { return };
    if data == 0.0 {
        return;
    }
    let p = (data as u64) as usize as *const u8;
    let bytes = unsafe { std::slice::from_raw_parts(p, data_len as usize) };
    buf.draw_packed_buffer(
        &mut global_pool(),
        bytes,
        pos_x,
        pos_y,
        terminal_width_cells,
        terminal_height_cells,
    );
}

#[napi(js_name = "bufferDrawGrayscaleBuffer")]
#[allow(clippy::too_many_arguments)]
pub fn buffer_draw_grayscale_buffer(
    handle: u32,
    pos_x: i32,
    pos_y: i32,
    intensities: f64,
    src_width: u32,
    src_height: u32,
    fg: f64,
    bg: f64,
) {
    let Some(buf) = resolve(handle) else { return };
    if intensities == 0.0 {
        return;
    }
    let p = (intensities as u64) as usize as *const f32;
    let data = unsafe { std::slice::from_raw_parts(p, (src_width * src_height) as usize) };
    let fg_color = if fg == 0.0 {
        None
    } else {
        Some(unsafe { read_rgba(fg) })
    };
    let bg_color = if bg == 0.0 {
        None
    } else {
        Some(unsafe { read_rgba(bg) })
    };
    buf.draw_grayscale_buffer(
        &mut global_pool(),
        pos_x,
        pos_y,
        data,
        src_width,
        src_height,
        fg_color,
        bg_color,
    );
}

#[napi(js_name = "bufferDrawGrayscaleBufferSupersampled")]
#[allow(clippy::too_many_arguments)]
pub fn buffer_draw_grayscale_buffer_supersampled(
    handle: u32,
    pos_x: i32,
    pos_y: i32,
    intensities: f64,
    src_width: u32,
    src_height: u32,
    fg: f64,
    bg: f64,
) {
    let Some(buf) = resolve(handle) else { return };
    if intensities == 0.0 {
        return;
    }
    let p = (intensities as u64) as usize as *const f32;
    let data = unsafe { std::slice::from_raw_parts(p, (src_width * src_height) as usize) };
    let fg_color = if fg == 0.0 {
        None
    } else {
        Some(unsafe { read_rgba(fg) })
    };
    let bg_color = if bg == 0.0 {
        None
    } else {
        Some(unsafe { read_rgba(bg) })
    };
    buf.draw_grayscale_buffer_supersampled(
        &mut global_pool(),
        pos_x,
        pos_y,
        data,
        src_width,
        src_height,
        fg_color,
        bg_color,
    );
}

#[napi(js_name = "bufferDrawGrid")]
#[allow(clippy::too_many_arguments)]
pub fn buffer_draw_grid(
    handle: u32,
    border_chars: f64,
    border_fg: f64,
    border_bg: f64,
    column_offsets: f64,
    column_count: u32,
    row_offsets: f64,
    row_count: u32,
    options: f64,
) {
    let Some(buf) = resolve(handle) else { return };
    if border_chars == 0.0 || column_offsets == 0.0 || row_offsets == 0.0 || options == 0.0 {
        return;
    }
    let bc_ptr = (border_chars as u64) as usize as *const u32;
    let mut chars = [0u32; 11];
    unsafe { std::ptr::copy_nonoverlapping(bc_ptr, chars.as_mut_ptr(), 11) };
    let cols = unsafe {
        std::slice::from_raw_parts(
            (column_offsets as u64) as usize as *const i32,
            column_count as usize + 1,
        )
    };
    let rows = unsafe {
        std::slice::from_raw_parts(
            (row_offsets as u64) as usize as *const i32,
            row_count as usize + 1,
        )
    };
    let opts = (options as u64) as usize as *const u8;
    let (draw_inner, draw_outer) = unsafe { (*opts != 0, *opts.add(1) != 0) };
    buf.draw_grid(
        &chars,
        unsafe { read_rgba(border_fg) },
        unsafe { read_rgba(border_bg) },
        cols,
        rows,
        draw_inner,
        draw_outer,
    );
}

#[napi(js_name = "bufferColorMatrix")]
pub fn buffer_color_matrix(
    handle: u32,
    matrix: f64,
    cell_mask: f64,
    cell_mask_count: u32,
    strength: f64,
    target: u32,
) {
    let Some(buf) = resolve(handle) else { return };
    if matrix == 0.0 || cell_mask == 0.0 || cell_mask_count == 0 {
        return;
    }
    let mat = unsafe { std::slice::from_raw_parts((matrix as u64) as usize as *const f32, 16) };
    let mask = unsafe {
        std::slice::from_raw_parts(
            (cell_mask as u64) as usize as *const f32,
            cell_mask_count as usize * 3,
        )
    };
    buf.color_matrix(mat, mask, strength as f32, target as u8);
}

#[napi(js_name = "bufferColorMatrixUniform")]
pub fn buffer_color_matrix_uniform(handle: u32, matrix: f64, strength: f64, target: u32) {
    let Some(buf) = resolve(handle) else { return };
    if matrix == 0.0 {
        return;
    }
    let mat = unsafe { std::slice::from_raw_parts((matrix as u64) as usize as *const f32, 16) };
    buf.color_matrix_uniform(mat, strength as f32, target as u8);
}

#[napi(js_name = "bufferGetId")]
pub fn buffer_get_id(handle: u32, out_ptr: f64, max_len: u32) -> u32 {
    let Some(buf) = resolve(handle) else { return 0 };
    if max_len == 0 || out_ptr == 0.0 {
        return 0;
    }
    let copy = buf.id.len().min(max_len as usize);
    let out = (out_ptr as u64) as usize as *mut u8;
    unsafe { std::ptr::copy_nonoverlapping(buf.id.as_ptr(), out, copy) };
    copy as u32
}
