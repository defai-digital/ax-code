// Side-effect module: prepares the Node-from-source environment for scripts
// that import src/. Import this FIRST (static import), then load src modules via
// dynamic import() so both the Bun→Node global shim and the resolve/load hooks
// are in place before any src module evaluates.
//
// The resolve hook mirrors the alias set in vitest.config.ts and the esbuild
// build overrides so Node-only module ids resolve correctly — in particular #db
// must resolve to db.node.ts (not the default export-conditions lookup). The
// load hook serves `.txt` files as raw-text ES modules, matching Bun, the build's
// text loader, and the `txtAsText` plugin in vitest.config.ts.
import { readFileSync } from "node:fs"
import * as nodeModule from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { installNodeBunCompat } from "../src/bun/node-compat"

installNodeBunCompat()

// Under the real Bun runtime #db resolves natively and registerHooks may be
// absent — the source resolve hook is a Node-only concern. (installNodeBunCompat
// sets globalThis.Bun even on Node, so detect the runtime via process.versions.bun.)
// `Module.registerHooks` is newer than the pinned @types/node; type it locally.
type ResolveContext = { conditions?: string[]; importAttributes?: Record<string, string>; parentURL?: string }
type ResolveResult = { url: string; shortCircuit?: boolean; format?: string | null }
type LoadContext = { format?: string | null; conditions?: string[] }
type LoadResult = {
  format?: string | null
  shortCircuit?: boolean
  source?: string | ArrayBuffer | ArrayBufferView | null
}
const registerHooks = (
  nodeModule as typeof nodeModule & {
    registerHooks?: (hooks: {
      resolve?: (
        specifier: string,
        context: ResolveContext,
        nextResolve: (specifier: string, context?: ResolveContext) => ResolveResult,
      ) => ResolveResult
      load?: (
        url: string,
        context: LoadContext,
        nextLoad: (url: string, context?: LoadContext) => LoadResult,
      ) => LoadResult
    }) => void
  }
).registerHooks

if (!process.versions.bun && typeof registerHooks === "function") {
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

  const exact = new Map<string, string>([["#db", pathToFileURL(path.join(pkgRoot, "src/storage/db.node.ts")).href]])

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const aliased = exact.get(specifier)
      if (aliased) return { url: aliased, shortCircuit: true }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      // Tools import descriptions as `import D from "./x.txt"`. Bun returns the
      // file contents; serve them as an ES module whose default is the raw text
      // (matches the build's text loader and the vitest `txtAsText` plugin).
      // Strip any ?query/#hash before the extension check and the read.
      const file = url.split("?")[0].split("#")[0]
      if (url.startsWith("file:") && file.endsWith(".txt")) {
        const source = `export default ${JSON.stringify(readFileSync(fileURLToPath(file), "utf8"))}`
        return { format: "module", shortCircuit: true, source }
      }
      return nextLoad(url, context)
    },
  })
}
