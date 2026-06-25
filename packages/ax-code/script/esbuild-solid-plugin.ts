// esbuild plugin that applies OpenTUI's Solid JSX transform under Node, so the
// TUI can be bundled without Bun's `@ax-code/opentui-solid/bun-plugin` (which is
// Bun-only). It reuses OpenTUI's own `transformSolidSource` (Babel +
// babel-preset-solid) — the same transform the bun plugin runs — keeping the
// JSX output identical across runtimes. (ADR-036 — TUI on Node.)
import path from "node:path"
import { promises as fs, statSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { Plugin } from "esbuild"

const require = createRequire(import.meta.url)

// solid-transform.js is not exported via a stable subpath; it sits next to the
// (exported) bun-plugin entry.
let cachedTransform: ((code: string, opts: Record<string, unknown>) => Promise<{ code?: string } | string>) | undefined
async function getTransform() {
  if (cachedTransform) return cachedTransform
  const dir = path.dirname(require.resolve("@ax-code/opentui-solid/bun-plugin"))
  // solid-transform.js is ESM, must use dynamic import
  const mod = await import(pathToFileURL(path.join(dir, "solid-transform.js")).href)
  cachedTransform = mod.transformSolidSource
  return cachedTransform!
}

// File cache to avoid re-transforming unchanged files during incremental builds
const fileCache = new Map<string, { mtime: number; contents: string }>()

export function solidEsbuildPlugin(options: { moduleName?: string } = {}): Plugin {
  const moduleName = options.moduleName ?? "@ax-code/opentui-solid"
  return {
    name: "opentui-solid",
    setup(build) {
      // Only .tsx carries JSX; plain .ts is left to esbuild's default loader.
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        if (args.path.includes("node_modules")) return null
        
        // Check file cache (skip if stat fails)
        let stat
        try {
          stat = statSync(args.path)
        } catch {
          // File may have been deleted or is inaccessible - skip caching
          const code = await fs.readFile(args.path, "utf8")
          const transform = await getTransform()
          const result = await transform(code, { moduleName, filename: args.path })
          return { contents: typeof result === "string" ? result : (result.code ?? ""), loader: "js" }
        }
        
        const cached = fileCache.get(args.path)
        if (cached && cached.mtime === stat.mtimeMs) {
          return { contents: cached.contents, loader: "js" }
        }
        
        const code = await fs.readFile(args.path, "utf8")
        const transform = await getTransform()
        const result = await transform(code, { moduleName, filename: args.path })
        const contents = typeof result === "string" ? result : (result.code ?? "")
        
        // Cache the result
        fileCache.set(args.path, { mtime: stat.mtimeMs, contents })
        
        return { contents, loader: "js" }
      })
    },
  }
}
