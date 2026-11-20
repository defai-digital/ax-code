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

test.skipIf(!supportsFfi)("Dynamic rejects prototype-chain component names as unknown types", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { ErrorBoundary } from "solid-js"
import { Dynamic, testRender } from "@defai-digital/ax-tui/solid"

for (const component of ["constructor", "toString"]) {
  let caught, escaped, setup
  try {
    setup = await testRender(
      () => (
        <ErrorBoundary fallback={(err) => { caught = err; return <text>failed</text> }}>
          <Dynamic component={component} />
        </ErrorBoundary>
      ),
      { width: 20, height: 4, useKittyKeyboard: null },
    )
    await setup.flush()
  } catch (err) {
    escaped = err
  } finally {
    setup?.renderer.destroy()
  }
  const error = caught ?? escaped
  assert.ok(error, "no error surfaced for " + component)
  assert.match(String(error?.message ?? error), /Unknown component type:/)
}
process.stdout.write("AX_SOLID_DYNAMIC_PROTO_COMPLETE")
`)
})

test.skipIf(!supportsFfi)("Portal disposes its content root when mount content throws", async () => {
  await runSolidScenario(`
import assert from "node:assert/strict"
import { createSignal, ErrorBoundary, onCleanup, Show } from "solid-js"
import { Portal, testRender } from "@defai-digital/ax-tui/solid"
import { Renderable } from "@defai-digital/ax-tui"

const [show, setShow] = createSignal(false)
const Boom = () => { throw new Error("boom") }
let caught, escaped, cleanups = 0
const SpyingChild = () => {
  onCleanup(() => { cleanups += 1 })
  return <box />
}
const setup = await testRender(
  () => (
    <Show when={show()}>
      <ErrorBoundary fallback={(err) => { caught = err; return <text>failed</text> }}>
        <Portal>
          <SpyingChild />
          <Boom />
        </Portal>
      </ErrorBoundary>
    </Show>
  ),
  { width: 20, height: 6, useKittyKeyboard: null },
)
const { renderer } = setup
const leaked = () =>
  [...Renderable.renderablesByNumber.values()].filter(
    (r) => !r.isDestroyed && r.parent === null && r !== renderer.root && r.id.startsWith("box-"),
  ).length
try {
  await setup.flush()
  assert.equal(leaked(), 0)
  try {
    setShow(true)
    await setup.flush()
  } catch (err) {
    escaped = err
  }
  assert.ok(caught ?? escaped, "no error surfaced")
  // The content root created for the portal children must be disposed even
  // when a child throws during the portal's first mount; otherwise the
  // child's own cleanup never runs. (A sibling renderable created but never
  // inserted because the throw aborts the children array is a separate,
  // pre-existing reconciler tracking limitation and may still leak.)
  assert.equal(cleanups, 1)
} finally {
  renderer.destroy()
}
process.stdout.write("AX_SOLID_PORTAL_THROW_COMPLETE")
`)
})
