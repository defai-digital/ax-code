// `node` subpath entry — Node filesystem/git wiring over the pure `core`.
//
// Re-exports the pure core plus the modules that perform real filesystem/git
// effects (discovery, safety checks, the on-disk build, artifacts, agents pointer
// files, and the session protocol). External consumers who want a fully injected,
// fs-free build should import `./core` and `./testing` instead.

export * from "./core.js"
export * from "./discovery.js"
export * from "./safety.js"
export * from "./build.js"
export * from "./lock.js"
export * from "./artifacts.js"
export * from "./agents.js"
export * from "./protocol.js"
