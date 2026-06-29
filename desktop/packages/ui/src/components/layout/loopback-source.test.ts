import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const files = [
  "ContextPanel-impl.tsx",
  "Header.tsx",
  "ProjectActionsButton.tsx",
].map((file) => path.resolve(__dirname, file))

describe("layout loopback host guards", () => {
  test("use the shared loopback hostname helper", async () => {
    for (const file of files) {
      const source = await readFile(file, "utf8")

      expect(source).toContain("isLoopbackHostname")
      expect(source).not.toMatch(/host(?:name)?\s*===\s*["']127\.0\.0\.1["']/)
    }
  })
})
