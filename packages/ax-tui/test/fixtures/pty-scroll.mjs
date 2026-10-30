// Real terminal fixture: control messages never travel through the input parser.
import assert from "node:assert/strict"
import { Socket } from "node:net"
import { createInterface } from "node:readline"
import { createCliRenderer, TextRenderable, VirtualListRenderable } from "@defai-digital/ax-tui"

assert.ok(process.stdin.isTTY && process.stdout.isTTY)
const control = new Socket({ fd: Number(process.argv[2]), readable: true, writable: true })
const renderer = await createCliRenderer({
  useThread: false, useKittyKeyboard: null, consoleMode: "disabled",
  enableMouseMovement: false, debounceDelay: 0, memorySnapshotInterval: 0,
})
let wheelEvents = 0
let chunks = 0
const header = new TextRenderable(renderer, { content: "Stream chunks: 0", height: 1 })
let items = Array.from({ length: 500 }, (_, id) => ({ id, text: `MARKER-${String(id).padStart(4, "0")}` }))
const list = new VirtualListRenderable(renderer, {
  width: "100%", flexGrow: 1, items, getKey: item => item.id, estimateHeight: 1,
  scrollAcceleration: { tick: () => 1, reset() {} },
  onMouseScroll: () => { wheelEvents++ },
  renderItem: (item, _index, context) => new TextRenderable(context, {
    content: item.text, width: "100%", wrapMode: "word",
  }),
})
renderer.root.add(header)
renderer.root.add(list)
list.focus()

async function settle() {
  // Layout measurements enqueue microtasks; await their requested frames as well.
  for (let pass = 0; pass < 3; pass++) {
    await new Promise(resolve => setImmediate(resolve))
    await renderer.idle()
  }
}

async function waitFor(predicate) {
  const deadline = performance.now() + 5000
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "Input or resize was not delivered")
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function reply(id) {
  const state = { id, wheelEvents, chunks, top: list.scrollTop, mounted: list.mountedCount,
    width: renderer.width, height: renderer.height, frame: renderer.frameId }
  // An output-stream barrier prevents a control ACK from overtaking terminal bytes.
  process.stdout.write(`\x1b]777;ax-pty;${id}\x07`)
  control.write(JSON.stringify(state) + "\n")
}

try {
  await settle()
  list.scrollToIndex(200)
  await settle()
  reply("ready")
  for await (const line of createInterface({ input: control })) {
    const command = JSON.parse(line)
    if (command.kind === "quit") break
    if (command.kind === "wheel") await waitFor(() => wheelEvents === command.expected)
    else if (command.kind === "resize") {
      await waitFor(() => renderer.width === command.width && renderer.height === command.height)
    } else if (command.kind === "stream") {
      chunks++
      const tail = items.at(-1)
      items = [...items.slice(0, -1), { ...tail, text: tail.text + " growing tail".repeat(8) },
        { id: 500 + chunks, text: `TAIL-${chunks}` }]
      list.items = items
      header.content = `Stream chunks: ${chunks}`
    } else assert.equal(command.kind, "idle")
    await settle()
    reply(command.id)
  }
} finally {
  renderer.destroy()
  control.destroy()
}
