import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Real-worker regressions for r15: the root-fallback highlight range must clamp
// startIndex at 0, and code-fence info strings must normalize case/whitespace
// before the injection language lookup.
test.skipIf(!supportsFfi)(
  "tree-sitter worker edit ranges and fence info-string normalization",
  async () => {
    await mkdir(path.join(root, ".internal"), { recursive: true })
    const fixture = await mkdtemp(path.join(root, ".internal/ts-r15-"))
    try {
      const result = spawnSync(
        process.execPath,
        ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script, fixture],
        { cwd: root, encoding: "utf8", timeout: 90_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
      )
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain("r15 worker regressions passed")
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  },
  100_000,
)

const script = `
import assert from "node:assert/strict"
import { once } from "node:events"
import path from "node:path"
import { TreeSitterClient } from "@defai-digital/ax-tui"

const base = process.argv[1]
const failures = []
const scenario = async (name, fn) => {
  try {
    await fn()
  } catch (err) {
    failures.push(name + ": " + (err && err.message ? err.message : String(err)))
  }
}
const nextHighlights = async (client, action) => {
  const response = once(client, "highlights:response", { signal: AbortSignal.timeout(15000) })
  response.catch(() => {})
  const result = await action()
  const event = await response
  return { result, event }
}

// A tail edit followed by a select-all replacement at byte 0 must keep
// highlights: the root-fallback query range used startIndex - 100, which
// tree-sitter rejects (start > end), leaving a stale narrow scratch range.
await scenario("select-all-after-tail-edit-keeps-highlights", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "f3") })
  try {
    const contentA = "const alpha = 1\\n".repeat(20)
    const first = await nextHighlights(client, () => client.createBuffer(1, contentA, "typescript"))
    assert.ok(first.event[2].length > 0, "no initial highlights")
    const contentB = contentA.slice(0, 160) + "const omega = 99\\n".repeat(10)
    const edit1 = {
      startIndex: 160,
      oldEndIndex: contentA.length,
      newEndIndex: contentB.length,
      startPosition: { row: 10, column: 0 },
      oldEndPosition: { row: 20, column: 0 },
      newEndPosition: { row: 20, column: 0 },
    }
    await nextHighlights(client, () => client.updateBuffer(1, [edit1], contentB, 2))
    const contentC = "const z = 9\\n"
    const edit2 = {
      startIndex: 0,
      oldEndIndex: contentB.length,
      newEndIndex: contentC.length,
      startPosition: { row: 0, column: 0 },
      oldEndPosition: { row: 20, column: 0 },
      newEndPosition: { row: 1, column: 0 },
    }
    const { event } = await nextHighlights(client, () => client.updateBuffer(1, [edit2], contentC, 3))
    assert.equal(event[1], 3)
    assert.ok(event[2].length > 0, "select-all replacement at byte 0 lost all highlights")
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// Uppercase fence info strings must resolve to the registered lowercase
// filetype so the injected language actually highlights.
await scenario("uppercase-fence-info-string-injects", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "g2") })
  try {
    const content = "# doc\\n\\n\`\`\`JS\\nlet a = 1\\n\`\`\`\\n"
    const { event } = await nextHighlights(client, () => client.createBuffer(1, content, "markdown"))
    const row = event[2].find((r) => r.line === 3)
    assert.ok(row, "no highlight row for the fenced code line: " + JSON.stringify(event[2]))
    assert.ok(
      row.highlights.some((h) => h.group === "keyword"),
      "no keyword highlight inside uppercase JS fence: " + JSON.stringify(row),
    )
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// Pin: lowercase info strings keep working.
await scenario("lowercase-fence-info-string-injects", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "g2-pin") })
  try {
    const content = "# doc\\n\\n\`\`\`javascript\\nlet a = 1\\n\`\`\`\\n"
    const { event } = await nextHighlights(client, () => client.createBuffer(1, content, "markdown"))
    const row = event[2].find((r) => r.line === 3)
    assert.ok(
      row && row.highlights.some((h) => h.group === "keyword"),
      "lowercase fence lost injection: " + JSON.stringify(event[2]),
    )
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

if (failures.length > 0) {
  console.error("FAILURES:\\n" + failures.join("\\n"))
  process.exit(1)
}
console.log("r15 worker regressions passed")
`
