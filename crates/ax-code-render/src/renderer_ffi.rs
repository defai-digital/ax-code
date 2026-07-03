//! ADR-046 Slice E — napi exports for the `renderer*` dlopen symbol family.
//! Names and signatures mirror the Zig `lib.zig` export glue so these become
//! the production implementations when `AX_CODE_NATIVE_RENDER` promotes to the
//! full symbol set. Handles are u32 generational registry handles (renderers
//! and their borrowed child buffers share the same registry as `buffer_ffi`).

use crate::buffer::Rgba;
use crate::buffer_ffi::global_pool;
use crate::handles::{self, Kind};
use crate::renderer::{CliRenderer, OutputKind};
use crate::terminal::RemoteMode;
use napi::bindgen_prelude::BigInt;
use napi_derive::napi;

fn resolve(handle: u32) -> Option<&'static mut CliRenderer> {
    handles::get(handle, Kind::Renderer).map(|ptr| unsafe { &mut *(ptr as *mut CliRenderer) })
}

unsafe fn read_rgba(addr: f64) -> Rgba {
    let p = (addr as u64) as usize as *const u16;
    unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] }
}

#[napi(js_name = "createRenderer")]
pub fn create_renderer(
    width: u32,
    height: u32,
    buffered_destination_kind: u32,
    remote_mode_value: u32,
    feed_ptr: f64,
) -> u32 {
    // Only the memory/stdout buffered backends are ported; the span-feed
    // transport is a later tranche. The harness (and the TUI's default path)
    // uses the buffered backend, so a non-null feed pointer is rejected.
    if feed_ptr != 0.0 {
        return 0;
    }
    // bufferedDestinationKind: 0 = stdout, 1 = memory (renderer.zig createRenderer).
    let output = match buffered_destination_kind {
        0 => OutputKind::Stdout,
        1 => OutputKind::Memory,
        _ => return 0,
    };
    let remote_mode = RemoteMode::from_code(remote_mode_value as u8);
    let Some(renderer) = CliRenderer::create(width, height, output, remote_mode) else {
        return 0;
    };
    let ptr = Box::into_raw(renderer) as usize;
    let handle = handles::insert(Kind::Renderer, ptr);
    if handle == 0 {
        let mut boxed = unsafe { Box::from_raw(ptr as *mut CliRenderer) };
        boxed.invalidate_child_handles();
        return 0;
    }
    handle
}

#[napi(js_name = "destroyRenderer")]
pub fn destroy_renderer(handle: u32) {
    if let Some(ptr) = handles::remove(handle, Kind::Renderer) {
        let mut boxed = unsafe { Box::from_raw(ptr as *mut CliRenderer) };
        // Zig destroy order: performShutdownSequence emits teardown ANSI first
        // (no-op unless setupTerminal ran), then the renderer is torn down.
        boxed.perform_shutdown_sequence();
        boxed.invalidate_child_handles();
        boxed.release_pool_refs(&mut global_pool());
        drop(boxed);
    }
}

/// ExternalRenderStats extern struct (C ABI, 56 bytes):
///   f64 last_frame_time @0, f64 average_frame_time @8, f64 render_time @16,
///   f64 stdout_write_time @24, u64 frame_count @32, u32 cells_updated @40,
///   u32 average_cells_updated @44, bool render_time_valid @48,
///   bool stdout_write_time_valid @49.
#[napi(js_name = "getRenderStats")]
pub fn get_render_stats(handle: u32, out_ptr: f64) {
    if out_ptr == 0.0 {
        return;
    }
    let base = (out_ptr as u64) as usize;
    let (
        last_frame_time,
        average_frame_time,
        render_time,
        write_time,
        frame_count,
        cells_updated,
        average_cells_updated,
        render_time_valid,
        write_time_valid,
    ) = match resolve(handle) {
        Some(r) => r.get_render_stats(),
        None => (0.0, 0.0, 0.0, 0.0, 0, 0, 0, false, false),
    };
    unsafe {
        (base as *mut f64).write_unaligned(last_frame_time);
        ((base + 8) as *mut f64).write_unaligned(average_frame_time);
        ((base + 16) as *mut f64).write_unaligned(render_time);
        ((base + 24) as *mut f64).write_unaligned(write_time);
        ((base + 32) as *mut u64).write_unaligned(frame_count);
        ((base + 40) as *mut u32).write_unaligned(cells_updated);
        ((base + 44) as *mut u32).write_unaligned(average_cells_updated);
        ((base + 48) as *mut u8).write_unaligned(render_time_valid as u8);
        ((base + 49) as *mut u8).write_unaligned(write_time_valid as u8);
    }
}

#[napi(js_name = "addToHitGrid")]
pub fn add_to_hit_grid(handle: u32, x: i32, y: i32, width: u32, height: u32, id: u32) {
    if let Some(r) = resolve(handle) {
        r.add_to_hit_grid(x, y, width, height, id);
    }
}

#[napi(js_name = "addToCurrentHitGridClipped")]
pub fn add_to_current_hit_grid_clipped(
    handle: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    id: u32,
) {
    if let Some(r) = resolve(handle) {
        r.add_to_current_hit_grid_clipped(x, y, width, height, id);
    }
}

#[napi(js_name = "checkHit")]
pub fn check_hit(handle: u32, x: u32, y: u32) -> u32 {
    resolve(handle).map_or(0, |r| r.check_hit(x, y))
}

#[napi(js_name = "clearCurrentHitGrid")]
pub fn clear_current_hit_grid(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.clear_current_hit_grid();
    }
}

#[napi(js_name = "getHitGridDirty")]
pub fn get_hit_grid_dirty(handle: u32) -> bool {
    resolve(handle).is_some_and(|r| r.get_hit_grid_dirty())
}

#[napi(js_name = "hitGridPushScissorRect")]
pub fn hit_grid_push_scissor_rect(handle: u32, x: i32, y: i32, width: u32, height: u32) {
    if let Some(r) = resolve(handle) {
        r.hit_grid_push_scissor_rect(x, y, width, height);
    }
}

#[napi(js_name = "hitGridPopScissorRect")]
pub fn hit_grid_pop_scissor_rect(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.hit_grid_pop_scissor_rect();
    }
}

#[napi(js_name = "hitGridClearScissorRects")]
pub fn hit_grid_clear_scissor_rects(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.hit_grid_clear_scissor_rects();
    }
}

#[napi(js_name = "dumpHitGrid")]
pub fn dump_hit_grid(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.dump_hit_grid();
    }
}

#[napi(js_name = "enableKittyKeyboard")]
pub fn enable_kitty_keyboard(handle: u32, flags: u32) {
    if let Some(r) = resolve(handle) {
        r.enable_kitty_keyboard(flags as u8);
    }
}

#[napi(js_name = "disableKittyKeyboard")]
pub fn disable_kitty_keyboard(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.disable_kitty_keyboard();
    }
}

#[napi(js_name = "setKittyKeyboardFlags")]
pub fn set_kitty_keyboard_flags(handle: u32, flags: u32) {
    if let Some(r) = resolve(handle) {
        r.set_kitty_keyboard_flags(flags as u8);
    }
}

#[napi(js_name = "getKittyKeyboardFlags")]
pub fn get_kitty_keyboard_flags(handle: u32) -> u32 {
    resolve(handle).map_or(0, |r| r.get_kitty_keyboard_flags() as u32)
}

#[napi(js_name = "enableMouse")]
pub fn enable_mouse(handle: u32, enable_movement: f64) {
    if let Some(r) = resolve(handle) {
        r.enable_mouse(enable_movement != 0.0);
    }
}

#[napi(js_name = "disableMouse")]
pub fn disable_mouse(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.disable_mouse();
    }
}

#[napi(js_name = "setTerminalTitle")]
pub fn set_terminal_title(handle: u32, title_ptr: f64, title_len: u32) {
    let Some(r) = resolve(handle) else { return };
    let title = if title_ptr == 0.0 || title_len == 0 {
        String::new()
    } else {
        let p = (title_ptr as u64) as usize as *const u8;
        let bytes = unsafe { std::slice::from_raw_parts(p, title_len as usize) };
        String::from_utf8_lossy(bytes).into_owned()
    };
    r.set_terminal_title(&title);
}

#[napi(js_name = "queryThemeColors")]
pub fn query_theme_colors(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.query_theme_colors();
    }
}

#[napi(js_name = "queryPixelResolution")]
pub fn query_pixel_resolution(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.query_pixel_resolution();
    }
}

/// CursorStyleOptions extern struct: u8 style @0, u8 blinking @1, ptr color @8,
/// u8 cursor @16.
#[napi(js_name = "setCursorStyleOptions")]
pub fn set_cursor_style_options(handle: u32, options_ptr: f64) {
    let Some(r) = resolve(handle) else { return };
    if options_ptr == 0.0 {
        return;
    }
    let base = (options_ptr as u64) as usize;
    let (style, blinking, color_ptr, cursor) = unsafe {
        (
            *(base as *const u8),
            *((base + 1) as *const u8),
            *((base + 8) as *const usize),
            *((base + 16) as *const u8),
        )
    };
    let color = if color_ptr == 0 {
        None
    } else {
        let p = color_ptr as *const u16;
        Some(unsafe { [*p, *p.add(1), *p.add(2), *p.add(3)] })
    };
    r.set_cursor_style_options(style, blinking, color, cursor);
}

#[napi(js_name = "suspendRenderer")]
pub fn suspend_renderer(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.suspend_renderer();
    }
}

#[napi(js_name = "resumeRenderer")]
pub fn resume_renderer(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.resume_renderer();
    }
}

#[napi(js_name = "getNextBuffer")]
pub fn get_next_buffer(handle: u32) -> u32 {
    resolve(handle).map_or(0, |r| r.next_handle())
}

#[napi(js_name = "getCurrentBuffer")]
pub fn get_current_buffer(handle: u32) -> u32 {
    resolve(handle).map_or(0, |r| r.current_handle())
}

#[napi(js_name = "render")]
pub fn render(handle: u32, force: f64) -> u32 {
    match resolve(handle) {
        Some(r) => r.render(force != 0.0) as u32,
        None => 2, // RenderStatus.failed
    }
}

#[napi(js_name = "dumpOutputBuffer")]
pub fn dump_output_buffer(handle: u32, timestamp: f64) {
    if let Some(r) = resolve(handle) {
        r.dump_output_buffer(timestamp as i64);
    }
}

#[napi(js_name = "resetSplitScrollback")]
pub fn reset_split_scrollback(handle: u32, seed_rows: u32, pinned_render_offset: u32) -> u32 {
    resolve(handle).map_or(0, |r| {
        r.reset_split_scrollback(seed_rows, pinned_render_offset)
    })
}

#[napi(js_name = "syncSplitScrollback")]
pub fn sync_split_scrollback(handle: u32, pinned_render_offset: u32) -> u32 {
    resolve(handle).map_or(0, |r| r.sync_split_scrollback(pinned_render_offset))
}

#[napi(js_name = "getSplitOutputOffset")]
pub fn get_split_output_offset(handle: u32, surface_offset: u32) -> u32 {
    resolve(handle).map_or(0, |r| r.get_split_output_offset(surface_offset))
}

#[napi(js_name = "setPendingSplitFooterTransition")]
pub fn set_pending_split_footer_transition(
    handle: u32,
    mode: u32,
    source_top_line: u32,
    source_height: u32,
    target_top_line: u32,
    target_height: u32,
    scroll_lines: u32,
) {
    if let Some(r) = resolve(handle) {
        r.set_pending_split_footer_transition(
            mode as u8,
            source_top_line,
            source_height,
            target_top_line,
            target_height,
            scroll_lines,
        );
    }
}

#[napi(js_name = "clearPendingSplitFooterTransition")]
pub fn clear_pending_split_footer_transition(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.clear_pending_split_footer_transition();
    }
}

#[napi(js_name = "repaintSplitFooter")]
pub fn repaint_split_footer(handle: u32, pinned_render_offset: u32, force: f64) -> BigInt {
    let packed = match resolve(handle) {
        Some(r) => r.repaint_split_footer(pinned_render_offset, force != 0.0),
        None => 2u64 << 32, // failed status, offset 0
    };
    BigInt::from(packed)
}

#[napi(js_name = "setUseThread")]
pub fn set_use_thread(handle: u32, use_thread: f64) {
    if let Some(r) = resolve(handle) {
        r.set_use_thread(use_thread != 0.0);
    }
}

#[napi(js_name = "updateStats")]
pub fn update_stats(handle: u32, time: f64, fps: u32, frame_callback_time: f64) {
    if let Some(r) = resolve(handle) {
        r.update_stats(time, fps, frame_callback_time);
    }
}

#[napi(js_name = "updateMemoryStats")]
pub fn update_memory_stats(handle: u32, heap_used: u32, heap_total: u32, array_buffers: u32) {
    if let Some(r) = resolve(handle) {
        r.update_memory_stats(heap_used, heap_total, array_buffers);
    }
}

#[napi(js_name = "resizeRenderer")]
pub fn resize_renderer(handle: u32, width: u32, height: u32) {
    if let Some(r) = resolve(handle) {
        r.resize(width, height);
    }
}

#[napi(js_name = "setRenderOffset")]
pub fn set_render_offset(handle: u32, offset: u32) {
    if let Some(r) = resolve(handle) {
        r.set_render_offset(offset);
    }
}

#[napi(js_name = "setBackgroundColor")]
pub fn set_background_color(handle: u32, color: f64) {
    if let Some(r) = resolve(handle) {
        r.set_background_color(unsafe { read_rgba(color) });
    }
}

#[napi(js_name = "rendererSetPaletteState")]
pub fn renderer_set_palette_state(
    handle: u32,
    palette_ptr: f64,
    palette_len: u32,
    default_fg_ptr: f64,
    default_bg_ptr: f64,
    palette_epoch: u32,
) {
    let Some(r) = resolve(handle) else { return };
    if palette_len < 256 || palette_ptr == 0.0 {
        return;
    }
    // palette is 256 x RGBA([4]u16) laid out contiguously.
    let base = (palette_ptr as u64) as usize as *const u16;
    let mut palette = [[0u16; 4]; 256];
    for (i, entry) in palette.iter_mut().enumerate() {
        let off = i * 4;
        *entry = unsafe {
            [
                *base.add(off),
                *base.add(off + 1),
                *base.add(off + 2),
                *base.add(off + 3),
            ]
        };
    }
    r.set_palette_state(
        &palette,
        unsafe { read_rgba(default_fg_ptr) },
        unsafe { read_rgba(default_bg_ptr) },
        palette_epoch,
    );
}

#[napi(js_name = "setupTerminal")]
pub fn setup_terminal(handle: u32, use_alternate_screen: f64) {
    if let Some(r) = resolve(handle) {
        r.setup_terminal(use_alternate_screen != 0.0);
    }
}

#[napi(js_name = "restoreTerminalModes")]
pub fn restore_terminal_modes(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.restore_terminal_modes();
    }
}

#[napi(js_name = "setCursorPosition")]
pub fn set_cursor_position(handle: u32, x: i32, y: i32, visible: f64) {
    if let Some(r) = resolve(handle) {
        r.set_cursor_position(x, y, visible != 0.0);
    }
}

#[napi(js_name = "clearTerminal")]
pub fn clear_terminal(handle: u32) {
    if let Some(r) = resolve(handle) {
        r.clear_terminal();
    }
}

#[napi(js_name = "setClearOnShutdown")]
pub fn set_clear_on_shutdown(handle: u32, clear: f64) {
    if let Some(r) = resolve(handle) {
        r.set_clear_on_shutdown(clear != 0.0);
    }
}
