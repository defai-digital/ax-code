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

test.skipIf(!supportsFfi)("a failed mount sweeps partially inserted orphans and honors teardown", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { Renderable } from "@defai-digital/ax-tui"
import { render, testRender } from "@defai-digital/ax-tui/solid"

// A raw string child of <box> throws after the inner box mounted: the orphan
// must not survive under the externally-owned renderer's root.
const setup = await createTestRenderer({ width: 20, height: 6, useKittyKeyboard: null })
let escaped
try {
  await render(() => (<box><box id="ghost" />hello</box>) as never, setup.renderer)
} catch (err) {
  escaped = err
}
assert.ok(escaped, "mount must throw")
const ghost = [...Renderable.renderablesByNumber.values()].find((r) => r.id === "ghost")
assert.equal(ghost, undefined, "partially inserted sibling must be swept")
setup.renderer.destroy()

// testRender creates its own renderer: a throwing mount must destroy it.
let rejected
try {
  await testRender(() => {
    throw new Error("boom")
  }, { width: 20, height: 4, useKittyKeyboard: null })
} catch (err) {
  rejected = err
}
assert.ok(rejected, "testRender must reject")
assert.equal(
  [...Renderable.renderablesByNumber.values()].some((r) => !r.isDestroyed && r.parent === null && r.id !== "none"),
  false,
  "the failed testRender must not leave live renderables behind",
)
process.stdout.write("AX_SOLID_MOUNT_FAILURE_COMPLETE")
`)
})
