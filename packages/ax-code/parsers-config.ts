export default {
  // Keep extra Tree-sitter parsers disabled until their WASM and query
  // assets are either vendored or loaded through an upstream API that
  // verifies integrity metadata. OpenTUI already ships built-in parsers
  // for markdown, JavaScript, TypeScript, and Zig; registering remote
  // URLs here would make the TUI download and cache unauthenticated
  // third-party parser assets at runtime.
  parsers: [],
}
