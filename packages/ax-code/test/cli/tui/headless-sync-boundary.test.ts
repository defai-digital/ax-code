import { describe, expect, test } from "vitest"
import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"

const tuiSourceRoot = path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui")

const legacyLiveSyncModules = [
  "context/sync-event-router.ts",
  "context/sync-message-event.ts",
  "context/sync-request-event.ts",
  "context/sync-session-event.ts",
  "context/sync-runtime-event.ts",
  "context/sync-event-dispatch.ts",
  "context/sync-event-store.ts",
  "context/sync-request-decision.ts",
]

describe("tui headless sync boundary", () => {
  test("keeps removed legacy live sync handlers out of the production source tree", async () => {
    for (const module of legacyLiveSyncModules) {
      expect(await exists(path.join(tuiSourceRoot, module))).toBe(false)
    }
  })

  test("does not import removed legacy live sync handlers from TUI source", async () => {
    const files = await sourceFiles(tuiSourceRoot)
    const legacyModuleNames = legacyLiveSyncModules.map((module) => path.basename(module, ".ts"))

    for (const file of files) {
      const content = await readFile(file, "utf8")
      for (const legacyModule of legacyModuleNames) {
        expect(content).not.toContain(`"${legacyModule}"`)
        expect(content).not.toContain(`'${legacyModule}'`)
        expect(content).not.toContain(`/${legacyModule}`)
      }
    }
  })
})

async function exists(file: string) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(fullPath)))
      continue
    }
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath)
    }
  }

  return files
}
