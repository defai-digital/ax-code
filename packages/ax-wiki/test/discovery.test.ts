import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { readSourceEvidence } from "../src/discovery.js"
import { sha256 } from "../src/hash.js"
import type { WikiSource } from "../src/types.js"

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-discovery-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function sourceFor(relative: string, content: Buffer): WikiSource {
  return {
    path: relative,
    hash: sha256(content),
    bytes: content.byteLength,
    category: "documentation",
  }
}

describe("readSourceEvidence", () => {
  test("returns the full file when it fits the byte budget", async () => {
    const root = await fixture()
    const body = Buffer.from("hello wiki\n", "utf8")
    await writeFile(path.join(root, "README.md"), body)
    const [evidence] = await readSourceEvidence({
      root,
      sources: [sourceFor("README.md", body)],
      maxTotalBytes: 1000,
    })
    expect(evidence?.content).toBe("hello wiki\n")
    expect(evidence?.truncated).toBe(false)
  })

  test("clips to the byte budget on a UTF-8 character boundary", async () => {
    const root = await fixture()
    // "a" (1 byte) + grinning face (4 bytes) + "b" (1 byte)
    const body = Buffer.from("a😀b", "utf8")
    expect(body.byteLength).toBe(6)
    await writeFile(path.join(root, "note.md"), body)
    const [evidence] = await readSourceEvidence({
      root,
      sources: [sourceFor("note.md", body)],
      maxTotalBytes: 3,
    })
    expect(evidence?.content).toBe("a")
    expect(evidence?.content.includes("\uFFFD")).toBe(false)
    expect(evidence?.truncated).toBe(true)
  })

  test("keeps a complete multi-byte character that fits exactly", async () => {
    const root = await fixture()
    const body = Buffer.from("你好", "utf8")
    expect(body.byteLength).toBe(6)
    await writeFile(path.join(root, "note.md"), body)
    const [evidence] = await readSourceEvidence({
      root,
      sources: [sourceFor("note.md", body)],
      maxTotalBytes: 6,
    })
    expect(evidence?.content).toBe("你好")
    expect(evidence?.truncated).toBe(false)
  })
})
