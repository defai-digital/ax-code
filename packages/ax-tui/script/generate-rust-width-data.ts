import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { defaultExperimentDirectory, tuiRoot } from "./build-text-width-experiment.js"
import { verifyTextWidthExperiment } from "./text-width-kernel.js"

const scalarCount = 0x110000
const transitionBreakFlag = 0x80
const pageSize = 256
const output = join(tuiRoot, "experiments/text-width/rust/src/unicode-width.bin")
const args = process.argv.slice(2)
assert.ok(
  args.length === 0 || (args.length === 1 && args[0] === "--check"),
  "Usage: generate-rust-width-data.ts [--check]",
)

verifyTextWidthExperiment()
const binary = readFileSync(join(defaultExperimentDirectory, "bin/ax-tui-text-width.wasm"))
const { instance } = await WebAssembly.instantiate(binary)
const { kernelGraphemeClassCount, kernelGraphemeStateCount, kernelGraphemeTransition, kernelScalarProperties } =
  instance.exports as {
    kernelGraphemeClassCount(): number
    kernelGraphemeStateCount(): number
    kernelGraphemeTransition(previous: number, current: number, state: number): number
    kernelScalarProperties(codepoint: number): number
  }
const classes = kernelGraphemeClassCount()
const states = kernelGraphemeStateCount()
assert.ok(classes > 0 && classes <= 32 && states > 0 && states <= transitionBreakFlag)
const transitions = Buffer.alloc(classes * classes * states)
for (let previous = 0; previous < classes; previous++) {
  for (let current = 0; current < classes; current++) {
    for (let state = 0; state < states; state++) {
      const transition = kernelGraphemeTransition(previous, current, state)
      assert.ok(transition >= 0 && transition <= 255 && (transition & ~transitionBreakFlag) < states)
      transitions[(previous * classes + current) * states + state] = transition
    }
  }
}

// The page index maps every 256-scalar block to a deduplicated page. Lookup
// needs two byte loads even for blocks whose widths vary at every scalar.
const index = Buffer.alloc(scalarCount / pageSize)
const pages: Buffer[] = []
const pageIds = new Map<string, number>()
for (let block = 0; block < index.length; block++) {
  const page = Buffer.alloc(pageSize)
  for (let offset = 0; offset < pageSize; offset++) {
    const properties = kernelScalarProperties(block * pageSize + offset)
    assert.ok(properties >= 0 && properties <= 255 && (properties & 31) < classes && ((properties >> 5) & 3) <= 2)
    page[offset] = properties
  }
  const key = page.toString("base64")
  let id = pageIds.get(key)
  if (id === undefined) {
    id = pages.length
    assert.ok(id < pageSize, "Unicode width page IDs no longer fit in a byte")
    pageIds.set(key, id)
    pages.push(page)
  }
  index[block] = id
}
const generated = Buffer.concat([Buffer.from([classes, states]), transitions, index, ...pages])
if (args[0] === "--check") {
  assert.ok(generated.equals(readFileSync(output)), "Rust Unicode width snapshot differs from the Zig reference")
} else {
  writeFileSync(output, generated)
}
console.log(
  `Rust Unicode width snapshot: ${pages.length} unique pages, ${transitions.length} transitions, ${generated.length} bytes`,
)
