// Root entry — the pure, filesystem-free compiler + neutral contracts.
//
// Everything exported here is deterministic and imports no `node:fs`,
// `node:child_process`, `node:net`, or AX Code runtime, so browser bundlers can
// import the root without pulling in Node-only modules. Node fs/git effects
// (discovery, the on-disk build, the build lock, artifacts, agents pointer
// files, the session protocol) live in the `./node` subpath; `./graph` stays
// the browser-safe graph projection.

export * from "./types.js"
export * from "./contracts.js"
export * from "./ports.js"
export * from "./paths.js"
export * from "./hash.js"
export * from "./glob.js"
export * from "./plan.js"
export * from "./protected.js"
export * from "./frontmatter.js"
export * from "./validate.js"
export * from "./build-pure.js"
