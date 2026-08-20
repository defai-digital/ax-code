// `core` subpath entry — the pure, filesystem-free compiler + neutral contracts.
//
// Everything exported here is deterministic and imports no `node:fs`,
// `node:child_process`, `node:net`, or AX Code runtime. The import-boundary test
// (`test/boundary.test.ts`) enforces this. Node fs/git effects live in `./node.js`.

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
