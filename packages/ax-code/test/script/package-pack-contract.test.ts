import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

type ExportTarget = string | { types?: string; default?: string; import?: string; require?: string }

type Manifest = {
  name: string
  main?: string
  types?: string
  exports?: Record<string, ExportTarget>
  files?: string[]
  publishConfig?: {
    main?: string
    types?: string
    exports?: Record<string, ExportTarget>
  }
}

async function readManifest(relativePath: string) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8")) as Manifest
}

function exportTargets(target: ExportTarget | undefined) {
  if (!target) return []
  if (typeof target === "string") return [target]
  return [target.types, target.default, target.import, target.require].filter((item): item is string => Boolean(item))
}

describe("package pack contracts", () => {
  test("@ax-code/plugin exports packaged dist files", async () => {
    const manifest = await readManifest("packages/plugin/package.json")
    expect(manifest.name).toBe("@ax-code/plugin")
    expect(manifest.files).toContain("dist")
    expect(manifest.main).toBe("./dist/index.js")
    expect(manifest.types).toBe("./dist/index.d.ts")

    // The workspace package resolves dev consumers from TS source; npm publish
    // applies `publishConfig` so the published package exports compiled dist.
    const publishedExports = manifest.publishConfig?.exports ?? manifest.exports

    for (const target of Object.values(publishedExports ?? {})) {
      for (const file of exportTargets(target)) {
        expect(file).toStartWith("./dist/")
        expect(file).not.toStartWith("./src/")
        expect(file.endsWith(".ts") && !file.endsWith(".d.ts")).toBe(false)
      }
    }
  })
})
