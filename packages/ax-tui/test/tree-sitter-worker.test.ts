import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Real-worker regressions for the tree-sitter client/worker lifecycle. Each
// scenario owns a fresh client and dataPath; failures are collected so one run
// reports every broken behavior instead of stopping at the first.
test.skipIf(!supportsFfi)(
  "tree-sitter worker lifecycle, dataPath retry, and highlight ranges",
  async () => {
    await mkdir(path.join(root, ".internal"), { recursive: true })
    const fixture = await mkdtemp(path.join(root, ".internal/ts-worker-"))
    try {
      const result = spawnSync(
        process.execPath,
        ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script, fixture],
        { cwd: root, encoding: "utf8", timeout: 90_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
      )
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain("tree-sitter worker regressions passed")
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  },
  100_000,
)

const script = `
import assert from "node:assert/strict"
import { once } from "node:events"
import { readdir, writeFile } from "node:fs/promises"
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
  const response = once(client, "highlights:response", { signal: AbortSignal.timeout(8000) })
  response.catch(() => {})
  const result = await action()
  const event = await response
  return { result, event }
}

// A failed parser init must not leave a pending buffer behind: recreating the
// same buffer id with a real language has to succeed.
await scenario("createBuffer-failed-init-recreate", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s1") })
  try {
    const created = await client.createBuffer(1, "x", "no-such-language")
    assert.equal(created, false)
    const { result, event } = await nextHighlights(client, () => client.createBuffer(1, "const x = 1", "typescript"))
    assert.equal(result, true)
    assert.ok(event[2].length > 0, "no highlights after recreate")
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// A failed setDataPath must be retryable with the same path, and a later
// successful change must leave the worker usable.
await scenario("setDataPath-failure-retry", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s2") })
  const badPath = path.join(base, "s2-not-a-dir.txt")
  await writeFile(badPath, "file, not a directory")
  try {
    await client.highlightOnce("const x = 1", "typescript")
    await assert.rejects(() => client.setDataPath(badPath))
    await assert.rejects(() => client.setDataPath(badPath))
    await client.setDataPath(path.join(base, "s2-valid"))
    const result = await client.highlightOnce("const x = 1", "typescript")
    assert.equal(result.error, undefined)
    assert.ok(result.highlights && result.highlights.length > 0, JSON.stringify(result))
  } finally {
    await client.destroy()
  }
})

// Repeated resets and a full-content edit keep producing highlights (tree
// replacement guard; the native leak itself is not observable from JS).
await scenario("reset-edit-cycles-stay-highlighted", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s3") })
  try {
    const snippets = ["const s = \\"hello\\"\\n// note\\nlet n = 42", "let a = 1\\n/* block */\\nconst b = \\"x\\""]
    let version = 1
    const first = await nextHighlights(client, () => client.createBuffer(1, snippets[0], "typescript"))
    assert.ok(first.event[2].length > 0, "no initial highlights")
    for (let i = 0; i < 24; i++) {
      version++
      const { event } = await nextHighlights(client, () => client.resetBuffer(1, version, snippets[i % 2]))
      assert.equal(event[0], 1)
      assert.equal(event[1], version)
      assert.ok(event[2].length > 0, "empty highlights at cycle " + i)
    }
    version++
    const content = snippets[0]
    const prev = snippets[1]
    const prevLines = prev.split("\\n")
    const newLines = content.split("\\n")
    const { event } = await nextHighlights(client, () =>
      client.updateBuffer(
        1,
        [{
          startIndex: 0,
          oldEndIndex: prev.length,
          newEndIndex: content.length,
          startPosition: { row: 0, column: 0 },
          oldEndPosition: { row: prevLines.length - 1, column: prevLines[prevLines.length - 1].length },
          newEndPosition: { row: newLines.length - 1, column: newLines[newLines.length - 1].length },
        }],
        content,
        version,
      ),
    )
    assert.equal(event[0], 1)
    assert.equal(event[1], version)
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// A multi-line node's first-line highlight must end at the line length, not at
// the node's end column on a later line.
await scenario("multiline-highlight-endCol-clamped", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s4") })
  try {
    const content = "/* short\\nmuchlongerline\\nx */"
    const { event } = await nextHighlights(client, () => client.createBuffer(1, content, "javascript"))
    const rows = event[2]
    const row0 = rows.find((r) => r.line === 0)
    assert.ok(row0 && row0.highlights.some((h) => h.startCol === 0 && h.endCol === 8), JSON.stringify(row0))
    const row1 = rows.find((r) => r.line === 1)
    assert.ok(row1 && row1.highlights.some((h) => h.endCol === 14), JSON.stringify(row1))
    const row2 = rows.find((r) => r.line === 2)
    assert.ok(row2 && row2.highlights.some((h) => h.group === "comment" && h.endCol === 4), JSON.stringify(row2))
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// Injection captures from separate cells must not erase each other during
// per-line dedup: both code spans on a table row keep their nospell highlight.
await scenario("injection-captures-survive-per-line-dedup", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s5") })
  try {
    const content = "| \`a\` | \`b\` |\\n| - | - |\\n| \`x\` | \`y\` |\\n"
    const { event } = await nextHighlights(client, () => client.createBuffer(1, content, "markdown"))
    const rows = event[2]
    for (const line of [0, 2]) {
      const row = rows.find((r) => r.line === line)
      const nospell = (row ? row.highlights : []).filter((h) => h.group === "nospell")
      const cols = [...new Set(nospell.map((h) => h.startCol))]
      assert.equal(cols.length, 2, "line " + line + " nospell cols " + JSON.stringify(nospell))
      for (const h of nospell) assert.equal(h.endCol - h.startCol, 3, JSON.stringify(h))
    }
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// setDataPath during an in-flight initialize must still reach the worker: the
// worker creates its cache directories under the new path. Bundled grammars
// load in place, so directory creation is the observable worker-side effect.
await scenario("setDataPath-during-init-reaches-worker", async () => {
  const dirA = path.join(base, "s6-a")
  const dirB = path.join(base, "s6-b")
  const client = new TreeSitterClient({ dataPath: dirA })
  try {
    const init = client.initialize()
    const update = client.setDataPath(dirB)
    await Promise.all([init, update])
    const result = await client.highlightOnce("const x = 1", "typescript")
    assert.equal(result.error, undefined)
    assert.ok(result.highlights && result.highlights.length > 0, JSON.stringify(result))
    const entries = (dir) => readdir(dir).catch(() => [])
    const newDirs = await entries(path.join(dirB, "tree-sitter"))
    assert.ok(
      newDirs.includes("languages") && newDirs.includes("queries"),
      "worker never saw the updated dataPath: " + JSON.stringify(newDirs),
    )
  } finally {
    await client.destroy()
  }
})

// Disposing a buffer while its parser init is in flight must not let the stale
// init publish old-content highlights for a recreated buffer with new content.
await scenario("dispose-during-init-drops-stale-highlights", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s8") })
  try {
    await client.initialize()
    const events = []
    client.on("highlights:response", (...event) => events.push(event))
    const created1 = client.createBuffer(1, "// old comment line", "typescript")
    await client.removeBuffer(1)
    const created2 = client.createBuffer(1, "const newValue = 1", "typescript")
    assert.equal(await created1, false)
    assert.equal(await created2, true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.ok(events.length > 0, "no highlights for the recreated buffer")
    for (const event of events) {
      assert.equal(event[0], 1)
      for (const row of event[2]) {
        for (const h of row.highlights) {
          assert.notEqual(h.group, "comment", "stale comment highlights leaked: " + JSON.stringify(event))
        }
      }
    }
    const groups = events.flatMap((event) => event[2].flatMap((row) => row.highlights.map((h) => h.group)))
    assert.ok(groups.includes("keyword"), "no keyword highlights for new content: " + JSON.stringify(groups))
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// clearCache must keep live buffers and one-shot highlighting usable (the
// reusable-parser leak itself is not observable from JS).
await scenario("clearCache-keeps-buffers-and-oneshots-working", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s7") })
  try {
    const first = await nextHighlights(client, () => client.createBuffer(1, "const a = 1", "typescript"))
    assert.equal(first.result, true)
    assert.ok(first.event[2].length > 0, "no initial highlights")
    const js = await client.highlightOnce("let b = 2", "javascript")
    assert.equal(js.error, undefined)
    await client.clearCache()
    const { event } = await nextHighlights(client, () => client.resetBuffer(1, 2, "const z = 3"))
    assert.equal(event[1], 2)
    assert.ok(event[2].length > 0, "live buffer lost highlighting after clearCache")
    const jsAgain = await client.highlightOnce("let c = 3", "javascript")
    assert.equal(jsAgain.error, undefined)
    assert.ok(jsAgain.highlights && jsAgain.highlights.length > 0, "one-shot broken after clearCache")
    await client.clearCache()
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// Disposing a buffer while a reset is waiting on an uncached injection parser
// must not leak stale multi-line highlights into a recreated buffer id. On this
// host the WASM compile blocks the worker and the client's absent-buffer and
// version guards mask the stale publish, so this pins the stability contract
// rather than a race that reproduces pre-fix; the worker generation guard is
// defense-in-depth for the async parser-load gap.
await scenario("dispose-during-reset-injection-drops-stale-highlights", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s9") })
  try {
    await client.initialize()
    const events = []
    client.on("highlights:response", (...event) => events.push(event))
    const initial = "# doc\\n\\n\`\`\`javascript\\nlet a = 1\\n\`\`\`\\n"
    const first = await nextHighlights(client, () => client.createBuffer(1, initial, "markdown"))
    assert.ok(first.event[2].length > 0, "no initial markdown highlights")
    const staleContent = "# doc\\n\\n\`\`\`typescript\\nconst a = 1\\n\`\`\`\\n"
    void client.resetBuffer(1, 2, staleContent)
    await new Promise((resolve) => setTimeout(resolve, 25))
    await client.removeBuffer(1)
    const created = await nextHighlights(client, () => client.createBuffer(1, "let fresh = 1", "javascript"))
    assert.equal(created.result, true)
    await nextHighlights(client, () => client.resetBuffer(1, 2, "const fresh2 = 2"))
    await new Promise((resolve) => setTimeout(resolve, 600))
    const v2 = events.filter((e) => e[1] === 2)
    assert.ok(v2.length > 0, "no version-2 highlights for the recreated buffer")
    for (const event of v2) {
      for (const row of event[2]) {
        assert.equal(row.line, 0, "stale reset highlights after dispose: " + JSON.stringify(event))
      }
    }
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

// The same stability contract through updateBuffer with a full-content edit.
await scenario("dispose-during-update-injection-drops-stale-highlights", async () => {
  const client = new TreeSitterClient({ dataPath: path.join(base, "s10") })
  try {
    await client.initialize()
    const events = []
    client.on("highlights:response", (...event) => events.push(event))
    const initial = "# doc\\n\\n\`\`\`javascript\\nlet a = 1\\n\`\`\`\\n"
    const first = await nextHighlights(client, () => client.createBuffer(1, initial, "markdown"))
    assert.ok(first.event[2].length > 0, "no initial markdown highlights")
    const staleContent = "# doc\\n\\n\`\`\`typescript\\nconst a = 1\\n\`\`\`\\n"
    const prevLines = initial.split("\\n")
    const newLines = staleContent.split("\\n")
    const edit = [{
      startIndex: 0,
      oldEndIndex: initial.length,
      newEndIndex: staleContent.length,
      startPosition: { row: 0, column: 0 },
      oldEndPosition: { row: prevLines.length - 1, column: prevLines[prevLines.length - 1].length },
      newEndPosition: { row: newLines.length - 1, column: newLines[newLines.length - 1].length },
    }]
    void client.updateBuffer(1, edit, staleContent, 2)
    await new Promise((resolve) => setTimeout(resolve, 15))
    await client.removeBuffer(1)
    const created = await nextHighlights(client, () => client.createBuffer(1, "let fresh = 1", "javascript"))
    assert.equal(created.result, true)
    await nextHighlights(client, () => client.resetBuffer(1, 2, "const fresh2 = 2"))
    await new Promise((resolve) => setTimeout(resolve, 600))
    const v2 = events.filter((e) => e[1] === 2)
    assert.ok(v2.length > 0, "no version-2 highlights for the recreated buffer")
    for (const event of v2) {
      for (const row of event[2]) {
        assert.equal(row.line, 0, "stale update highlights after dispose: " + JSON.stringify(event))
      }
    }
    await client.removeBuffer(1)
  } finally {
    await client.destroy()
  }
})

if (failures.length > 0) {
  console.error("FAILURES:\\n" + failures.join("\\n"))
  process.exit(1)
}
console.log("tree-sitter worker regressions passed")
`