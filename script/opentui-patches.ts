#!/usr/bin/env -S npx tsx
/**
 * Idempotent applier / checker for the required AX Code OpenTUI JS patches.
 *
 * Usage:
 *   tsx script/opentui-patches.ts --check
 *   tsx script/opentui-patches.ts --apply
 *
 * After an upstream JS sync, drop the new hashed chunks in place and run
 * --apply. --check is the offline gate that a sync dropped a required fix.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const CORE_DIR = join(ROOT, "packages", "opentui-core")
const SOLID_DIR = join(ROOT, "packages", "opentui-solid")

export type PatchStatus = {
  id: string
  ok: boolean
  detail: string
}

export function findFfiModule(coreDir = CORE_DIR) {
  const files = readdirSync(coreDir)
    .filter((name) => /^index-.*\.js$/.test(name))
    .map((name) => join(coreDir, name))
  const match = files.find((file) => {
    const text = readFileSync(file, "utf8")
    return text.includes("bufferFillRect(buffer, x, y, width, height, color)")
  })
  if (!match) throw new Error("Could not locate the @ax-code/opentui-core FFI render module")
  return match
}

export function findDefaultParserModule(coreDir = CORE_DIR) {
  const files = readdirSync(coreDir)
    .filter((name) => /^index-.*\.js$/.test(name))
    .map((name) => join(coreDir, name))
  const match = files.find((file) => readFileSync(file, "utf8").includes("function loadParsers()"))
  if (!match) throw new Error("Could not locate the OpenTUI default parser module")
  return match
}

const POINTER_PIN_MARKERS = ["function pinNodePointerSource(value)", "var NODE_POINTER_PIN_SLOTS"] as const
const GEOMETRY_MARKERS = [
  "function ffiCellOrigin(x, y)",
  "Sanitize geometry before it crosses the FFI boundary",
] as const
const RESOLVER_MARKERS = ["function resolveVendoredNativeTarget()", "./vendor/"] as const

export function pointerPinApplied(source: string) {
  return POINTER_PIN_MARKERS.every((marker) => source.includes(marker))
}

export function geometryGuardApplied(source: string) {
  if (!GEOMETRY_MARKERS.every((marker) => source.includes(marker))) return false
  for (const method of [
    "bufferDrawText",
    "bufferSetCell",
    "bufferSetCellWithAlphaBlending",
    "bufferDrawChar",
    "bufferDrawSuperSampleBuffer",
  ]) {
    const body = source.slice(source.indexOf(`${method}(buffer`))
    const guard = body.indexOf("ffiCellOrigin")
    const ffi = body.indexOf(`this.opentui.symbols.${method}(`)
    if (guard < 0 || ffi < 0 || guard > ffi) return false
  }
  return true
}

export function nativeResolverApplied(source: string) {
  return RESOLVER_MARKERS.every((marker) => source.includes(marker)) && !source.includes('import("@opentui/core-')
}

export function zigParserDropped(source: string) {
  return !source.includes("./assets/zig/") && !source.includes('filetype: "zig"')
}

export function slimCatalogueApplied(source: string) {
  return (
    !source.includes("ascii_font:") && !source.includes("tab_select:") && !/\bselect:\s*SelectRenderable/.test(source)
  )
}

export function zigAssetsAbsent(coreDir = CORE_DIR) {
  return !existsSync(join(coreDir, "assets", "zig"))
}

export function testRemnantsAbsent(coreDir = CORE_DIR) {
  return !existsSync(join(coreDir, "tests")) && !existsSync(join(coreDir, "native-event-worker-repro.worker.d.ts"))
}

const POINTER_PIN_BLOCK = `// V8's precise GC frees an ArrayBuffer as soon as its last JS reference is
// dead — even when its raw address was just taken for a native call that has
// not run yet. Bun's JSC scans the stack conservatively, so patterns like
// \`symbols.f(ptr(pack(chunks)))\` were safe there, but under node:ffi the packed
// struct buffer (and everything it anchors through retainPointerTarget, such as
// the encoded chunk text a StyledChunkStruct points at) could be collected
// between getRawPointer() and the native call dereferencing the address. The
// Zig side then reads freed memory — observed as a SIGSEGV in
// text-buffer.UnifiedTextBuffer.setStyledText during long streaming sessions.
// Pin every pointer source in a fixed-size ring so it stays strongly reachable
// until well after the synchronous native call consuming its address returned.
var NODE_POINTER_PIN_SLOTS = 1024;
var nodePointerPins = new Array(NODE_POINTER_PIN_SLOTS);
var nodePointerPinIndex = 0;
function pinNodePointerSource(value) {
  nodePointerPins[nodePointerPinIndex] = value;
  nodePointerPinIndex = (nodePointerPinIndex + 1) % NODE_POINTER_PIN_SLOTS;
  return value;
}
`

function applyPointerPin(source: string) {
  if (pointerPinApplied(source)) return source
  if (!source.includes("function toNodeSourcePointer(nodeFfi, value)")) {
    throw new Error("ffi-pointer-pin: missing toNodeSourcePointer() anchor")
  }
  let next = source
  if (!next.includes("function pinNodePointerSource(value)")) {
    next = next.replace(
      "function toNodeSourcePointer(nodeFfi, value)",
      `${POINTER_PIN_BLOCK}function toNodeSourcePointer(nodeFfi, value)`,
    )
  }
  next = next.replaceAll(
    /return nodeFfi\.getRawPointer\((value(?:\.buffer)?)\)/g,
    "pinNodePointerSource(value);\n    return nodeFfi.getRawPointer($1)",
  )
  if (!pointerPinApplied(next)) throw new Error("ffi-pointer-pin: apply did not satisfy the contract")
  return next
}

const CELL_ORIGIN_BLOCK = `// Floor a cell origin and reject anything a u32 FFI argument cannot represent.
// The native draw symbols declare x/y as u32, so a negative coordinate (a cell
// scrolled above/left of the viewport) or a fractional one throws under Node's
// strict FFI marshalling and -- because draws run every frame -- spams an
// unstoppable crash. Returns null when the origin is off-screen, which matches
// the native renderer dropping the draw (Bun's FFI silently coerced these, so
// this only regressed after the Node migration).
function ffiCellOrigin(x, y) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  return { x, y };
}
`

function applyGeometryGuard(source: string) {
  if (geometryGuardApplied(source)) return source
  let next = source
  if (!next.includes("function ffiCellOrigin(x, y)")) {
    if (!next.includes("function getOpenTUILib(libPath)")) {
      throw new Error("ffi-geometry-guard: missing getOpenTUILib() anchor")
    }
    next = next.replace("function getOpenTUILib(libPath)", `${CELL_ORIGIN_BLOCK}function getOpenTUILib(libPath)`)
  }
  const fill =
    /bufferFillRect\(buffer, x, y, width, height, color\) \{\n(?:    const bg2 = rgbaPtr\(color\);\n    this\.opentui\.symbols\.bufferFillRect\(buffer, x, y, width, height, bg2\);\n  \})/
  if (fill.test(next)) {
    next = next.replace(
      fill,
      `bufferFillRect(buffer, x, y, width, height, color) {
    // Sanitize geometry before it crosses the FFI boundary. The native
    // bufferFillRect args are declared u32, and Node's strict FFI marshalling
    // throws "Argument N must be a uint32" on any negative or non-integer
    // value (Bun silently coerced them, so this only regressed after the Node
    // migration). fillRect runs every render frame, so one bad coordinate --
    // a row scrolled just above the viewport (y < 0), or a gutter wider than
    // its container (width < 0) -- otherwise throws on every frame and spams an
    // unstoppable crash. Floor fractional layout values, drop non-finite ones,
    // and clip a negative origin the way the native renderer would.
    x = Math.floor(x);
    y = Math.floor(y);
    width = Math.floor(width);
    height = Math.floor(height);
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height))) return;
    if (x < 0) { width += x; x = 0; }
    if (y < 0) { height += y; y = 0; }
    if (width <= 0 || height <= 0) return;
    const bg2 = rgbaPtr(color);
    this.opentui.symbols.bufferFillRect(buffer, x, y, width, height, bg2);
  }`,
    )
  }
  if (!geometryGuardApplied(next)) {
    throw new Error(
      "ffi-geometry-guard: apply did not satisfy the contract (point-draw wrappers still need a manual sync)",
    )
  }
  return next
}

const RESOLVER_BLOCK = `// AX Code vendored native resolver (required local fix — see MAINTENANCE.md).
// The Zig shared libraries are vendored in-repo under vendor/<target>/
// (vendor/manifest.json records provenance and hashes) instead of resolving
// the upstream @opentui/core-<platform> npm packages through node_modules.
// Paths resolve relative to this file, so the lookup is independent of the
// package-manager store layout (pnpm .pnpm store, copied dist, libexec).
const VENDORED_NATIVE_LIB_FILE = { darwin: "libopentui.dylib", linux: "libopentui.so", win32: "opentui.dll" };
function resolveVendoredNativeTarget() {
  if (process.platform === "darwin" || process.platform === "win32") {
    if (process.arch === "x64" || process.arch === "arm64")
      return \`\${process.platform}-\${process.arch}\`;
  }
  if (process.platform === "linux") {
    validateLinuxLibcOverride();
    if (process.arch === "x64" || process.arch === "arm64") {
      return process.env.OPENTUI_LIBC === "musl" ? \`linux-\${process.arch}-musl\` : \`linux-\${process.arch}\`;
    }
  }
  throw new Error(\`opentui is not supported on the current platform: \${process.platform}-\${process.arch}\`);
}
var vendoredNativeTarget = resolveVendoredNativeTarget();
var targetLibPath = fileURLToPath(
  new URL(\`./vendor/\${vendoredNativeTarget}/\${VENDORED_NATIVE_LIB_FILE[process.platform]}\`, import.meta.url)
);
`

function applyNativeResolver(source: string) {
  if (nativeResolverApplied(source)) return source
  if (source.includes('import("@opentui/core-')) {
    throw new Error(
      "vendored-native-resolver: upstream npm resolver is present; replace it with resolveVendoredNativeTarget() before --check can pass",
    )
  }
  if (!source.includes("function validateLinuxLibcOverride()")) {
    throw new Error("vendored-native-resolver: missing validateLinuxLibcOverride() anchor")
  }
  if (!source.includes("function resolveVendoredNativeTarget()")) {
    const inserted = source.replace(
      /function validateLinuxLibcOverride\(\) \{[\s\S]*?\n\}\n/,
      (match) => `${match}${RESOLVER_BLOCK}`,
    )
    if (nativeResolverApplied(inserted)) return inserted
  }
  throw new Error("vendored-native-resolver: apply did not satisfy the contract")
}

function applyZigParserDrop(source: string) {
  if (zigParserDropped(source)) return source
  let next = source.replace(
    /\n  const zig_highlights = await resolveBundledFilePath\([^;]+;\n  const zig_language = await resolveBundledFilePath\([^;]+;\n/,
    "\n",
  )
  next = next.replace(
    /,\n    \{\n      filetype: "zig",\n      queries: \{\n        highlights: \[zig_highlights\]\n      \},\n      wasm: zig_language\n    \}/,
    "",
  )
  if (!zigParserDropped(next)) throw new Error("drop-zig-parser: apply did not satisfy the contract")
  return next
}

const UNUSED_CATALOGUE_EXPORTS = ["ASCIIFontRenderable", "SelectRenderable", "TabSelectRenderable"] as const

function stripUnusedCatalogueImports(source: string) {
  return source.replace(/import\s*\{([^}]+)\}\s*from\s*["']@ax-code\/opentui-core["']/g, (full, inner: string) => {
    // Only rewrite the catalogue import. The reconciler later aliases
    // SelectRenderable as SelectRenderable2 and must keep those bindings.
    if (!inner.includes("ASCIIFontRenderable")) return full
    const names = inner
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => {
        const ident = part.split(/\s+as\s+/)[0]?.trim()
        return !UNUSED_CATALOGUE_EXPORTS.includes(ident as (typeof UNUSED_CATALOGUE_EXPORTS)[number])
      })
    if (names.length === 0) return full
    const multiline = inner.includes("\n")
    if (!multiline) return `import { ${names.join(", ")} } from "@ax-code/opentui-core"`
    return `import {\n  ${names.join(",\n  ")}\n} from "@ax-code/opentui-core"`
  })
}

export function applySlimCatalogue(source: string) {
  if (slimCatalogueApplied(source)) return source
  const next = stripUnusedCatalogueImports(
    source
      .replace(/\n  select: SelectRenderable,/, "")
      .replace(/\n  ascii_font: ASCIIFontRenderable,/, "")
      .replace(/\n  tab_select: TabSelectRenderable,/, ""),
  )
  if (!slimCatalogueApplied(next)) throw new Error("slim-catalogue: apply did not satisfy the contract")
  return next
}

export function checkOpentuiPatches(): PatchStatus[] {
  const ffi = readFileSync(findFfiModule(), "utf8")
  const parsers = readFileSync(findDefaultParserModule(), "utf8")
  const solidFiles = ["index.js", "index.bun.js", "components.js"].map((name) => join(SOLID_DIR, name))
  return [
    { id: "ffi-pointer-pin", ok: pointerPinApplied(ffi), detail: findFfiModule() },
    { id: "ffi-geometry-guard", ok: geometryGuardApplied(ffi), detail: findFfiModule() },
    { id: "vendored-native-resolver", ok: nativeResolverApplied(ffi), detail: findFfiModule() },
    { id: "drop-zig-parser", ok: zigParserDropped(parsers) && zigAssetsAbsent(), detail: findDefaultParserModule() },
    {
      id: "slim-catalogue",
      ok: solidFiles.every((file) => slimCatalogueApplied(readFileSync(file, "utf8"))),
      detail: solidFiles.join(", "),
    },
    { id: "drop-test-remnants", ok: testRemnantsAbsent(), detail: join(CORE_DIR, "tests") },
  ]
}

export function applyOpentuiPatches() {
  const ffiPath = findFfiModule()
  let ffi = readFileSync(ffiPath, "utf8")
  ffi = applyPointerPin(ffi)
  ffi = applyGeometryGuard(ffi)
  ffi = applyNativeResolver(ffi)
  writeFileSync(ffiPath, ffi)

  const parserPath = findDefaultParserModule()
  writeFileSync(parserPath, applyZigParserDrop(readFileSync(parserPath, "utf8")))

  for (const name of ["index.js", "index.bun.js", "components.js"]) {
    const file = join(SOLID_DIR, name)
    writeFileSync(file, applySlimCatalogue(readFileSync(file, "utf8")))
  }
}

function fail(message: string): never {
  console.error(`opentui-patches: ${message}`)
  process.exit(1)
}

function main() {
  const check = process.argv.includes("--check")
  const apply = process.argv.includes("--apply")
  if (apply) applyOpentuiPatches()
  const results = checkOpentuiPatches()
  const failed = results.filter((item) => !item.ok)
  for (const item of results) {
    console.log(`${item.ok ? "✓" : "✗"} ${item.id}`)
  }
  if (failed.length > 0)
    fail(`${failed.length} required OpenTUI patch(es) missing: ${failed.map((item) => item.id).join(", ")}`)
  if (check || apply) console.log("✓ OpenTUI required patches present")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
