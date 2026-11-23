import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  createWasmTextWidthKernel,
  loadNativeTextWidthKernel,
  loadTextWidthKernel,
  rustTextWidthArtifacts,
  widthMethods,
  textWidthByteCapacity,
  textWidthItemCapacity,
} from "../../script/text-width-kernel.js"
import { randomWidthTexts, textWidthGolden } from "./text-width.js"

const clusterCases = [
  "👨🏽‍💻",
  "👩‍💻",
  "❤︎❤️",
  "♈♈️",
  "⌚",
  "Ａ\u0301",
  "각",
  "🇺🇸🇺🇸🇺",
  "🇺🇸�🇺🇸",
  "👨‍�‍👩",
  "1\uFE0F\u20E3",
  "🏴\u{E0067}\u{E0062}\u{E007F}",
  "\u0600" + "1",
  "क्" + "क",
  "क्" + "र",
  "क्‍क",
  "\uD800",
  "\r\n",
  "\u0085",
  "\u00AD",
  "x\t中\t",
]

const native = await loadTextWidthKernel("native")
const wasm = await loadTextWidthKernel("wasm")
const kernels = [native, wasm]
const rustDirectory = process.env.AX_CODE_TUI_RUST_WIDTH_DIR
let rustNative: (typeof kernels)[number] | undefined
try {
  if (rustDirectory) {
    const artifacts = rustTextWidthArtifacts(rustDirectory)
    const candidate = await loadNativeTextWidthKernel(artifacts.native, true)
    rustNative = candidate
    kernels.push(candidate)
    const rustWasmBytes = readFileSync(artifacts.wasm)
    const rustWasm = await createWasmTextWidthKernel(rustWasmBytes, true)
    kernels.push(rustWasm)
    candidate.write({ bytes: Uint8Array.of(65), ranges: new Uint32Array([0, 1]) })
    await assert.rejects(loadNativeTextWidthKernel(artifacts.native), /Unsupported text width kernel ABI/)
    await assert.rejects(createWasmTextWidthKernel(rustWasmBytes), /Unsupported text width kernel ABI/)
    await assert.rejects(loadNativeTextWidthKernel(artifacts.native, true), /already leased/)
    candidate.run()
    assert.deepEqual([...candidate.read()], [1])
    const independent = await createWasmTextWidthKernel(rustWasmBytes, true)
    try {
      rustWasm.write({ bytes: Uint8Array.of(65), ranges: new Uint32Array([0, 1]) })
      assert.deepEqual([...independent.measure(["中文"])], [4])
      rustWasm.run()
      assert.deepEqual([...rustWasm.read()], [1])
    } finally {
      independent.close()
    }

    // Measure every Unicode scalar by itself. Cluster and tab behavior are
    // tested separately, since they need multi-scalar input and varied options.
    const compareScalars = (texts: string[]) => {
      const expected = native.measure(texts, "wcwidth")
      assert.deepEqual(candidate.measure(texts, "wcwidth"), expected)
      assert.deepEqual(rustWasm.measure(texts, "wcwidth"), expected)
    }
    let scalars: string[] = []
    for (let codepoint = 0; codepoint <= 0x10ffff; codepoint++) {
      if (codepoint >= 0xd800 && codepoint <= 0xdfff) continue
      scalars.push(String.fromCodePoint(codepoint))
      if (scalars.length === textWidthItemCapacity) {
        compareScalars(scalars)
        scalars = []
      }
    }
    compareScalars(scalars)
  }

  for (const [index, method] of widthMethods.entries()) {
    const texts = textWidthGolden.map((row) => row.text)
    const expected = textWidthGolden.map((row) => row.widths[index])
    for (const kernel of kernels) assert.deepEqual([...kernel.measure(texts, method)], expected)
    const random = [...randomWidthTexts(), ...clusterCases]
    for (const tabWidth of [1, 4, 8, 255]) {
      const expected = native.measure(random, method, tabWidth)
      for (const kernel of kernels.slice(1)) assert.deepEqual(kernel.measure(random, method, tabWidth), expected)
    }
  }
  for (const kernel of kernels) {
    assert.deepEqual([...kernel.measure([])], [])
    assert.equal(kernel.measure(["a".repeat(textWidthByteCapacity)])[0], textWidthByteCapacity)
    const fullInput = new Uint8Array(textWidthByteCapacity).fill(65)
    kernel.write({ bytes: fullInput, ranges: Uint32Array.of(0, fullInput.length, 0, 1) })
    assert.throws(() => kernel.run(), /status 4/)
    assert.throws(() => kernel.read(), /No successful/)
    const repeatedRanges = new Uint32Array(textWidthItemCapacity * 2)
    for (let i = 1; i < repeatedRanges.length; i += 2) repeatedRanges[i] = fullInput.length
    kernel.write({ bytes: fullInput, ranges: repeatedRanges })
    assert.throws(() => kernel.run(), /status 4/)
    kernel.write({ bytes: fullInput, ranges: Uint32Array.of(0, fullInput.length - 1, 0, 1) })
    kernel.run()
    assert.deepEqual([...kernel.read()], [fullInput.length - 1, 1])
    kernel.write({
      bytes: Uint8Array.of(0xff, 65),
      ranges: Uint32Array.of(1, 1, 2, 0),
    })
    kernel.run()
    assert.deepEqual([...kernel.read()], [1, 0])
    assert.equal(kernel.measure(new Array(textWidthItemCapacity).fill("中")).length, textWidthItemCapacity)
    assert.equal(kernel.measure(["\t"], "unicode", 255)[0], 255)
    const saved = kernel.measure(["saved"])
    kernel.measure(["replaced"])
    assert.equal(saved[0], 5, "Result ownership leaked across calls")
    const bytes = new TextEncoder().encode("A👩‍🚀é中")
    for (let split = 0; split <= bytes.length; split++) {
      for (const part of [bytes.slice(0, split), bytes.slice(split)]) {
        let valid = true
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(part)
        } catch {
          valid = false
        }
        kernel.write({ bytes: part, ranges: new Uint32Array([0, part.length]) })
        if (valid) {
          kernel.run()
          assert.equal(kernel.read().length, 1)
        } else {
          assert.throws(() => kernel.run(), /status 3/)
          assert.throws(() => kernel.read(), /No successful/)
        }
      }
    }
    for (const bytes of [
      Uint8Array.of(0xc0, 0xaf),
      Uint8Array.of(0xed, 0xa0, 0x80),
      Uint8Array.of(0xf4, 0x90, 0x80, 0x80),
    ]) {
      kernel.write({ bytes, ranges: new Uint32Array([0, bytes.length]) })
      assert.throws(() => kernel.run(), /status 3/)
    }
    for (const ranges of [
      [0xffffffff, 1],
      [1, 0xffffffff],
      [0, 2],
      [2, 0],
    ]) {
      kernel.write({ bytes: Uint8Array.of(65), ranges: Uint32Array.from(ranges) })
      assert.throws(() => kernel.run(), /status 2/)
      assert.throws(() => kernel.read(), /No successful/)
    }
    assert.throws(() => kernel.write({ bytes: new Uint8Array(0), ranges: new Uint32Array(1) }), /incomplete ranges/)
    assert.throws(() => kernel.run(), /No prepared/)
    kernel.measure(["options"])
    for (const tabWidth of [0, -1, 256, 1.5, NaN]) assert.throws(() => kernel.run("unicode", tabWidth), /Invalid/)
    assert.throws(() => kernel.run("bogus" as "unicode"), /Invalid/)
    assert.equal(kernel.measure(["recovery"])[0], 8)
    assert.throws(() => kernel.measure(["a".repeat(textWidthByteCapacity + 1)]), /byte capacity/)
    assert.throws(() => kernel.read(), /No successful/)
    assert.throws(() => kernel.run(), /No prepared/)
    kernel.close()
    kernel.close()
    assert.equal(saved[0], 5, "Owned results were invalidated by teardown")
    assert.throws(() => kernel.measure(["closed"]), /closed/)
  }
  if (rustDirectory && rustNative) {
    const reopened = await loadNativeTextWidthKernel(rustTextWidthArtifacts(rustDirectory).native, true)
    try {
      // Closing an old handle a second time cannot release the new owner's lease.
      rustNative.close()
      await assert.rejects(
        loadNativeTextWidthKernel(rustTextWidthArtifacts(rustDirectory).native, true),
        /already leased/,
      )
      assert.deepEqual([...reopened.measure(["中文"])], [4])
    } finally {
      reopened.close()
    }
  }
  console.log(JSON.stringify({ status: "AX_TEXT_WIDTH_PARITY_COMPLETE", kernels: kernels.length }))
} finally {
  for (const kernel of kernels) kernel.close()
}
