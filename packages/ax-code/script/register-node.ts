// Side-effect module: prepares the Node-from-source environment for scripts
// that import src/. Import this FIRST (static import), then load src modules via
// dynamic import() so both the Bun→Node global shim and the resolve hook are in
// place before any src module evaluates.
//
// The resolve hook mirrors the alias set in vitest.config.ts and the esbuild
// build overrides so the Bun-only module ids resolve to their Node equivalents
// — otherwise importing src (e.g. config → #db → db.bun.ts) pulls in
// `bun:sqlite` and crashes with ERR_UNSUPPORTED_ESM_URL_SCHEME.
import * as nodeModule from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { installNodeBunCompat } from "../src/bun/node-compat"

installNodeBunCompat()

// Under the real Bun runtime #db resolves natively and registerHooks may be
// absent — the source resolve hook is a Node-only concern. (installNodeBunCompat
// sets globalThis.Bun even on Node, so detect the runtime via process.versions.bun.)
if (!process.versions.bun && typeof nodeModule.registerHooks === "function") {
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

  const exact = new Map<string, string>([
    ["#db", pathToFileURL(path.join(pkgRoot, "src/storage/db.node.ts")).href],
  ])
  // Remap to another bare specifier (let the rest of the chain resolve it).
  const rebind = new Map<string, string>([["drizzle-orm/bun-sqlite", "drizzle-orm/node-sqlite"]])

  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const aliased = exact.get(specifier)
      if (aliased) return { url: aliased, shortCircuit: true }
      const rebound = rebind.get(specifier)
      if (rebound) return nextResolve(rebound, context)
      return nextResolve(specifier, context)
    },
  })
}
