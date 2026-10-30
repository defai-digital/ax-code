import assert from "node:assert/strict"
import { connect } from "node:net"
import { createRequire } from "node:module"
import { createInterface } from "node:readline"
import { createCliRenderer, InputRenderable, TextRenderable, VirtualListRenderable, getFocusManager } from "@defai-digital/ax-tui"

assert.ok(process.stdin.isTTY && process.stdout.isTTY)
// Force a legacy output code page in this private ConPTY to exercise native UTF-8 setup.
const consoleLibrary = process.platform === "win32"
  ? createRequire(import.meta.url)("node:ffi").dlopen("kernel32.dll", {
    GetConsoleOutputCP: { arguments: [], return: "u32" },
    SetConsoleOutputCP: { arguments: ["u32"], return: "i32" },
  }) as { lib: { close(): void }, functions: {
    GetConsoleOutputCP(): number, SetConsoleOutputCP(value: number): number,
  } }
  : undefined
if (consoleLibrary) {
  assert.notEqual(consoleLibrary.functions.SetConsoleOutputCP(437), 0)
  assert.equal(consoleLibrary.functions.GetConsoleOutputCP(), 437)
}
const control = connect(Number(process.argv[2]), "127.0.0.1")
await new Promise<void>((resolve, reject) => {
  control.once("connect", resolve)
  control.once("error", reject)
})
const renderer = await createCliRenderer({
  useThread: false, useKittyKeyboard: null, consoleMode: "disabled", enableMouseMovement: false,
  debounceDelay: 0, memorySnapshotInterval: 0,
})
if (consoleLibrary) assert.equal(consoleLibrary.functions.GetConsoleOutputCP(), 65001)
let wheelEvents = 0
let chunks = 0
const header = new TextRenderable(renderer, { content: "Unicode: 中文 cafe\u0301 Ω 😀", height: 1,
  fg: "#abcdef", bg: "#123456" })
const input = new InputRenderable(renderer, { id: "editor", width: "100%" })
const second = new InputRenderable(renderer, { id: "second", value: "Second field" })
let items = Array.from({ length: 10000 }, (_, id) => ({ id, text: `ROW-${String(id).padStart(5, "0")}` }))
const list = new VirtualListRenderable(renderer, {
  width: "100%", flexGrow: 1, items, getKey: item => item.id, estimateHeight: 1,
  scrollAcceleration: { tick: () => 1, reset() {} }, onMouseScroll: () => { wheelEvents++ },
  renderItem: (item, _index, context) => new TextRenderable(context, { content: item.text, width: "100%" }),
})
renderer.root.add(header)
renderer.root.add(input)
renderer.root.add(second)
renderer.root.add(list)
getFocusManager(renderer).registerScope(renderer.root)
input.focus()

async function settle() {
  for (let pass = 0; pass < 3; pass++) {
    await new Promise(resolve => setImmediate(resolve))
    await renderer.idle()
  }
}

async function waitFor(predicate: () => boolean) {
  const deadline = performance.now() + 5000
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "Terminal input/resize delivery timed out")
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function reply(id: string) {
  // OSC title changes survive both ConPTY and tmux's terminal parser. A private
  // unrecognized OSC would be dropped by those intermediaries.
  process.stdout.write(`\x1b]2;ax-terminal;${id}\x07`)
  control.write(JSON.stringify({ id, value: input.value, focus: renderer.currentFocusedRenderable?.id,
    top: list.scrollTop, mounted: list.mountedCount, wheelEvents, chunks,
    width: renderer.width, height: renderer.height, frame: renderer.frameId,
    nativeFrame: new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true)),
    capabilities: renderer.capabilities }) + "\n")
}

try {
  await settle()
  list.scrollToIndex(5000)
  await settle()
  reply("ready")
  for await (const line of createInterface({ input: control })) {
    const command = JSON.parse(line)
    if (command.kind === "quit") break
    if (command.kind === "input") await waitFor(() => input.value === command.value)
    else if (command.kind === "focus") await waitFor(() => renderer.currentFocusedRenderable?.id === command.focus)
    else if (command.kind === "wheel") await waitFor(() => wheelEvents === command.expected)
    else if (command.kind === "resize") {
      await waitFor(() => renderer.width === command.width && renderer.height === command.height)
    } else if (command.kind === "stream") {
      // Multiple asynchronous mutations while the viewport remains parked.
      for (let index = 0; index < command.count; index++) {
        await new Promise(resolve => setImmediate(resolve))
        chunks++
        items = [...items.slice(-9999), { id: 10000 + chunks, text: `TAIL-${chunks}` }]
        list.items = items
        header.content = `Unicode: 中文 cafe\u0301 Ω 😀 | ${chunks}`
      }
    } else assert.equal(command.kind, "idle")
    await settle()
    reply(command.id)
  }
} finally {
  renderer.destroy()
  if (consoleLibrary) {
    assert.equal(consoleLibrary.functions.GetConsoleOutputCP(), 437)
    consoleLibrary.lib.close()
  }
  // Confirm teardown over the independent control channel; tmux hides the
  // pane process status from the client it spawns.
  control.write(JSON.stringify({ id: "shutdown" }) + "\n")
  control.end()
}
