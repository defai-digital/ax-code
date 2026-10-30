// Real split-footer terminal fixture. Control traffic bypasses captured stdout.
import assert from "node:assert/strict"
import { Socket, createConnection } from "node:net"
import { createInterface } from "node:readline"
import { createCliRenderer, TextRenderable, CliRenderEvents } from "@defai-digital/ax-tui"
import { ManualClock } from "@defai-digital/ax-tui/testing"

assert.ok(process.stdin.isTTY && process.stdout.isTTY)
const control = process.argv[2].startsWith("/")
  ? createConnection(process.argv[2])
  : new Socket({ fd: Number(process.argv[2]), readable: true, writable: true })
const commands = createInterface({ input: control })
const write = process.stdout.write.bind(process.stdout)
const clock = new ManualClock()
const renderer = await createCliRenderer({
  screenMode: "split-footer", externalOutputMode: "capture-stdout", footerHeight: 3,
  useThread: false, useKittyKeyboard: null, consoleMode: "disabled", enableMouseMovement: false,
  clearOnShutdown: false, debounceDelay: 1, memorySnapshotInterval: 0, clock,
})
const footer = new TextRenderable(renderer, { content: "FOOTER-THREE", height: 1 })
renderer.root.add(footer)
let signals = 0
let commits = 0
process.on("SIGWINCH", () => signals++)
renderer.on(CliRenderEvents.EXTERNAL_OUTPUT, () => commits++)
renderer.on(CliRenderEvents.DESTROY, () => {
  // A shell-like marker proves the restored cursor is below the transcript.
  queueMicrotask(() => {
    write("SHELL-PROMPT")
    commands.close()
    control.destroy()
  })
})

async function drain() {
  clock.advance(200)
  await renderer.loop()
  for (let pass = 0; renderer.externalOutputQueue.size > 0; pass++) {
    assert.ok(pass < 200, "Scrollback queue failed to drain")
    await renderer.loop()
  }
  await renderer.loop()
}
function reply(id) {
  write(`\x1b]777;ax-split;${id}\x07`)
  control.write(JSON.stringify({ id, signals, commits, pending: renderer.externalOutputQueue.size,
    width: renderer.width, height: renderer.height, terminalHeight: process.stdout.rows, frame: renderer.frameId }) + "\n")
}
async function waitSignal(expected) {
  const deadline = performance.now() + 5000
  while (signals < expected) {
    assert.ok(performance.now() < deadline, "SIGWINCH not delivered")
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

await drain()
reply("ready")
try {
  for await (const line of commands) {
    const command = JSON.parse(line)
    if (command.kind === "queue") {
      const surface = renderer.createScrollbackSurface()
      const row = new TextRenderable(surface.renderContext, { content: "", width: "100%", height: 1 })
      surface.root.add(row)
      for (let i = command.start; i < command.end; i++) {
        row.content = `ROW-${String(i).padStart(4, "0")}`
        surface.render()
        surface.commitRows(0, 1)
      }
      surface.destroy()
      assert.equal(renderer.externalOutputQueue.size, command.end - command.start)
    } else if (command.kind === "footer") {
      renderer.footerHeight = 5
      footer.content = "FOOTER-FIVE"
      await drain()
    } else if (command.kind === "signal") {
      await waitSignal(command.expected)
    } else if (command.kind === "resize") {
      await waitSignal(command.expected)
      await drain()
      assert.equal(renderer.width, command.width)
      assert.equal(process.stdout.rows, command.height)
    } else if (command.kind === "idle") await drain()
    else if (command.kind === "pending-sigterm") {
      process.stdout.write("PENDING-SIGTERM-0\nPENDING-SIGTERM-1\nPENDING-SIGTERM-2\n")
      assert.equal(renderer.externalOutputQueue.size, 3)
    } else if (command.kind === "quit") break
    else throw new Error(`Unknown command: ${command.kind}`)
    reply(command.id)
  }
} finally {
  renderer.destroy()
  process.stdin.pause()
}
