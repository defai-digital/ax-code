// Run with Node 26+: node --experimental-ffi examples/keymap-help.mjs [--smoke]
import {
  createCliRenderer, getKeymap, InputRenderable, InputRenderableEvents, KeymapHelpRenderable, TextRenderable,
} from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

const smoke = process.argv.includes("--smoke")
const test = smoke ? await createTestRenderer({ width: 48, height: 10, useKittyKeyboard: null }) : undefined
const renderer = test?.renderer ?? await createCliRenderer({ exitOnCtrlC: true })
const heading = new TextRenderable(renderer, { content: "Shortcut help - type to filter", height: 1 })
const search = new InputRenderable(renderer, { placeholder: "Search shortcuts...", width: "100%" })
const help = new KeymapHelpRenderable(renderer, { width: "100%", flexGrow: 1 })
const status = new TextRenderable(renderer, { content: "Ctrl+Q quits; Escape clears search", height: 1 })
for (const node of [heading, search, help, status]) renderer.root.add(node)
search.focus()

const keymap = getKeymap(renderer)
keymap.register({ target: search, bindings: [
  { id: "save", keys: "ctrl+s", description: "Save document", handler: () => { status.content = "Saved" } },
  { id: "first", keys: ["ctrl+k", "ctrl+t"], description: "First record",
    handler: () => { status.content = "First record selected" } },
  { id: "clear", keys: "escape", description: "Clear search", handler: () => { search.value = "" } },
  { id: "quit", keys: "ctrl+q", description: "Quit", handler: () => renderer.destroy() },
] })
help.bindings = keymap.getActiveBindings()
search.on(InputRenderableEvents.INPUT, value => { help.query = value })

if (test) {
  try {
    await test.renderOnce()
    console.log(test.captureCharFrame())
    search.value = "record"
    test.resize(24, 10)
    await test.renderOnce()
    console.log(test.captureCharFrame())
    console.log(JSON.stringify({ matches: help.matchCount, focusRetained: renderer.currentFocusedRenderable === search }))
  } finally { renderer.destroy() }
} else {
  renderer.start()
}
