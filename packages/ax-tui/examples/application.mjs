// Node 26+: node --experimental-ffi examples/application.mjs [--smoke]
import {
  BoxRenderable, InputRenderable, ImageRenderable, TextRenderable, createCliRenderer,
  getFocusManager, getCommandRegistry, getKeymap, showCommandPalette,
} from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

const smoke = process.argv.includes("--smoke")
const setup = smoke ? await createTestRenderer({ width: 64, height: 20, useKittyKeyboard: null }) : undefined
const renderer = setup?.renderer ?? await createCliRenderer({ exitOnCtrlC: true })
const panel = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column" })
const status = new TextRenderable(renderer, { content: "Tab: change field | Ctrl+P: commands | Ctrl+C: quit", height: 1 })
const first = new InputRenderable(renderer, { value: "First field", width: "100%" })
const second = new InputRenderable(renderer, { value: "Second field", width: "100%" })
const data = new Uint8Array(64 * 32 * 4)
for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
  const offset = (y * 64 + x) * 4
  data.set([x * 4, y * 8, 180, 255], offset)
}
const image = new ImageRenderable(renderer, { width: 40, height: 10, source: { width: 64, height: 32, data },
  alt: "Color gradient" })
panel.add(status); panel.add(first); panel.add(second); panel.add(image)
renderer.root.add(panel)
getFocusManager(renderer).registerScope(panel)
const commands = getCommandRegistry(renderer)
commands.register({ id: "preview.toggle", title: "Toggle preview", run() { image.visible = !image.visible } })
commands.register({ id: "fields.swap", title: "Swap field values", run() {
  const value = first.value; first.value = second.value; second.value = value
} })
getKeymap(renderer).register({ bindings: [
  { id: "commands", keys: "ctrl+p", handler() {
    const palette = showCommandPalette(renderer)
    void palette.result.then(result => {
      if (result?.status === "error") status.content = `Command failed: ${String(result.error)}`
    })
  } },
] })
first.focus()
await image.loadPromise
if (setup) {
  try {
    await setup.flush()
    console.log(setup.captureCharFrame())
    console.log(JSON.stringify({ protocol: image.effectiveProtocol, commands: commands.search().length }))
  } finally { renderer.destroy() }
} else {
  renderer.start()
}
