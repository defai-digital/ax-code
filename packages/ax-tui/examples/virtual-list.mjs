// Run with Node 26+: node --experimental-ffi examples/virtual-list.mjs [--smoke]
import { createCliRenderer, getKeymap, TextRenderable, VirtualListRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

const smoke = process.argv.includes("--smoke")
const test = smoke ? await createTestRenderer({ width: 48, height: 12 }) : undefined
const renderer = test?.renderer ?? await createCliRenderer({ exitOnCtrlC: true })
const list = new VirtualListRenderable(renderer, {
  id: "records", width: "100%", height: "100%", estimateHeight: 2,
  items: Array.from({ length: 10_000 }, (_, id) => ({ id, text: `Record ${id}: ${"details ".repeat(id % 5)}` })),
  getKey: item => item.id,
  renderItem: (item, index, context) => new TextRenderable(context, {
    content: item.text, width: "100%", wrapMode: "word",
  }),
})
renderer.root.add(list)
list.focus()
getKeymap(renderer).register({
  target: list,
  bindings: [
    { id: "first", keys: ["g", "g"], description: "Go to first record", handler: () => list.scrollToIndex(0) },
    { id: "last", keys: "shift+g", description: "Go to last record", handler: () => list.scrollToIndex(9999) },
    { id: "quit", keys: "q", description: "Quit", handler: () => renderer.destroy() },
  ],
})

if (test) {
  try {
    const started = performance.now()
    for (let frame = 0; frame < 8; frame++) {
      await test.renderOnce()
      await new Promise(resolve => setImmediate(resolve))
    }
    const elapsedMs = performance.now() - started
    console.log(test.captureCharFrame())
    console.log(JSON.stringify({ items: list.items.length, mounted: list.mountedCount, elapsedMs }))
  } finally { renderer.destroy() }
} else {
  renderer.start()
}
