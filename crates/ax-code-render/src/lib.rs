//! ax-code-render — Rust napi replacement for the OpenTUI native layer (ADR-046).
//!
//! Phase 1 scope: the yoga/flexbox subsystem (48 symbols) plus no-op audio
//! stubs (23 symbols). Function names and semantics mirror the `dlopen`
//! symbol table of the upstream Zig library exactly, so the vendored
//! `@ax-code/opentui-core` JS can route these symbols to this addon behind
//! `AX_CODE_NATIVE_RENDER=1` with zero JS-visible behavior change.
//!
//! Contract notes (probed against the Zig backend):
//! - Handles are raw pointers passed as JS numbers (< 2^53, exact in f64).
//! - `yogaNodeCreateForOpenTUI` behaves identically to `yogaNodeCreate`
//!   (same style defaults, rounding enabled).
//! - `yogaNodeStyleSetValue` unit dispatch: 0=Undefined -> point setter with
//!   NaN; 1=Point; 2=Percent; 3=Auto -> native auto setter where yoga has one
//!   (width/height/flex-basis/margin/position), otherwise NaN-point.
//! - `yogaNodeStyleGetValue` returns u64 BigInt: low 32 bits = unit, high 32
//!   bits = f32 bits of value. Gap reads back as Point unit (yoga's GetGap
//!   returns a bare float) — matches the Zig backend.
//! - Measure callbacks: JS passes a C function pointer (created by the FFI
//!   backend's trampoline machinery); yoga's measure trampoline calls it
//!   synchronously and the JS side reports the result via
//!   `yogaStoreMeasureResult`, which we hold in a thread-local.

#![allow(clippy::missing_safety_doc)]

pub mod buffer;
mod buffer_ffi;
pub mod gcb;
mod gcb_table;
pub mod handles;
pub mod mem_registry;
pub mod pool;
pub mod rope;
pub mod segment;
pub mod text_buffer;
mod text_buffer_ffi;
pub mod unicode;
mod width_table;
mod yoga_sys;

use napi::bindgen_prelude::BigInt;
use napi_derive::napi;
use std::cell::Cell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};
use yoga_sys::*;

// --- Slice A test surface (not part of the dlopen symbol table) ---------------

/// Test-only export for the unicode differential harness: mirrors the Zig
/// `encodeUnicode` observable output as a flat [width0, char0, width1, char1,
/// ...] array (char = codepoint for simple printable-ASCII cells, 0xFFFFFFFF
/// for pooled/special cells). The `__ax` prefix keeps it out of the overlay's
/// yoga/audio symbol families.
#[napi(js_name = "__axEncodeWidths")]
pub fn ax_encode_widths(text: String, width_method: u32) -> Vec<u32> {
    let cells = unicode::encode_widths(&text, unicode::WidthMethod::from_code(width_method), 2);
    let mut flat = Vec::with_capacity(cells.len() * 2);
    for (width, ch) in cells {
        flat.push(width);
        flat.push(ch);
    }
    flat
}

// --- handle <-> pointer -----------------------------------------------------

#[inline]
fn ptr_of(handle: f64) -> *mut c_void {
    (handle as u64) as usize as *mut c_void
}

#[inline]
fn handle_of(ptr: *const c_void) -> f64 {
    ptr as usize as f64
}

// --- measure / dirtied callback plumbing -------------------------------------

type JsMeasureCb = unsafe extern "C" fn(*mut c_void, f32, u32, f32, u32);
type JsDirtiedCb = unsafe extern "C" fn();

#[derive(Default, Clone, Copy)]
struct NodeCallbacks {
    measure: Option<JsMeasureCb>,
    dirtied: Option<JsDirtiedCb>,
}

fn callback_registry() -> &'static Mutex<HashMap<usize, NodeCallbacks>> {
    static REGISTRY: OnceLock<Mutex<HashMap<usize, NodeCallbacks>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

thread_local! {
    static MEASURE_RESULT: Cell<(f32, f32)> = const { Cell::new((f32::NAN, f32::NAN)) };
}

unsafe extern "C" fn measure_trampoline(
    node: YGNodeConstRef,
    width: f32,
    width_mode: i32,
    height: f32,
    height_mode: i32,
) -> YGSize {
    let cb = callback_registry()
        .lock()
        .unwrap()
        .get(&(node as usize))
        .and_then(|c| c.measure);
    match cb {
        Some(cb) => {
            MEASURE_RESULT.with(|r| r.set((f32::NAN, f32::NAN)));
            unsafe {
                cb(
                    node as *mut c_void,
                    width,
                    width_mode as u32,
                    height,
                    height_mode as u32,
                )
            };
            let (w, h) = MEASURE_RESULT.with(|r| r.get());
            YGSize {
                width: w,
                height: h,
            }
        }
        None => YGSize {
            width: f32::NAN,
            height: f32::NAN,
        },
    }
}

unsafe extern "C" fn dirtied_trampoline(node: YGNodeRef) {
    let cb = callback_registry()
        .lock()
        .unwrap()
        .get(&(node as usize))
        .and_then(|c| c.dirtied);
    if let Some(cb) = cb {
        unsafe { cb() };
    }
}

fn drop_node_callbacks(node: usize) {
    callback_registry().lock().unwrap().remove(&node);
}

fn collect_subtree(node: YGNodeRef, out: &mut Vec<usize>) {
    let count = unsafe { YGNodeGetChildCount(node) };
    for index in 0..count {
        let child = unsafe { YGNodeGetChild(node, index) };
        if !child.is_null() {
            collect_subtree(child, out);
        }
    }
    out.push(node as usize);
}

// --- config ------------------------------------------------------------------

#[napi(js_name = "yogaConfigCreate")]
pub fn yoga_config_create() -> f64 {
    handle_of(unsafe { YGConfigNew() } as *const c_void)
}

#[napi(js_name = "yogaConfigFree")]
pub fn yoga_config_free(config: f64) {
    unsafe { YGConfigFree(ptr_of(config)) }
}

#[napi(js_name = "yogaConfigSetUseWebDefaults")]
pub fn yoga_config_set_use_web_defaults(config: f64, enabled: f64) {
    unsafe { YGConfigSetUseWebDefaults(ptr_of(config), enabled != 0.0) }
}

#[napi(js_name = "yogaConfigGetUseWebDefaults")]
pub fn yoga_config_get_use_web_defaults(config: f64) -> bool {
    unsafe { YGConfigGetUseWebDefaults(ptr_of(config)) }
}

#[napi(js_name = "yogaConfigSetPointScaleFactor")]
pub fn yoga_config_set_point_scale_factor(config: f64, factor: f64) {
    unsafe { YGConfigSetPointScaleFactor(ptr_of(config), factor as f32) }
}

#[napi(js_name = "yogaConfigGetPointScaleFactor")]
pub fn yoga_config_get_point_scale_factor(config: f64) -> f64 {
    unsafe { YGConfigGetPointScaleFactor(ptr_of(config)) as f64 }
}

#[napi(js_name = "yogaConfigSetErrata")]
pub fn yoga_config_set_errata(config: f64, errata: u32) {
    unsafe { YGConfigSetErrata(ptr_of(config), errata as i32) }
}

#[napi(js_name = "yogaConfigGetErrata")]
pub fn yoga_config_get_errata(config: f64) -> u32 {
    unsafe { YGConfigGetErrata(ptr_of(config)) as u32 }
}

#[napi(js_name = "yogaConfigSetExperimentalFeatureEnabled")]
pub fn yoga_config_set_experimental_feature_enabled(config: f64, feature: u32, enabled: f64) {
    unsafe { YGConfigSetExperimentalFeatureEnabled(ptr_of(config), feature as i32, enabled != 0.0) }
}

#[napi(js_name = "yogaConfigIsExperimentalFeatureEnabled")]
pub fn yoga_config_is_experimental_feature_enabled(config: f64, feature: u32) -> bool {
    unsafe { YGConfigIsExperimentalFeatureEnabled(ptr_of(config), feature as i32) }
}

// --- node lifecycle ----------------------------------------------------------

#[napi(js_name = "yogaNodeCreate")]
pub fn yoga_node_create() -> f64 {
    handle_of(unsafe { YGNodeNew() } as *const c_void)
}

#[napi(js_name = "yogaNodeCreateForOpenTUI")]
pub fn yoga_node_create_for_opentui() -> f64 {
    // Probed against the Zig backend: identical defaults to a plain node
    // (classic errata behavior, pixel-grid rounding enabled, no web defaults).
    handle_of(unsafe { YGNodeNew() } as *const c_void)
}

#[napi(js_name = "yogaNodeCreateWithConfig")]
pub fn yoga_node_create_with_config(config: f64) -> f64 {
    handle_of(unsafe { YGNodeNewWithConfig(ptr_of(config)) } as *const c_void)
}

#[napi(js_name = "yogaNodeFree")]
pub fn yoga_node_free(node: f64) {
    let raw = ptr_of(node);
    drop_node_callbacks(raw as usize);
    unsafe { YGNodeFree(raw) }
}

#[napi(js_name = "yogaNodeFreeRecursive")]
pub fn yoga_node_free_recursive(node: f64) {
    let raw = ptr_of(node);
    let mut subtree = Vec::new();
    collect_subtree(raw, &mut subtree);
    unsafe { YGNodeFreeRecursive(raw) };
    for ptr in subtree {
        drop_node_callbacks(ptr);
    }
}

#[napi(js_name = "yogaNodeReset")]
pub fn yoga_node_reset(node: f64) {
    let raw = ptr_of(node);
    drop_node_callbacks(raw as usize);
    unsafe { YGNodeReset(raw) }
}

#[napi(js_name = "yogaNodeCopyStyle")]
pub fn yoga_node_copy_style(dst: f64, src: f64) {
    unsafe { YGNodeCopyStyle(ptr_of(dst), ptr_of(src)) }
}

#[napi(js_name = "yogaNodeInsertChild")]
pub fn yoga_node_insert_child(node: f64, child: f64, index: u32) {
    unsafe { YGNodeInsertChild(ptr_of(node), ptr_of(child), index as usize) }
}

#[napi(js_name = "yogaNodeRemoveChild")]
pub fn yoga_node_remove_child(node: f64, child: f64) {
    unsafe { YGNodeRemoveChild(ptr_of(node), ptr_of(child)) }
}

#[napi(js_name = "yogaNodeRemoveAllChildren")]
pub fn yoga_node_remove_all_children(node: f64) {
    unsafe { YGNodeRemoveAllChildren(ptr_of(node)) }
}

#[napi(js_name = "yogaNodeGetChild")]
pub fn yoga_node_get_child(node: f64, index: u32) -> f64 {
    handle_of(unsafe { YGNodeGetChild(ptr_of(node), index as usize) } as *const c_void)
}

#[napi(js_name = "yogaNodeGetChildCount")]
pub fn yoga_node_get_child_count(node: f64) -> u32 {
    unsafe { YGNodeGetChildCount(ptr_of(node)) as u32 }
}

#[napi(js_name = "yogaNodeGetParent")]
pub fn yoga_node_get_parent(node: f64) -> f64 {
    handle_of(unsafe { YGNodeGetParent(ptr_of(node)) } as *const c_void)
}

// --- layout ------------------------------------------------------------------

#[napi(js_name = "yogaNodeCalculateLayout")]
pub fn yoga_node_calculate_layout(node: f64, width: f64, height: f64, direction: u32) {
    unsafe { YGNodeCalculateLayout(ptr_of(node), width as f32, height as f32, direction as i32) }
}

#[napi(js_name = "yogaNodeIsDirty")]
pub fn yoga_node_is_dirty(node: f64) -> bool {
    unsafe { YGNodeIsDirty(ptr_of(node)) }
}

#[napi(js_name = "yogaNodeMarkDirty")]
pub fn yoga_node_mark_dirty(node: f64) {
    unsafe { YGNodeMarkDirty(ptr_of(node)) }
}

#[napi(js_name = "yogaNodeGetHasNewLayout")]
pub fn yoga_node_get_has_new_layout(node: f64) -> bool {
    unsafe { YGNodeGetHasNewLayout(ptr_of(node)) }
}

#[napi(js_name = "yogaNodeSetHasNewLayout")]
pub fn yoga_node_set_has_new_layout(node: f64, has_new_layout: f64) {
    unsafe { YGNodeSetHasNewLayout(ptr_of(node), has_new_layout != 0.0) }
}

#[napi(js_name = "yogaNodeSetIsReferenceBaseline")]
pub fn yoga_node_set_is_reference_baseline(node: f64, value: f64) {
    unsafe { YGNodeSetIsReferenceBaseline(ptr_of(node), value != 0.0) }
}

#[napi(js_name = "yogaNodeIsReferenceBaseline")]
pub fn yoga_node_is_reference_baseline(node: f64) -> bool {
    unsafe { YGNodeIsReferenceBaseline(ptr_of(node)) }
}

#[napi(js_name = "yogaNodeSetAlwaysFormsContainingBlock")]
pub fn yoga_node_set_always_forms_containing_block(node: f64, value: f64) {
    unsafe { YGNodeSetAlwaysFormsContainingBlock(ptr_of(node), value != 0.0) }
}

#[napi(js_name = "yogaNodeGetAlwaysFormsContainingBlock")]
pub fn yoga_node_get_always_forms_containing_block(node: f64) -> bool {
    unsafe { YGNodeGetAlwaysFormsContainingBlock(ptr_of(node)) }
}

#[napi(js_name = "yogaNodeGetComputedLayout")]
pub fn yoga_node_get_computed_layout(node: f64, out: f64) {
    let raw = ptr_of(node);
    let out = ptr_of(out) as *mut f32;
    if out.is_null() {
        return;
    }
    unsafe {
        *out.add(0) = YGNodeLayoutGetLeft(raw);
        *out.add(1) = YGNodeLayoutGetTop(raw);
        *out.add(2) = YGNodeLayoutGetRight(raw);
        *out.add(3) = YGNodeLayoutGetBottom(raw);
        *out.add(4) = YGNodeLayoutGetWidth(raw);
        *out.add(5) = YGNodeLayoutGetHeight(raw);
    }
}

#[napi(js_name = "yogaNodeLayoutGetEdge")]
pub fn yoga_node_layout_get_edge(node: f64, kind: u32, edge: u32) -> f64 {
    let raw = ptr_of(node);
    let edge = edge as i32;
    let value = match kind {
        0 => unsafe { YGNodeLayoutGetMargin(raw, edge) },
        1 => unsafe { YGNodeLayoutGetPadding(raw, edge) },
        2 => unsafe { YGNodeLayoutGetBorder(raw, edge) },
        _ => f32::NAN,
    };
    value as f64
}

// --- style: enums ------------------------------------------------------------

#[napi(js_name = "yogaNodeStyleSetEnum")]
pub fn yoga_node_style_set_enum(node: f64, kind: u32, value: u32) {
    let raw = ptr_of(node);
    let v = value as i32;
    unsafe {
        match kind {
            0 => YGNodeStyleSetDirection(raw, v),
            1 => YGNodeStyleSetFlexDirection(raw, v),
            2 => YGNodeStyleSetJustifyContent(raw, v),
            3 => YGNodeStyleSetAlignContent(raw, v),
            4 => YGNodeStyleSetAlignItems(raw, v),
            5 => YGNodeStyleSetAlignSelf(raw, v),
            6 => YGNodeStyleSetPositionType(raw, v),
            7 => YGNodeStyleSetFlexWrap(raw, v),
            8 => YGNodeStyleSetOverflow(raw, v),
            9 => YGNodeStyleSetDisplay(raw, v),
            10 => YGNodeStyleSetBoxSizing(raw, v),
            _ => {}
        }
    }
}

#[napi(js_name = "yogaNodeStyleGetEnum")]
pub fn yoga_node_style_get_enum(node: f64, kind: u32) -> u32 {
    let raw = ptr_of(node);
    let value = unsafe {
        match kind {
            0 => YGNodeStyleGetDirection(raw),
            1 => YGNodeStyleGetFlexDirection(raw),
            2 => YGNodeStyleGetJustifyContent(raw),
            3 => YGNodeStyleGetAlignContent(raw),
            4 => YGNodeStyleGetAlignItems(raw),
            5 => YGNodeStyleGetAlignSelf(raw),
            6 => YGNodeStyleGetPositionType(raw),
            7 => YGNodeStyleGetFlexWrap(raw),
            8 => YGNodeStyleGetOverflow(raw),
            9 => YGNodeStyleGetDisplay(raw),
            10 => YGNodeStyleGetBoxSizing(raw),
            _ => 0,
        }
    };
    value as u32
}

// --- style: floats -----------------------------------------------------------

#[napi(js_name = "yogaNodeStyleSetFloat")]
pub fn yoga_node_style_set_float(node: f64, kind: u32, value: f64) {
    let raw = ptr_of(node);
    let v = value as f32;
    unsafe {
        match kind {
            0 => YGNodeStyleSetFlex(raw, v),
            1 => YGNodeStyleSetFlexGrow(raw, v),
            2 => YGNodeStyleSetFlexShrink(raw, v),
            3 => YGNodeStyleSetAspectRatio(raw, v),
            _ => {}
        }
    }
}

#[napi(js_name = "yogaNodeStyleGetFloat")]
pub fn yoga_node_style_get_float(node: f64, kind: u32) -> f64 {
    let raw = ptr_of(node);
    let value = unsafe {
        match kind {
            0 => YGNodeStyleGetFlex(raw),
            1 => YGNodeStyleGetFlexGrow(raw),
            2 => YGNodeStyleGetFlexShrink(raw),
            3 => YGNodeStyleGetAspectRatio(raw),
            _ => f32::NAN,
        }
    };
    value as f64
}

// --- style: border -----------------------------------------------------------

#[napi(js_name = "yogaNodeStyleSetBorder")]
pub fn yoga_node_style_set_border(node: f64, edge: u32, value: f64) {
    unsafe { YGNodeStyleSetBorder(ptr_of(node), edge as i32, value as f32) }
}

#[napi(js_name = "yogaNodeStyleGetBorder")]
pub fn yoga_node_style_get_border(node: f64, edge: u32) -> f64 {
    unsafe { YGNodeStyleGetBorder(ptr_of(node), edge as i32) as f64 }
}

// --- style: values -----------------------------------------------------------

const UNIT_UNDEFINED: u32 = 0;
const UNIT_POINT: u32 = 1;
const UNIT_PERCENT: u32 = 2;
const UNIT_AUTO: u32 = 3;

#[napi(js_name = "yogaNodeStyleSetValue")]
pub fn yoga_node_style_set_value(node: f64, kind: u32, edge_or_gutter: u32, unit: u32, value: f64) {
    let raw = ptr_of(node);
    let edge = edge_or_gutter as i32;
    let v = value as f32;
    // Undefined behaves as a NaN point-set (clears the style); Auto falls back
    // to a NaN point-set where yoga has no auto setter (probed: min/max/gap).
    let unit = if unit == UNIT_UNDEFINED {
        UNIT_POINT
    } else {
        unit
    };
    let v = if unit == UNIT_POINT && value.is_nan() {
        f32::NAN
    } else {
        v
    };
    unsafe {
        match (kind, unit) {
            (0, UNIT_POINT) => YGNodeStyleSetWidth(raw, v),
            (0, UNIT_PERCENT) => YGNodeStyleSetWidthPercent(raw, v),
            (0, UNIT_AUTO) => YGNodeStyleSetWidthAuto(raw),
            (1, UNIT_POINT) => YGNodeStyleSetHeight(raw, v),
            (1, UNIT_PERCENT) => YGNodeStyleSetHeightPercent(raw, v),
            (1, UNIT_AUTO) => YGNodeStyleSetHeightAuto(raw),
            (2, UNIT_POINT) => YGNodeStyleSetMinWidth(raw, v),
            (2, UNIT_PERCENT) => YGNodeStyleSetMinWidthPercent(raw, v),
            (2, UNIT_AUTO) => YGNodeStyleSetMinWidth(raw, f32::NAN),
            (3, UNIT_POINT) => YGNodeStyleSetMinHeight(raw, v),
            (3, UNIT_PERCENT) => YGNodeStyleSetMinHeightPercent(raw, v),
            (3, UNIT_AUTO) => YGNodeStyleSetMinHeight(raw, f32::NAN),
            (4, UNIT_POINT) => YGNodeStyleSetMaxWidth(raw, v),
            (4, UNIT_PERCENT) => YGNodeStyleSetMaxWidthPercent(raw, v),
            (4, UNIT_AUTO) => YGNodeStyleSetMaxWidth(raw, f32::NAN),
            (5, UNIT_POINT) => YGNodeStyleSetMaxHeight(raw, v),
            (5, UNIT_PERCENT) => YGNodeStyleSetMaxHeightPercent(raw, v),
            (5, UNIT_AUTO) => YGNodeStyleSetMaxHeight(raw, f32::NAN),
            (6, UNIT_POINT) => YGNodeStyleSetFlexBasis(raw, v),
            (6, UNIT_PERCENT) => YGNodeStyleSetFlexBasisPercent(raw, v),
            (6, UNIT_AUTO) => YGNodeStyleSetFlexBasisAuto(raw),
            (7, UNIT_POINT) => YGNodeStyleSetMargin(raw, edge, v),
            (7, UNIT_PERCENT) => YGNodeStyleSetMarginPercent(raw, edge, v),
            (7, UNIT_AUTO) => YGNodeStyleSetMarginAuto(raw, edge),
            (8, UNIT_POINT) => YGNodeStyleSetPadding(raw, edge, v),
            (8, UNIT_PERCENT) => YGNodeStyleSetPaddingPercent(raw, edge, v),
            (8, UNIT_AUTO) => YGNodeStyleSetPadding(raw, edge, f32::NAN),
            (9, UNIT_POINT) => YGNodeStyleSetPosition(raw, edge, v),
            (9, UNIT_PERCENT) => YGNodeStyleSetPositionPercent(raw, edge, v),
            (9, UNIT_AUTO) => YGNodeStyleSetPositionAuto(raw, edge),
            (10, UNIT_POINT) => YGNodeStyleSetGap(raw, edge, v),
            (10, UNIT_PERCENT) => YGNodeStyleSetGapPercent(raw, edge, v),
            (10, UNIT_AUTO) => YGNodeStyleSetGap(raw, edge, f32::NAN),
            _ => {}
        }
    }
}

fn pack_value(value: f32, unit: u32) -> u64 {
    ((value.to_bits() as u64) << 32) | unit as u64
}

fn pack_yg_value(v: YGValue) -> u64 {
    pack_value(v.value, v.unit as u32)
}

#[napi(js_name = "yogaNodeStyleGetValue")]
pub fn yoga_node_style_get_value(node: f64, kind: u32, edge_or_gutter: u32) -> BigInt {
    let raw = ptr_of(node);
    let edge = edge_or_gutter as i32;
    let packed = unsafe {
        match kind {
            0 => pack_yg_value(YGNodeStyleGetWidth(raw)),
            1 => pack_yg_value(YGNodeStyleGetHeight(raw)),
            2 => pack_yg_value(YGNodeStyleGetMinWidth(raw)),
            3 => pack_yg_value(YGNodeStyleGetMinHeight(raw)),
            4 => pack_yg_value(YGNodeStyleGetMaxWidth(raw)),
            5 => pack_yg_value(YGNodeStyleGetMaxHeight(raw)),
            6 => pack_yg_value(YGNodeStyleGetFlexBasis(raw)),
            7 => pack_yg_value(YGNodeStyleGetMargin(raw, edge)),
            8 => pack_yg_value(YGNodeStyleGetPadding(raw, edge)),
            9 => pack_yg_value(YGNodeStyleGetPosition(raw, edge)),
            10 => {
                // Yoga's GetGap returns a bare float; the Zig backend reports
                // Point unit for finite values and Undefined for NaN (probed).
                let gap = YGNodeStyleGetGap(raw, edge);
                if gap.is_nan() {
                    pack_value(f32::NAN, UNIT_UNDEFINED)
                } else {
                    pack_value(gap, UNIT_POINT)
                }
            }
            _ => pack_value(f32::NAN, UNIT_UNDEFINED),
        }
    };
    BigInt::from(packed)
}

// --- measure / dirtied funcs ---------------------------------------------------

#[napi(js_name = "yogaNodeSetMeasureFunc")]
pub fn yoga_node_set_measure_func(node: f64, callback: f64) {
    let raw = ptr_of(node);
    let cb_ptr = ptr_of(callback);
    if cb_ptr.is_null() {
        return;
    }
    let cb: JsMeasureCb = unsafe { std::mem::transmute::<*mut c_void, JsMeasureCb>(cb_ptr) };
    callback_registry()
        .lock()
        .unwrap()
        .entry(raw as usize)
        .or_default()
        .measure = Some(cb);
    unsafe { YGNodeSetMeasureFunc(raw, Some(measure_trampoline)) }
}

#[napi(js_name = "yogaNodeUnsetMeasureFunc")]
pub fn yoga_node_unset_measure_func(node: f64) {
    let raw = ptr_of(node);
    if let Some(cbs) = callback_registry().lock().unwrap().get_mut(&(raw as usize)) {
        cbs.measure = None;
    }
    unsafe { YGNodeSetMeasureFunc(raw, None) }
}

#[napi(js_name = "yogaNodeHasMeasureFunc")]
pub fn yoga_node_has_measure_func(node: f64) -> bool {
    unsafe { YGNodeHasMeasureFunc(ptr_of(node)) }
}

#[napi(js_name = "yogaNodeSetDirtiedFunc")]
pub fn yoga_node_set_dirtied_func(node: f64, callback: f64) {
    let raw = ptr_of(node);
    let cb_ptr = ptr_of(callback);
    if cb_ptr.is_null() {
        return;
    }
    let cb: JsDirtiedCb = unsafe { std::mem::transmute::<*mut c_void, JsDirtiedCb>(cb_ptr) };
    callback_registry()
        .lock()
        .unwrap()
        .entry(raw as usize)
        .or_default()
        .dirtied = Some(cb);
    unsafe { YGNodeSetDirtiedFunc(raw, Some(dirtied_trampoline)) }
}

#[napi(js_name = "yogaNodeUnsetDirtiedFunc")]
pub fn yoga_node_unset_dirtied_func(node: f64) {
    let raw = ptr_of(node);
    if let Some(cbs) = callback_registry().lock().unwrap().get_mut(&(raw as usize)) {
        cbs.dirtied = None;
    }
    unsafe { YGNodeSetDirtiedFunc(raw, None) }
}

#[napi(js_name = "yogaStoreMeasureResult")]
pub fn yoga_store_measure_result(width: f64, height: f64) {
    MEASURE_RESULT.with(|r| r.set((width as f32, height as f32)));
}

// --- audio stubs (ADR-046 Phase 1: the TUI never calls audio; these keep the
// --- symbol table complete so the Zig library is not needed for them) --------

#[napi(js_name = "createAudioEngine")]
pub fn create_audio_engine(_options: f64) -> u32 {
    0
}

#[napi(js_name = "destroyAudioEngine")]
pub fn destroy_audio_engine(_engine: u32) {}

#[napi(js_name = "audioRefreshPlaybackDevices")]
pub fn audio_refresh_playback_devices(_engine: u32) -> i32 {
    -1
}

#[napi(js_name = "audioGetPlaybackDeviceCount")]
pub fn audio_get_playback_device_count(_engine: u32) -> u32 {
    0
}

#[napi(js_name = "audioGetPlaybackDeviceName")]
pub fn audio_get_playback_device_name(_engine: u32, _index: u32, _out: f64, _cap: u32) -> u32 {
    0
}

#[napi(js_name = "audioIsPlaybackDeviceDefault")]
pub fn audio_is_playback_device_default(_engine: u32, _index: u32) -> bool {
    false
}

#[napi(js_name = "audioSelectPlaybackDevice")]
pub fn audio_select_playback_device(_engine: u32, _index: u32) -> i32 {
    -1
}

#[napi(js_name = "audioClearPlaybackDeviceSelection")]
pub fn audio_clear_playback_device_selection(_engine: u32) {}

#[napi(js_name = "audioStart")]
pub fn audio_start(_engine: u32, _options: f64) -> i32 {
    -1
}

#[napi(js_name = "audioStartMixer")]
pub fn audio_start_mixer(_engine: u32) -> i32 {
    -1
}

#[napi(js_name = "audioStop")]
pub fn audio_stop(_engine: u32) -> i32 {
    -1
}

#[napi(js_name = "audioLoad")]
pub fn audio_load(_engine: u32, _data: f64, _len: u32, _options: f64) -> i32 {
    -1
}

#[napi(js_name = "audioUnload")]
pub fn audio_unload(_engine: u32, _sound: u32) -> i32 {
    -1
}

#[napi(js_name = "audioPlay")]
pub fn audio_play(_engine: u32, _sound: u32, _a: f64, _b: f64) -> i32 {
    -1
}

#[napi(js_name = "audioStopVoice")]
pub fn audio_stop_voice(_engine: u32, _voice: u32) -> i32 {
    -1
}

#[napi(js_name = "audioSetVoiceGroup")]
pub fn audio_set_voice_group(_engine: u32, _voice: u32, _group: u32) -> i32 {
    -1
}

#[napi(js_name = "audioCreateGroup")]
pub fn audio_create_group(_engine: u32, _a: f64, _b: u32, _c: f64) -> i32 {
    -1
}

#[napi(js_name = "audioSetGroupVolume")]
pub fn audio_set_group_volume(_engine: u32, _group: u32, _volume: f64) -> i32 {
    -1
}

#[napi(js_name = "audioSetMasterVolume")]
pub fn audio_set_master_volume(_engine: u32, _volume: f64) -> i32 {
    -1
}

#[napi(js_name = "audioMixToBuffer")]
pub fn audio_mix_to_buffer(_engine: u32, _buf: f64, _frames: u32, _flags: u32) -> i32 {
    -1
}

#[napi(js_name = "audioEnableTap")]
pub fn audio_enable_tap(_engine: u32, _enabled: f64, _size: u32) -> i32 {
    -1
}

#[napi(js_name = "audioReadTap")]
pub fn audio_read_tap(_engine: u32, _buf: f64, _frames: u32, _flags: u32, _out: f64) -> i32 {
    -1
}

#[napi(js_name = "audioGetStats")]
pub fn audio_get_stats(_engine: u32, _out: f64) -> i32 {
    -1
}
