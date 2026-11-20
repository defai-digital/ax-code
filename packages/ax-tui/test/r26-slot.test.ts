import { build } from "esbuild"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { resolveNodeSolidRuntimeImport, transformSolidSource } from "../solid/source/scripts/solid-transform.js"

const root = fileURLToPath(new URL("../", import.meta.url))
const solidEntry = path.join(root, "solid/source/index.ts")
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

async function runSolidScenario(source: string): Promise<void> {
  await mkdir(path.join(root, ".internal"), { recursive: true })
  const fixture = await mkdtemp(path.join(root, ".internal/solid-regressions-"))
  const driver = path.join(fixture, "driver.mjs")
  try {
    await build({
      stdin: {
        contents: await transformSolidSource(source, {
          filename: "solid-regressions.tsx",
          moduleName: solidEntry,
          resolvePath: (specifier) =>
            specifier === "@defai-digital/ax-tui/solid" ? solidEntry : resolveNodeSolidRuntimeImport(specifier),
        }),
        resolveDir: root,
        sourcefile: "solid-regressions.tsx",
        loader: "js",
      },
      outfile: driver,
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      logLevel: "silent",
      plugins: [
        {
          name: "solid-regressions-source",
          setup(builder) {
            builder.onResolve({ filter: /^solid-js(?:\/store)?$/ }, ({ path: specifier }) => ({
              path: resolveNodeSolidRuntimeImport(specifier)!,
              external: true,
            }))
            builder.onLoad({ filter: /\.tsx$/ }, async ({ path: filename }) => ({
              contents: await transformSolidSource(await readFile(filename, "utf8"), { filename }),
              loader: "js",
            }))
          },
        },
      ],
    })
    const result = spawnSync(
      process.execPath,
      ["--experimental-ffi", "--disable-warning=ExperimentalWarning", driver],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" },
      },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}

test.skipIf(!supportsFfi)("slot batches same-tick registrations, follows registry swaps, and isolates plugin errors", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender, Slot, createSolidSlotRegistry } from "@defai-digital/ax-tui/solid"

const setupA = await testRender(() => <box width={20} height={4} />, { width: 20, height: 4, useKittyKeyboard: null })
const regA = createSolidSlotRegistry(setupA.renderer, {})
const regB = createSolidSlotRegistry(setupA.renderer, {})
const [active, setActive] = createSignal(regA)
let failures = 0
const guardReg = () => {
  const original = regA.reportPluginError?.bind(regA)
  return regA
}
const setup = await testRender(
  () => (
    <box width={20} height={4}>
      <Slot registry={active()} name="status" />
    </box>
  ),
  { width: 20, height: 4, useKittyKeyboard: null },
)
try {
  // Two synchronous registrations in the same tick must both render.
  active().register({ id: "a", slots: { status: () => <text>AAA</text> } })
  active().register({ id: "b", slots: { status: () => <text>BBB</text> } })
  await setup.flush()
  let frame = setup.captureCharFrame()
  assert.ok(frame.includes("AAA"), "first same-tick registration missing: " + frame)
  assert.ok(frame.includes("BBB"), "second same-tick registration dropped: " + frame)

  // Swapping the registry must re-subscribe: mutations on the new registry
  // render, and the old one no longer drives the slot.
  setActive(regB)
  await setup.flush()
  regB.register({ id: "c", slots: { status: () => <text>CCC</text> } })
  await setup.flush()
  frame = setup.captureCharFrame()
  assert.ok(frame.includes("CCC"), "new-registry registration missing after swap: " + frame)
  assert.ok(!frame.includes("AAA"), "old registry must not drive the slot after a swap: " + frame)

  // A throwing plugin renderer is reported, not propagated.
  const errors = []
  const originalReport = regB.reportPluginError?.bind(regB)
  regB.reportPluginError = (event) => {
    errors.push(event)
    return originalReport ? originalReport(event) : event
  }
  regB.register({
    id: "boom",
    slots: {
      status: () => {
        throw new Error("boom")
      },
    },
  })
  await setup.flush()

  // A reactive plugin throw is isolated by the boundary as well — including
  // lazy accessors whose signal reads happen inside the boundary-owned memo.
  const [broken, setBroken] = createSignal(false)
  let lazyCalls = 0
  regB.register({
    id: "rx",
    slots: {
      status: () => {
        lazyCalls += 1
        if (broken()) throw new Error("rx boom")
        return <text>OK</text>
      },
    },
  })
  await setup.flush()
  assert.ok(lazyCalls >= 1)
  let crashed = null
  try {
    setBroken(true)
    await setup.flush()
  } catch (err) {
    crashed = err
  }
  assert.equal(crashed, null, "reactive plugin throw must be isolated: " + (crashed && crashed.message))
  assert.ok(errors.length >= 1, "throwing plugin must be reported through reportPluginError")
} finally {
  setup.renderer.destroy()
  setupA.renderer.destroy()
}
process.stdout.write("AX_SOLID_SLOT_COMPLETE")
`)
})
