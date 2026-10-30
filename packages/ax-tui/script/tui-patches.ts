/**
 * Verify the AX behavior contracts now maintained in owned TypeScript source.
 * The historical command name is retained for downstream maintenance scripts.
 * Generated bundles are rebuilt with build:renderer; no bundle is patched.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
export type PatchStatus = { id: string; ok: boolean; detail: string }

export function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.tsx?$/.test(entry.name) ? [file] : []
  })
}

export function axRuntimeIdentityApplied(source: string): boolean {
  return !/\bOTUI_|opentui:runtime-module:|bun-plugin-opentui-runtime-modules|__opentui(?:CoreRuntimePluginSupportInstalled__|WorkerMessageBridge)|opentui\.solid\.(?:transform|runtime-plugin-support)/.test(
    source,
  )
}

export function checkTuiPatches(root = ROOT): PatchStatus[] {
  const read = (name: string) => readFileSync(join(root, name), "utf8")
  const ffi = read("src/platform/ffi.ts")
  const native = read("src/core/zig.ts")
  const renderer = read("src/core/renderer.ts")
  const parsers = read("src/lib/tree-sitter/default-parsers.ts")
  const catalogue = read("solid/source/src/elements/catalogue.ts")
  const sources = ["src", "solid/source", "native/source"].flatMap((directory) => sourceFiles(join(root, directory)))
  const geometry = [
    "bufferDrawText",
    "bufferSetCell",
    "bufferSetCellWithAlphaBlending",
    "bufferDrawChar",
    "bufferDrawSuperSampleBuffer",
  ].every((method) => {
    const start = native.indexOf(`public ${method}(`)
    const call = native.indexOf(`this.native.symbols.${method}(`, start)
    const guard = native.indexOf("ffiCellOrigin(x, y)", start)
    return start >= 0 && guard > start && call > guard
  })
  return [
    {
      id: "ffi-pointer-pin",
      ok:
        ffi.includes("const NODE_POINTER_PIN_SLOTS = 1024") &&
        ffi.includes("pinNodePointerSource(value)\n    return nodeFfi.getRawPointer(value.buffer)"),
      detail: "src/platform/ffi.ts",
    },
    {
      id: "ffi-geometry-guard",
      ok: geometry && native.includes("if (width <= 0 || height <= 0) return"),
      detail: "src/core/zig.ts",
    },
    {
      id: "vendored-native-resolver",
      ok: native.includes("resolveVendoredNativeTarget()") && native.includes("AX_CODE_TUI_LIBC"),
      detail: "src/core/zig.ts",
    },
    {
      id: "native-asset-delivery",
      ok: native.includes("await prepareNativeLibrary(vendoredNativeTarget)"),
      detail: "src/core/zig.ts",
    },
    {
      id: "kitty-keyboard-opt-out",
      ok: renderer.includes("config.useKittyKeyboard === undefined ? {} : config.useKittyKeyboard"),
      detail: "src/core/renderer.ts",
    },
    {
      id: "stdin-parser-timeout",
      ok: renderer.includes("timeoutMs: config.stdinParserTimeoutMs ?? 100"),
      detail: "src/core/renderer.ts",
    },
    {
      id: "drop-zig-parser",
      ok: !parsers.includes('filetype: "zig"') && !existsSync(join(root, "assets/zig")),
      detail: "src/lib/tree-sitter/default-parsers.ts",
    },
    {
      id: "slim-catalogue",
      ok: !/\b(?:select|ascii_font|tab_select):/.test(catalogue),
      detail: "solid/source/src/elements/catalogue.ts",
    },
    {
      id: "ax-runtime-identity",
      ok: sources.every((file) => axRuntimeIdentityApplied(readFileSync(file, "utf8"))),
      detail: "TypeScript sources",
    },
    {
      id: "no-upstream-runtime-dependency",
      ok: sources.every((file) => !/(?:from\s*|import\s*\(\s*)["']@opentui\//.test(readFileSync(file, "utf8"))),
      detail: "TypeScript sources",
    },
  ]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--apply")) throw new Error("Edit the TypeScript source and run pnpm run build:renderer")
  const results = checkTuiPatches()
  for (const item of results) console.log(`${item.ok ? "✓" : "✗"} ${item.id}: ${item.detail}`)
  if (results.some((item) => !item.ok)) process.exitCode = 1
}
