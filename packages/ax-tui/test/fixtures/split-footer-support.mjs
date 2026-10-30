import { Writable } from "node:stream"
import { afterEach } from "node:test"
import { createTestRenderer, MockTreeSitterClient } from "@defai-digital/ax-tui/testing"

const renderers = []
const clients = []
afterEach(async () => {
  for (const renderer of renderers.splice(0)) renderer.destroy()
  for (const client of clients.splice(0)) {
    client.resolveAllHighlightOnce()
    await client.destroy()
  }
})

export async function setup(options = {}) {
  const result = await createTestRenderer({
    screenMode: "split-footer", externalOutputMode: "capture-stdout",
    width: 24, height: 10, footerHeight: 3, consoleMode: "disabled",
    useThread: false, useKittyKeyboard: null, memorySnapshotInterval: 0, ...options,
  })
  renderers.push(result.renderer)
  return result
}

export function client(options) {
  const value = new MockTreeSitterClient(options)
  value.setMockResult({ highlights: [] })
  clients.push(value)
  return value
}

export class RecordingStdout extends Writable {
  isTTY = true
  chunks = []
  constructor(columns = 40, rows = 10) {
    super()
    this.columns = columns
    this.rows = rows
  }
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback() }
  getColorDepth() { return 24 }
  text() { return Buffer.concat(this.chunks).toString() }
  clear() { this.chunks = [] }
}

export async function terminal(options = {}) {
  const stdout = new RecordingStdout(options.width ?? 40, options.height ?? 10)
  const result = await setup({ ...options, stdout, width: stdout.columns, height: stdout.rows,
    bufferedOutput: "stdout", remote: true })
  await result.renderer.setupTerminal()
  result.renderer.stdin.emit("data", Buffer.from("\x1b[1;1R"))
  await result.renderer.idle()
  await result.renderer._feed?.idle()
  stdout.clear()
  const frame = async () => {
    await result.renderOnce()
    await result.renderer._feed?.idle()
  }
  const drain = async () => {
    await result.renderer.idle()
    await result.renderer._feed?.idle()
  }
  return { ...result, stdout, frame, drain }
}
