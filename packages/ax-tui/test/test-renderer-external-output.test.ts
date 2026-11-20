import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// The external-output recorder must split rows on native row breaks, not slice
// the decoded character string by cell width: wide glyphs occupy two cells but
// emit one character, so width slicing shifts every following row.
test.skipIf(!supportsFfi)("external output rows keep wide glyphs on their own row", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout).toContain("external-output wide rows ok")
})

const script = `
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { TextRenderable } from "@defai-digital/ax-tui"

const setup = await createTestRenderer({
  screenMode: "split-footer",
  externalOutputMode: "capture-stdout",
  width: 4,
  height: 10,
  footerHeight: 3,
  consoleMode: "disabled",
  useThread: false,
  useKittyKeyboard: null,
  memorySnapshotInterval: 0,
})
try {
  setup.renderer.writeToScrollback(({ renderContext }) => ({
    root: new TextRenderable(renderContext, { content: "界界\\nab", width: 4, height: 2 }),
  }))
  const commits = setup.externalOutput.take()
  assert.equal(commits.length, 1)
  assert.deepEqual(commits[0].rows, ["界界", "ab"])
  assert.equal(commits[0].text, "界界\\nab")
  assert.equal(commits[0].width, 4)
  assert.equal(commits[0].height, 2)
} finally {
  setup.renderer.destroy()
}
console.log("external-output wide rows ok")
`