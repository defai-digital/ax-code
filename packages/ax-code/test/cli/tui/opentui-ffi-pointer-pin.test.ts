import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import path from "node:path"

// Regression guard for the TUI SIGSEGV under Node's --experimental-ffi
// (crash signature: EXC_BAD_ACCESS in _platform_memmove ←
// text-buffer.UnifiedTextBuffer.setStyledText ← ffi_call, libopentui.dylib).
//
// V8's precise GC frees an ArrayBuffer as soon as its last JS reference is
// dead — even when its raw address was just taken for a native call that has
// not run yet. Bun's JSC scans the stack conservatively, so OpenTUI's
// `symbols.f(ptr(pack(chunks)))` pattern was safe there, but under node:ffi
// `getRawPointer()` returns a bare BigInt with no liveness tie: the packed
// StyledChunkStruct buffer (and the encoded chunk text it anchors through
// retainPointerTarget's WeakMap) could be collected before the Zig side read
// it, which segfaulted the whole CLI during long streaming sessions.
//
// The fix lives in the vendored @ax-code/opentui-core package: every pointer
// source handed to nodeFfi.getRawPointer() is first pinned in a fixed-size
// strong ring (pinNodePointerSource), keeping it reachable until well after
// the synchronous native call that consumes its address has returned. This
// test loads the *actual shipped* code and verifies both the wiring and the
// ring behavior, so a vendored OpenTUI sync that drops the pin goes red here
// before the crash can ship again.

function ffiSource(): string {
  const entry = fileURLToPath(import.meta.resolve("@ax-code/opentui-core"))
  const dir = path.dirname(entry)
  const file = fs
    .readdirSync(dir)
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => path.join(dir, f))
    .find((f) => fs.readFileSync(f, "utf8").includes("bufferFillRect(buffer, x, y, width, height, color)"))
  if (!file) throw new Error("Could not locate the @ax-code/opentui-core FFI render module")
  return fs.readFileSync(file, "utf8")
}

const SRC = ffiSource()

interface PinApi {
  toNodeSourcePointer: (nodeFfi: { getRawPointer: (buf: ArrayBuffer) => bigint }, value: unknown) => bigint
  pin: (value: unknown) => unknown
  pins: unknown[]
  SLOTS: number
}

// Extract the shipped pin ring plus toNodeSourcePointer and run them as real
// code, isolated per call so each test gets a fresh ring.
function loadPinApi(): PinApi {
  const ring = SRC.match(/var NODE_POINTER_PIN_SLOTS[\s\S]*?function pinNodePointerSource\(value\) \{[\s\S]*?\n\}/)
  if (!ring)
    throw new Error("vendored OpenTUI pin missing: pinNodePointerSource ring not found in @ax-code/opentui-core")
  const source = SRC.match(/function toNodeSourcePointer\(nodeFfi, value\) \{[\s\S]*?\n\}/)
  if (!source)
    throw new Error("vendored OpenTUI pin missing: toNodeSourcePointer not found in @ax-code/opentui-core")
  const body = [
    'const NODE_PTR_VALUE = "node:ffi ptr() only supports ArrayBuffer and ArrayBufferView values."',
    ring[0],
    source[0],
    "return { toNodeSourcePointer, pin: pinNodePointerSource, pins: nodePointerPins, SLOTS: NODE_POINTER_PIN_SLOTS }",
  ].join("\n")
  return new Function(body)() as PinApi
}

describe("OpenTUI FFI pointer pinning (vendored core regression)", () => {
  test("every getRawPointer() call site in the shipped bundle is pinned", () => {
    const rawSites = SRC.match(/nodeFfi\.getRawPointer\(/g) ?? []
    expect(rawSites.length).toBeGreaterThan(0)
    // A pointer source must be pinned in the same branch that takes its raw
    // address, immediately before the address leaves JS-managed liveness.
    const pinnedSites = SRC.match(/pinNodePointerSource\(value\);\s*return nodeFfi\.getRawPointer\(/g) ?? []
    expect(pinnedSites.length, "unpinned nodeFfi.getRawPointer() call site in vendored OpenTUI").toBe(
      rawSites.length,
    )
  })

  test("the ring keeps a pointer source strongly reachable across a native call window", () => {
    const api = loadPinApi()
    expect(Number.isInteger(api.SLOTS)).toBe(true)
    expect(api.SLOTS).toBeGreaterThanOrEqual(256)

    const chunksBuffer = new ArrayBuffer(64)
    api.pin(chunksBuffer)
    expect(api.pins.includes(chunksBuffer)).toBe(true)

    // Stays pinned while later pointer sources arrive (any real call consumes
    // its address long before SLOTS further registrations can happen)...
    for (let i = 0; i < api.SLOTS - 1; i++) api.pin(new Uint8Array(1))
    expect(api.pins.includes(chunksBuffer)).toBe(true)

    // ...and is eventually released again, so the ring cannot leak unboundedly.
    api.pin(new Uint8Array(1))
    expect(api.pins.includes(chunksBuffer)).toBe(false)
  })

  test("toNodeSourcePointer() pins the exact source object whose address it returns", () => {
    const api = loadPinApi()
    const seen: ArrayBuffer[] = []
    const nodeFfi = { getRawPointer: (buf: ArrayBuffer) => (seen.push(buf), 0x1000n) }

    const backing = new ArrayBuffer(32)
    const view = new Uint8Array(backing, 8, 4)
    expect(api.toNodeSourcePointer(nodeFfi, view)).toBe(0x1000n + 8n)
    expect(seen[0]).toBe(backing)
    expect(api.pins.includes(view)).toBe(true)

    const direct = new ArrayBuffer(16)
    expect(api.toNodeSourcePointer(nodeFfi, direct)).toBe(0x1000n)
    expect(api.pins.includes(direct)).toBe(true)

    expect(() => api.toNodeSourcePointer(nodeFfi, 42 as never)).toThrow(TypeError)
  })
})
