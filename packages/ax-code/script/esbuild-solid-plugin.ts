// esbuild plugin that applies OpenTUI's Solid JSX transform under Node. It uses
// the vendored package's stable transform export instead of reaching into
// package internals, keeping the Node bundle path aligned with source TUI runs.
import { promises as fs } from "node:fs"
import type { Plugin } from "esbuild"

type TransformSolidSource = (
  code: string,
  opts: { moduleName?: string; filename: string },
) => Promise<string | { code?: string }>

let cachedTransform: TransformSolidSource | undefined
async function getTransform() {
  if (cachedTransform) return cachedTransform
  const mod = await import("@ax-code/opentui-solid/transform")
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

        const handle = await fs.open(args.path, "r")
        try {
          const stat = await handle.stat()
          const cached = fileCache.get(args.path)
          if (cached && cached.mtime === stat.mtimeMs) {
            return { contents: cached.contents, loader: "js" }
          }

          const code = await handle.readFile("utf8")
          const transform = await getTransform()
          const result = await transform(code, { moduleName, filename: args.path })
          const contents = typeof result === "string" ? result : (result.code ?? "")
          fileCache.set(args.path, { mtime: stat.mtimeMs, contents })

          return { contents, loader: "js" }
        } finally {
          await handle.close()
        }
      })
    },
  }
}
