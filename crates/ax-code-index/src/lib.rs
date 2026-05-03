#[macro_use]
extern crate napi_derive;

mod cursor;
mod edge;
mod file;
mod hasher;
mod id;
mod interval_tree;
mod lock;
mod node;
mod schema;
mod store;

pub use interval_tree::IntervalTree;
pub use lock::AdvisoryLock;
pub use store::IndexStore;

#[napi]
pub fn hash_sha256(data: napi::bindgen_prelude::Buffer) -> String {
    hasher::sha256_bytes(&data)
}

#[napi]
pub fn hash_file_sha256(path: String) -> napi::Result<String> {
    hasher::sha256_file(&path).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn generate_id(prefix: String) -> napi::Result<String> {
    id::ascending(&prefix).map_err(|e| napi::Error::from_reason(e.to_string()))
}
