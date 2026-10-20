// Real native-renderer integration fixture. Run under the Node FFI runner.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { InputRenderable, TextRenderable } from "ax-tui"
import { createTestRenderer } from "ax-tui/testing"
import { createTuiDebugRenderer } from "../../src/cli/tui/component/tui-debug-renderer"
import { createTuiMcpController } from "../../src/tuimcp/controller"
import { startTuiMcpEndpoint } from "../../src/tuimcp/endpoint"
import { startTuiInspector } from "../../src/tuimcp/inspector"

const setup = await createTestRenderer({ width: 80, height: 24, kittyKeyboard: true, useThread: false })
const renderer = setup.renderer
renderer.root.add(
  new TextRenderable(renderer, { id: "heading", content: "AX Code native renderer debug fixture", height: 1 }),
)
const input = new InputRenderable(renderer, { id: "debug-input", placeholder: "Type here", width: 60 })
renderer.root.add(input)
input.focus()
const adapter = createTuiDebugRenderer(renderer, () => 0)
const controller = createTuiMcpController({
  state: () => ({ workspace: "/test", route: "home", ready: true, blocked: false }),
  validateSession: async () => {},
  navigate: () => {},
  debug: { ...adapter, blocked: () => false },
})
renderer.keyInput.on("keypress", () => {
  if (!adapter.injecting) controller.humanInput()
})
const target = { instanceId: controller.instanceId, generation: controller.generation }
const signal = new AbortController().signal
await setup.renderOnce()
await setup.renderOnce()

if (process.argv.includes("--serve")) {
  const endpoint = await startTuiMcpEndpoint(controller)
  const inspector = await startTuiInspector(endpoint.filename)
  console.log(inspector.url)
  console.log(endpoint.filename)
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop)
      process.off("SIGTERM", stop)
      resolve()
    }
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })
  await inspector.close()
  await endpoint.close()
} else {
  const before = await controller.dispatch({ operation: "get_tui_snapshot", ...target }, signal)
  assert.equal(before.status, "snapshot")
  if (before.status === "snapshot") {
    assert.match(before.screen.text, /native renderer debug fixture/)
    assert.equal(before.screen.focusedId, "debug-input")
  }
  const paste = await controller.dispatch(
    {
      operation: "tui_input",
      ...target,
      expectedRevision: controller.context().revision,
      requestId: randomUUID(),
      action: { kind: "paste", text: "observed native input" },
    },
    signal,
  )
  assert.equal(paste.status, "applied")
  assert.equal(input.value, "observed native input")
  // Synthetic key input must not trigger the human quiet-period fence.
  const key = await controller.dispatch(
    {
      operation: "tui_input",
      ...target,
      expectedRevision: controller.context().revision,
      requestId: randomUUID(),
      action: { kind: "key", key: "backspace" },
    },
    signal,
  )
  assert.equal(key.status, "applied")
  assert.equal(input.value, "observed native inpu")
  await setup.renderOnce()
  const result = await controller.dispatch(
    { operation: "wait_for_tui", ...target, text: "observed native inpu", timeoutMs: 100 },
    signal,
  )
  assert.equal(result.status, "snapshot")
  const pageKeys: { name: string; ctrl: boolean; shift: boolean; meta: boolean }[] = []
  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "pageup" || key.name === "pagedown") pageKeys.push(key)
  })
  adapter.input({ kind: "key", key: "pageup", shift: true, ctrl: true, meta: true })
  adapter.input({ kind: "key", key: "pagedown" })
  assert.equal(pageKeys.length, 2)
  assert.equal(pageKeys[0].name, "pageup")
  assert.equal(pageKeys[0].ctrl, true)
  assert.equal(pageKeys[0].shift, true)
  assert.equal(pageKeys[0].meta, true)
  assert.equal(pageKeys[1].name, "pagedown")
  adapter.input({ kind: "resize", width: 100, height: 30 })
  await setup.renderOnce()
  assert.equal(adapter.snapshot().width, 100)
  input.value = "TOKEN=canary-private-value"
  await setup.renderOnce()
  assert.ok(!adapter.snapshot().text.includes("canary-private-value"))
  console.log("Native TUI snapshot, focus, paste, key, resize and redaction verified")
}
controller.dispose()
renderer.destroy()
