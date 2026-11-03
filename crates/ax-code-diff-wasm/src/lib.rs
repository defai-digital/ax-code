//! Worker-hosted Wasm binding. Cancellation terminates the worker; no host
//! filesystem, network, process, clock or shared-memory imports are required.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn abi_version() -> u32 {
    1
}

#[wasm_bindgen]
pub fn duplicate_groups(tokens_json: &str, threshold: f64) -> Result<String, JsValue> {
    ax_code_diff_core::duplicates::groups(tokens_json, threshold, &|| false)
        .map_err(|error| JsValue::from_str(&error.reason))
}

#[wasm_bindgen]
pub fn diff_preview(before: &str, after: &str, normalize: bool) -> Result<String, JsValue> {
    ax_code_diff_core::preview::preview(before, after, normalize, &|| false)
        .map_err(|error| JsValue::from_str(&error.reason))
}

#[wasm_bindgen]
pub fn apply_patch_content(
    file: &str,
    original: &str,
    chunks_json: &str,
) -> Result<String, JsValue> {
    ax_code_diff_core::patch::content(file, original, chunks_json, &|| false)
        .map_err(|error| JsValue::from_str(&error.reason))
}

#[wasm_bindgen]
pub fn apply_hunks(original: &str, hunks_json: &str) -> Result<String, JsValue> {
    ax_code_diff_core::hunks::apply(original, hunks_json, &|| false)
        .map_err(|error| JsValue::from_str(&error.reason))
}
