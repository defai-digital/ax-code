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

test.skipIf(!supportsFfi)("an empty-string child is replaced, not appended beside, when an array arrives", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { testRender } from "@defai-digital/ax-tui/solid"
import { Renderable } from "@defai-digital/ax-tui"

const [mode, setMode] = createSignal("")
const setup = await testRender(
  () => (
    <box>
      <text>{mode() === "list" ? ["A", "B"] : ""}</text>
    </box>
  ),
  { width: 10, height: 2, useKittyKeyboard: null },
)
await setup.flush()
setMode("list")
await setup.flush()
const frame = setup.captureCharFrame()
assert.ok(frame.includes("A"), frame)
assert.ok(frame.includes("B"), frame)
const emptyTextNodes = [...Renderable.renderablesByNumber.values()].filter(
  (r) => !r.isDestroyed && r.id.startsWith("text-node") && (r["_children"] ?? []).join("") === "",
)
assert.equal(emptyTextNodes.length, 0, "the empty text node must be reconciled away, not left beside the array")
setup.renderer.destroy()
process.stdout.write("AX_EMPTY_STRING_INSERT_COMPLETE")
`)
})
