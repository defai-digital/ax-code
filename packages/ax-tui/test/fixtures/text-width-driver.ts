import assert from "node:assert/strict"
import {
  loadTextWidthKernel,
  widthMethods,
  textWidthByteCapacity,
  textWidthItemCapacity,
} from "../../script/text-width-kernel.js"
import { randomWidthTexts, textWidthGolden } from "./text-width.js"

const native = await loadTextWidthKernel("native")
const wasm = await loadTextWidthKernel("wasm")
try {
  for (const [index, method] of widthMethods.entries()) {
    const texts = textWidthGolden.map((row) => row.text)
    const expected = textWidthGolden.map((row) => row.widths[index])
    assert.deepEqual([...native.measure(texts, method)], expected)
    assert.deepEqual([...wasm.measure(texts, method)], expected)
    const random = randomWidthTexts()
    for (const tabWidth of [1, 4, 8, 255]) {
      assert.deepEqual(wasm.measure(random, method, tabWidth), native.measure(random, method, tabWidth))
    }
  }
  for (const kernel of [native, wasm]) {
    assert.deepEqual([...kernel.measure([])], [])
    assert.equal(kernel.measure(["a".repeat(textWidthByteCapacity)])[0], textWidthByteCapacity)
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
  console.log(JSON.stringify({ status: "AX_TEXT_WIDTH_PARITY_COMPLETE", randomTexts: 1000, methods: 3, tabWidths: 4 }))
} finally {
  native.close()
  wasm.close()
}
