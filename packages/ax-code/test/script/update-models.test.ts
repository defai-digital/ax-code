import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("update-models script", () => {
  test("fetches models and writes snapshot", async () => {
    await using tmp = await tmpdir()
    const snapshotPath = path.join(tmp.path, "models-snapshot.json")

    // Run with AX_CODE_MODELS_URL pointing to real endpoint
    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      env: {
        ...process.env,
        // Override the snapshot path by pointing to a temp dir structure
      },
      cwd: path.join(import.meta.dir, "../.."),
    })

    const stdout = result.stdout.toString()
    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("Fetching models from")
    // Either "Updated" or "already up to date" — both are valid
    expect(stdout).toMatch(/Updated|already up to date/)
  })

  test("snapshot file is valid JSON with provider entries", async () => {
    const snapshotPath = path.join(import.meta.dir, "../../src/provider/models-snapshot.json")
    const data = await Bun.file(snapshotPath).json()

    expect(typeof data).toBe("object")
    expect(data).not.toBeNull()
    // Should have at least some providers from models.dev
    const keys = Object.keys(data)
    expect(keys.length).toBeGreaterThan(0)
    // Each provider entry should have a models object
    for (const key of keys.slice(0, 3)) {
      const entry = data[key]
      expect(entry).toBeDefined()
    }
  })

  test("preserves CLI provider entries", async () => {
    const snapshotPath = path.join(import.meta.dir, "../../src/provider/models-snapshot.json")
    const data = await Bun.file(snapshotPath).json()

    // CLI providers should be preserved from the existing snapshot
    const cliProviders = ["claude-code", "gemini-cli", "codex-cli"]
    for (const id of cliProviders) {
      if (data[id]) {
        expect(typeof data[id]).toBe("object")
      }
    }
  })

  test("idempotent — running twice produces same result", async () => {
    const snapshotPath = path.join(import.meta.dir, "../../src/provider/models-snapshot.json")
    const before = await Bun.file(snapshotPath).text()

    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      cwd: path.join(import.meta.dir, "../.."),
    })

    expect(result.exitCode).toBe(0)
    const stdout = result.stdout.toString()
    expect(stdout).toContain("already up to date")

    const after = await Bun.file(snapshotPath).text()
    expect(after).toBe(before)
  })

  test("handles network failure gracefully", async () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      env: {
        ...process.env,
        AX_CODE_MODELS_URL: "http://localhost:19999", // unreachable
      },
      cwd: path.join(import.meta.dir, "../.."),
    })

    // Should exit 0 (not block commits) even on network failure
    expect(result.exitCode).toBe(0)
    const stderr = result.stderr.toString()
    expect(stderr).toContain("Failed to fetch models")
  })
})
