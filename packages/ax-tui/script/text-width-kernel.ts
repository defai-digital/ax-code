import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Pointer } from "../src/platform/ffi.js"
import { defaultExperimentDirectory, tuiRoot } from "./build-text-width-experiment.js"
import { nativeSourceDigest } from "./native-source.js"

export const textWidthByteCapacity = 1024 * 1024
export const textWidthItemCapacity = 4096
export const widthMethods = ["unicode", "wcwidth", "no_zwj"] as const
export type WidthMethod = (typeof widthMethods)[number]
export interface TextWidthBatch {
  bytes: Uint8Array
  ranges: Uint32Array
}

export function encodeTextWidthBatch(texts: readonly string[]): TextWidthBatch {
  assert.ok(texts.length <= textWidthItemCapacity, "Text batch exceeds item capacity")
  const encoder = new TextEncoder()
  const ranges = new Uint32Array(texts.length * 2)
  const parts: Uint8Array[] = []
  let size = 0
  for (const [index, text] of texts.entries()) {
    assert.equal(typeof text, "string", "Text batch must contain strings")
    assert.ok(text.length <= textWidthByteCapacity - size, "Text batch exceeds byte capacity")
    const bytes = encoder.encode(text)
    assert.ok(bytes.length <= textWidthByteCapacity - size, "Text batch exceeds byte capacity")
    ranges[index * 2] = size
    ranges[index * 2 + 1] = bytes.length
    parts.push(bytes)
    size += bytes.length
  }
  const bytes = new Uint8Array(size)
  for (let index = 0; index < parts.length; index++) bytes.set(parts[index], ranges[index * 2])
  return { bytes, ranges }
}

interface KernelExports {
  kernelAbiVersion(): number
  kernelByteCapacity(): number
  kernelItemCapacity(): number
  kernelInput(): number | Pointer
  kernelRanges(): number | Pointer
  kernelWidths(): number | Pointer
  kernelMeasure(count: number, byteLength: number, tabWidth: number, method: number): number
}

export interface TextWidthKernel {
  backend: "native" | "wasm"
  memoryBytes?: number
  write(batch: TextWidthBatch): void
  run(method?: WidthMethod, tabWidth?: number): void
  read(): Uint32Array
  measure(texts: readonly string[], method?: WidthMethod, tabWidth?: number): Uint32Array
  close(): void
}

function bindKernel(
  backend: TextWidthKernel["backend"],
  exports: KernelExports,
  view: (pointer: number | Pointer, length: number) => Uint8Array,
  close: () => void,
  memoryBytes?: number,
): TextWidthKernel {
  assert.equal(exports.kernelAbiVersion(), 1, "Unsupported text width kernel ABI")
  assert.equal(exports.kernelByteCapacity(), textWidthByteCapacity)
  assert.equal(exports.kernelItemCapacity(), textWidthItemCapacity)
  let closed = false
  let count = 0
  let byteLength = 0
  let ready = false
  let hasBatch = false
  const guard = () => assert.ok(!closed, "Text width kernel is closed")
  const kernel: TextWidthKernel = {
    backend,
    memoryBytes,
    write(batch) {
      guard()
      ready = false
      hasBatch = false
      assert.ok(batch.bytes instanceof Uint8Array && batch.ranges instanceof Uint32Array, "Invalid batch buffers")
      assert.ok(batch.bytes.length <= textWidthByteCapacity, "Text batch exceeds byte capacity")
      assert.ok(
        batch.ranges.length % 2 === 0 && batch.ranges.length <= textWidthItemCapacity * 2,
        "Text batch exceeds item capacity or has incomplete ranges",
      )
      view(exports.kernelInput(), batch.bytes.length).set(batch.bytes)
      view(exports.kernelRanges(), batch.ranges.byteLength).set(
        new Uint8Array(batch.ranges.buffer, batch.ranges.byteOffset, batch.ranges.byteLength),
      )
      count = batch.ranges.length / 2
      byteLength = batch.bytes.length
      hasBatch = true
    },
    run(method = "unicode", tabWidth = 4) {
      guard()
      ready = false
      assert.ok(hasBatch, "No prepared text width batch")
      const methodIndex = widthMethods.indexOf(method)
      assert.ok(
        methodIndex >= 0 && Number.isInteger(tabWidth) && tabWidth >= 1 && tabWidth <= 255,
        "Invalid width method or tab width",
      )
      const status = exports.kernelMeasure(count, byteLength, tabWidth, methodIndex)
      assert.equal(status, 0, `Text width kernel rejected batch (status ${status})`)
      ready = true
    },
    read() {
      guard()
      assert.ok(ready, "No successful text width result")
      // Always return owned results, never a view into a later batch or closed library.
      const bytes = view(exports.kernelWidths(), count * 4).slice()
      return new Uint32Array(bytes.buffer)
    },
    measure(texts, method, tabWidth) {
      guard()
      ready = false
      hasBatch = false
      kernel.write(encodeTextWidthBatch(texts))
      kernel.run(method, tabWidth)
      return kernel.read()
    },
    close() {
      if (closed) return
      closed = true
      close()
    },
  }
  return kernel
}

export async function createWasmTextWidthKernel(bytes: Uint8Array<ArrayBuffer>): Promise<TextWidthKernel> {
  const module = await WebAssembly.compile(bytes)
  assert.deepEqual(WebAssembly.Module.imports(module), [], "Text width kernel must be freestanding")
  const instance = await WebAssembly.instantiate(module)
  const memory = instance.exports.memory as WebAssembly.Memory
  assert.ok(memory instanceof WebAssembly.Memory)
  return bindKernel(
    "wasm",
    instance.exports as unknown as KernelExports,
    (pointer, length) => new Uint8Array(memory.buffer, Number(pointer), length),
    () => {},
    memory.buffer.byteLength,
  )
}

export function verifyTextWidthExperiment(directory = defaultExperimentDirectory) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"))
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.nativeSourceSha256, nativeSourceDigest(), "Rebuild stale text width experiment")
  assert.equal(manifest.kernelSha256, hash(join(tuiRoot, "experiments/text-width/kernel.zig")))
  assert.equal(manifest.buildSha256, hash(join(tuiRoot, "experiments/text-width/build.zig")))
  const nativeFile =
    process.platform === "win32"
      ? "bin/ax-tui-text-width.dll"
      : `lib/libax-tui-text-width.${process.platform === "darwin" ? "dylib" : "so"}`
  assert.equal(manifest.nativeTarget, `${process.platform}-${process.arch}`, "Rebuild experiment on this host")
  for (const file of [nativeFile, "bin/ax-tui-text-width.wasm"]) {
    assert.equal(hash(join(directory, file)), manifest.artifacts[file]?.sha256, `Artifact hash mismatch: ${file}`)
  }
  return { manifest, nativeFile }
}

export async function loadTextWidthKernel(backend: TextWidthKernel["backend"], directory = defaultExperimentDirectory) {
  const { nativeFile } = verifyTextWidthExperiment(directory)
  if (backend === "wasm") return createWasmTextWidthKernel(readFileSync(join(directory, "bin/ax-tui-text-width.wasm")))
  assert.equal(backend, "native")
  // Only the native arm loads FFI. The WASM arm runs without --experimental-ffi.
  const { dlopen, toArrayBuffer } = await import("../src/platform/ffi.js")
  const library = dlopen(join(directory, nativeFile), {
    kernelAbiVersion: { args: [], returns: "u32" },
    kernelByteCapacity: { args: [], returns: "u32" },
    kernelItemCapacity: { args: [], returns: "u32" },
    kernelInput: { args: [], returns: "ptr" },
    kernelRanges: { args: [], returns: "ptr" },
    kernelWidths: { args: [], returns: "ptr" },
    kernelMeasure: { args: ["u32", "u32", "u32", "u32"], returns: "u32" },
  })
  try {
    return bindKernel(
      "native",
      library.symbols as KernelExports,
      (pointer, length) =>
        length === 0 ? new Uint8Array(0) : new Uint8Array(toArrayBuffer(pointer as Pointer, 0, length)),
      () => library.close(),
    )
  } catch (error) {
    library.close()
    throw error
  }
}
