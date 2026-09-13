import { afterEach, expect, test } from "vitest"
import { createRequire } from "node:module"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const { verifyEvidenceCache } = createRequire(import.meta.url)("./verify-evidence-cache.cjs") as {
  verifyEvidenceCache: (modulePath: string) => Promise<{ verified: boolean }>
}
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function fixture(mode: "missing" | "persistent" | "volatile" | "corrupt") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-evidence-verifier-"))
  directories.push(directory)
  const file = path.join(directory, "index.cjs")
  await fs.writeFile(
    file,
    `const mode = ${JSON.stringify(mode)};
    const values = new Map();
    if (mode !== 'missing') exports.openEvidenceStore = async () => ({
      put: async (key, value) => values.set(key, value),
      get: async key => mode === 'corrupt' ? 'wrong' : values.get(key),
      close: async () => { if (mode === 'volatile') values.clear(); }
    });`,
  )
  return file
}

test("release probe requires storage to survive reopening", async () => {
  expect(await verifyEvidenceCache(await fixture("persistent"))).toMatchObject({ verified: true })
  await expect(verifyEvidenceCache(await fixture("volatile"))).rejects.toThrow("did not survive")
})

test("release probe rejects missing capability and wrong bytes", async () => {
  await expect(verifyEvidenceCache(await fixture("missing"))).rejects.toThrow("support is missing")
  await expect(verifyEvidenceCache(await fixture("corrupt"))).rejects.toThrow("write/read mismatch")
})
