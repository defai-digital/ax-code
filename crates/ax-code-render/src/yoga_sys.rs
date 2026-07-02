//! Hand-written FFI declarations for the vendored facebook/yoga v3.2.1 C API.
//! Only the functions the ADR-046 Phase 1 surface needs are declared. Enums
//! are passed as `i32` — the JS layer already speaks yoga's numeric encodings.

use std::ffi::c_void;

pub type YGNodeRef = *mut c_void;
pub type YGNodeConstRef = *const c_void;
pub type YGConfigRef = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct YGSize {
    pub width: f32,
    pub height: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct YGValue {
    pub value: f32,
    pub unit: i32,
}

pub type YGMeasureFunc = Option<unsafe extern "C" fn(YGNodeConstRef, f32, i32, f32, i32) -> YGSize>;
pub type YGDirtiedFunc = Option<unsafe extern "C" fn(YGNodeRef)>;

unsafe extern "C" {
    // config
    pub fn YGConfigNew() -> YGConfigRef;
    pub fn YGConfigFree(config: YGConfigRef);
    pub fn YGConfigSetUseWebDefaults(config: YGConfigRef, enabled: bool);
    pub fn YGConfigGetUseWebDefaults(config: YGConfigRef) -> bool;
    pub fn YGConfigSetPointScaleFactor(config: YGConfigRef, factor: f32);
    pub fn YGConfigGetPointScaleFactor(config: YGConfigRef) -> f32;
    pub fn YGConfigSetErrata(config: YGConfigRef, errata: i32);
    pub fn YGConfigGetErrata(config: YGConfigRef) -> i32;
    pub fn YGConfigSetExperimentalFeatureEnabled(config: YGConfigRef, feature: i32, enabled: bool);
    pub fn YGConfigIsExperimentalFeatureEnabled(config: YGConfigRef, feature: i32) -> bool;

    // node lifecycle
    pub fn YGNodeNew() -> YGNodeRef;
    pub fn YGNodeNewWithConfig(config: YGConfigRef) -> YGNodeRef;
    pub fn YGNodeFree(node: YGNodeRef);
    pub fn YGNodeFreeRecursive(node: YGNodeRef);
    pub fn YGNodeReset(node: YGNodeRef);
    pub fn YGNodeCopyStyle(dst: YGNodeRef, src: YGNodeRef);
    pub fn YGNodeInsertChild(node: YGNodeRef, child: YGNodeRef, index: usize);
    pub fn YGNodeRemoveChild(node: YGNodeRef, child: YGNodeRef);
    pub fn YGNodeRemoveAllChildren(node: YGNodeRef);
    pub fn YGNodeGetChild(node: YGNodeRef, index: usize) -> YGNodeRef;
    pub fn YGNodeGetChildCount(node: YGNodeRef) -> usize;
    pub fn YGNodeGetParent(node: YGNodeRef) -> YGNodeRef;

    // layout
    pub fn YGNodeCalculateLayout(node: YGNodeRef, width: f32, height: f32, direction: i32);
    pub fn YGNodeIsDirty(node: YGNodeRef) -> bool;
    pub fn YGNodeMarkDirty(node: YGNodeRef);
    pub fn YGNodeGetHasNewLayout(node: YGNodeRef) -> bool;
    pub fn YGNodeSetHasNewLayout(node: YGNodeRef, has_new_layout: bool);
    pub fn YGNodeSetIsReferenceBaseline(node: YGNodeRef, value: bool);
    pub fn YGNodeIsReferenceBaseline(node: YGNodeRef) -> bool;
    pub fn YGNodeSetAlwaysFormsContainingBlock(node: YGNodeRef, value: bool);
    pub fn YGNodeGetAlwaysFormsContainingBlock(node: YGNodeRef) -> bool;
    pub fn YGNodeLayoutGetLeft(node: YGNodeRef) -> f32;
    pub fn YGNodeLayoutGetTop(node: YGNodeRef) -> f32;
    pub fn YGNodeLayoutGetRight(node: YGNodeRef) -> f32;
    pub fn YGNodeLayoutGetBottom(node: YGNodeRef) -> f32;
    pub fn YGNodeLayoutGetWidth(node: YGNodeRef) -> f32;
    pub fn YGNodeLayoutGetHeight(node: YGNodeRef) -> f32;
    pub fn YGNodeLayoutGetMargin(node: YGNodeRef, edge: i32) -> f32;
    pub fn YGNodeLayoutGetPadding(node: YGNodeRef, edge: i32) -> f32;
    pub fn YGNodeLayoutGetBorder(node: YGNodeRef, edge: i32) -> f32;

    // style: enums
    pub fn YGNodeStyleSetDirection(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetDirection(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetFlexDirection(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetFlexDirection(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetJustifyContent(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetJustifyContent(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetAlignContent(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetAlignContent(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetAlignItems(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetAlignItems(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetAlignSelf(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetAlignSelf(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetPositionType(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetPositionType(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetFlexWrap(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetFlexWrap(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetOverflow(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetOverflow(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetDisplay(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetDisplay(node: YGNodeRef) -> i32;
    pub fn YGNodeStyleSetBoxSizing(node: YGNodeRef, value: i32);
    pub fn YGNodeStyleGetBoxSizing(node: YGNodeRef) -> i32;

    // style: floats
    pub fn YGNodeStyleSetFlex(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetFlex(node: YGNodeRef) -> f32;
    pub fn YGNodeStyleSetFlexGrow(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetFlexGrow(node: YGNodeRef) -> f32;
    pub fn YGNodeStyleSetFlexShrink(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetFlexShrink(node: YGNodeRef) -> f32;
    pub fn YGNodeStyleSetAspectRatio(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetAspectRatio(node: YGNodeRef) -> f32;

    // style: border
    pub fn YGNodeStyleSetBorder(node: YGNodeRef, edge: i32, value: f32);
    pub fn YGNodeStyleGetBorder(node: YGNodeRef, edge: i32) -> f32;

    // style: values
    pub fn YGNodeStyleSetWidth(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetWidthPercent(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetWidthAuto(node: YGNodeRef);
    pub fn YGNodeStyleGetWidth(node: YGNodeRef) -> YGValue;
    pub fn YGNodeStyleSetHeight(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetHeightPercent(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetHeightAuto(node: YGNodeRef);
    pub fn YGNodeStyleGetHeight(node: YGNodeRef) -> YGValue;
    pub fn YGNodeStyleSetMinWidth(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetMinWidthPercent(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetMinWidth(node: YGNodeRef) -> YGValue;
    pub fn YGNodeStyleSetMinHeight(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetMinHeightPercent(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetMinHeight(node: YGNodeRef) -> YGValue;
    pub fn YGNodeStyleSetMaxWidth(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetMaxWidthPercent(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetMaxWidth(node: YGNodeRef) -> YGValue;
    pub fn YGNodeStyleSetMaxHeight(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetMaxHeightPercent(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleGetMaxHeight(node: YGNodeRef) -> YGValue;
    pub fn YGNodeStyleSetFlexBasis(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetFlexBasisPercent(node: YGNodeRef, value: f32);
    pub fn YGNodeStyleSetFlexBasisAuto(node: YGNodeRef);
    pub fn YGNodeStyleGetFlexBasis(node: YGNodeRef) -> YGValue;
    pub fn YGNodeStyleSetMargin(node: YGNodeRef, edge: i32, value: f32);
    pub fn YGNodeStyleSetMarginPercent(node: YGNodeRef, edge: i32, value: f32);
    pub fn YGNodeStyleSetMarginAuto(node: YGNodeRef, edge: i32);
    pub fn YGNodeStyleGetMargin(node: YGNodeRef, edge: i32) -> YGValue;
    pub fn YGNodeStyleSetPadding(node: YGNodeRef, edge: i32, value: f32);
    pub fn YGNodeStyleSetPaddingPercent(node: YGNodeRef, edge: i32, value: f32);
    pub fn YGNodeStyleGetPadding(node: YGNodeRef, edge: i32) -> YGValue;
    pub fn YGNodeStyleSetPosition(node: YGNodeRef, edge: i32, value: f32);
    pub fn YGNodeStyleSetPositionPercent(node: YGNodeRef, edge: i32, value: f32);
    pub fn YGNodeStyleSetPositionAuto(node: YGNodeRef, edge: i32);
    pub fn YGNodeStyleGetPosition(node: YGNodeRef, edge: i32) -> YGValue;
    pub fn YGNodeStyleSetGap(node: YGNodeRef, gutter: i32, value: f32);
    pub fn YGNodeStyleSetGapPercent(node: YGNodeRef, gutter: i32, value: f32);
    pub fn YGNodeStyleGetGap(node: YGNodeRef, gutter: i32) -> f32;

    // measure / dirtied
    pub fn YGNodeSetMeasureFunc(node: YGNodeRef, func: YGMeasureFunc);
    pub fn YGNodeHasMeasureFunc(node: YGNodeRef) -> bool;
    pub fn YGNodeSetDirtiedFunc(node: YGNodeRef, func: YGDirtiedFunc);
}
