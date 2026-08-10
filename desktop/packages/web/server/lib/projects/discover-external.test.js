import { describe, expect, it } from "vitest"
import {
  parseCodexProjectsToml,
  parseKimiWorkspacesJson,
  discoverExternalProjects,
} from "./discover-external.js"

describe("parseCodexProjectsToml", () => {
  it("extracts project paths and trust levels", () => {
    const text = `
model = "gpt"

[projects."/Users/alice/code/ax-code"]
trust_level = "trusted"

[projects."/Users/alice/code/other"]
trust_level = "untrusted"

[projects.'/Users/alice/code/quoted']
trust_level = "trusted"
`
    const result = parseCodexProjectsToml(text)
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: "/Users/alice/code/ax-code", source: "codex", trustLevel: "trusted" }),
        expect.objectContaining({ root: "/Users/alice/code/other", source: "codex", trustLevel: "untrusted" }),
        expect.objectContaining({ root: "/Users/alice/code/quoted", source: "codex" }),
      ]),
    )
  })

  it("returns empty for invalid input", () => {
    expect(parseCodexProjectsToml("")).toEqual([])
    expect(parseCodexProjectsToml(null)).toEqual([])
  })
})

describe("parseKimiWorkspacesJson", () => {
  it("extracts workspaces with last opened timestamps", () => {
    const text = JSON.stringify({
      version: 1,
      workspaces: {
        wd_a: {
          root: "/Users/alice/code/ax-engine",
          name: "ax-engine",
          last_opened_at: "2026-08-08T17:47:23.382Z",
        },
        wd_b: {
          root: "/Users/alice/code/ax-code",
          name: "ax-code",
        },
      },
    })
    const result = parseKimiWorkspacesJson(text)
    expect(result).toHaveLength(2)
    expect(result.find((entry) => entry.root.endsWith("ax-engine"))).toMatchObject({
      name: "ax-engine",
      source: "kimi",
      lastOpenedAt: Date.parse("2026-08-08T17:47:23.382Z"),
    })
  })

  it("returns empty for invalid JSON", () => {
    expect(parseKimiWorkspacesJson("{")).toEqual([])
    expect(parseKimiWorkspacesJson(null)).toEqual([])
  })
})

describe("discoverExternalProjects", () => {
  it("merges sources, marks existing, and filters by disk existence", async () => {
    const files = {
      "/home/alice/.codex/config.toml": `
[projects."/home/alice/code/ax-code"]
trust_level = "trusted"
[projects."/home/alice/missing"]
trust_level = "trusted"
`,
      "/home/alice/.kimi-code/workspaces.json": JSON.stringify({
        workspaces: {
          wd1: {
            root: "/home/alice/code/ax-code",
            name: "ax-code",
            last_opened_at: "2026-08-01T00:00:00.000Z",
          },
          wd2: {
            root: "/home/alice/code/ax-engine",
            name: "ax-engine",
            last_opened_at: "2026-08-08T00:00:00.000Z",
          },
        },
      }),
    }

    const existingDirs = new Set(["/home/alice/code/ax-code", "/home/alice/code/ax-engine"])

    const result = await discoverExternalProjects({
      homeDir: "/home/alice",
      existingPaths: ["/home/alice/code/ax-code"],
      readFile: async (filePath) => {
        if (!(filePath in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        return files[filePath]
      },
      exists: async (candidate) => existingDirs.has(candidate),
    })

    expect(result.sources.codex.found).toBe(true)
    expect(result.sources.kimi.found).toBe(true)

    const axCode = result.candidates.find((c) => c.root === "/home/alice/code/ax-code")
    expect(axCode).toMatchObject({
      alreadyImported: true,
      exists: true,
      source: "both",
    })

    const axEngine = result.candidates.find((c) => c.root === "/home/alice/code/ax-engine")
    expect(axEngine).toMatchObject({
      alreadyImported: false,
      exists: true,
      source: "kimi",
    })

    // missing path still listed but exists=false
    const missing = result.candidates.find((c) => c.root === "/home/alice/missing")
    expect(missing).toMatchObject({ exists: false, alreadyImported: false })

    // Importable existing dirs should sort before missing / already imported.
    expect(result.candidates[0].root).toBe("/home/alice/code/ax-engine")
  })
})
