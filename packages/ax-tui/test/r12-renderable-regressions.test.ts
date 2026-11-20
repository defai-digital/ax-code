import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for r12 lifecycle/view fixes. Each scenario runs in a
// Node child process with FFI enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

const PREAMBLE = `
import assert from "node:assert/strict"
import { createTestRenderer, MockTreeSitterClient } from "@defai-digital/ax-tui/testing"
import { DiffRenderable, SlotRenderable, SyntaxStyle, TextRenderable, createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const NL = String.fromCharCode(10)
`

test.skipIf(!supportsFfi)("slot destroy inside onDispose fires dispose once and cleans up remaining plugins", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const calls = []
  let slot
  let managedNode
  let hostNode
  const managedPlugin = {
    id: "managed-plugin",
    slots: {
      probe: {
        render: () => {
          managedNode = new TextRenderable(setup.renderer, { content: "managed" })
          return managedNode
        },
        onActivate: () => calls.push("activate"),
        onDeactivate: () => calls.push("deactivate"),
        onDispose: () => {
          calls.push("dispose")
          slot.destroy()
        },
      },
    },
  }
  const hostPlugin = {
    id: "host-plugin",
    slots: {
      probe: () => {
        hostNode = new TextRenderable(setup.renderer, { content: "host" })
        return hostNode
      },
    },
  }
  const unregisterManaged = registerCorePlugin(registry, managedPlugin)
  registerCorePlugin(registry, hostPlugin)
  slot = new SlotRenderable(setup.renderer, { registry, name: "probe", mode: "append" })
  setup.renderer.root.add(slot)
  assert.deepEqual(calls, ["activate"])

  unregisterManaged()
  assert.deepEqual(calls, ["activate", "deactivate", "dispose"])
  // The re-entrant destroy must still clean up the remaining host-owned plugin.
  assert.equal(hostNode.isDestroyed, true, "host-owned node of the remaining plugin must be destroyed")
  assert.equal(hostNode.parent, null)
  // Managed slots own their nodes: the slot detaches but must not destroy them.
  assert.equal(managedNode.isDestroyed, false, "plugin-owned node lifecycle belongs to the plugin")
  assert.equal(managedNode.parent, null)

  // The destroyed slot must not react to later registry changes.
  registerCorePlugin(registry, managedPlugin)
  assert.deepEqual(calls, ["activate", "deactivate", "dispose"])
  managedNode.destroy()
} finally {
  setup.renderer.destroy()
}
console.log("slot-destroy-during-dispose ok")
`)
})

test.skipIf(!supportsFfi)("diff split-to-unified switch restores styled text rendering", () => {
  runDriver(`
${PREAMBLE}
const treeSitterClient = new MockTreeSitterClient()
const setup = await createTestRenderer({ width: 80, height: 12 })
try {
  const diff = ["--- a/f.js", "+++ b/f.js", "@@ -1,2 +1,2 @@", " alpha", "-beta", "+gamma"].join(NL)
  const view = new DiffRenderable(setup.renderer, {
    diff,
    view: "split",
    wrapMode: "word",
    conceal: true,
    filetype: "js",
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient,
    width: 80,
    height: 10,
  })
  setup.renderer.root.add(view)
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.drawUnstyledText, false)

  view.view = "unified"
  await setup.renderOnce()
  assert.equal(view.leftCodeRenderable.drawUnstyledText, true)
} finally {
  setup.renderer.destroy()
  await treeSitterClient.destroy()
}
console.log("diff-split-to-unified-unstyled ok")
`)
})

function scenario(source: string): void {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { VirtualListRenderable, TextRenderable, Renderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
const settle = async () => {
  for (let pass = 0; pass < 8; pass++) { await setup.renderOnce(); await new Promise(r => setImmediate(r)) }
}
try { ${source} } finally { renderer.destroy() }
assert.equal(Renderable.renderablesByNumber.size, 0)
process.stdout.write("AX_SCENARIO_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_SCENARIO_COMPLETE")
}

test.skipIf(!supportsFfi)("pre-layout seek to the last row survives the first viewport clamp", () => {
  scenario(`
const list = new VirtualListRenderable(renderer, {
  id: "list", width: 40, height: 10, items: Array.from({ length: 100 }, (_, i) => i), getKey: x => x,
  estimateHeight: 1,
  renderItem: (x, i, ctx) => new TextRenderable(ctx, { content: "Row " + x + "\\nline2\\nline3" }),
})
renderer.root.add(list)
list.scrollToIndex(99, "end")
await settle()
assert.ok(setup.captureCharFrame().includes("Row 99"), setup.captureCharFrame())
`)
})
