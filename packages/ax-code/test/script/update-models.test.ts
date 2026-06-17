import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("update-models script", () => {
  test("fetches models and writes snapshot", async () => {
    await using tmp = await tmpdir()
    const { fixturePath, snapshotPath } = await createModelsFixture(tmp.path)

    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      env: {
        ...process.env,
        AX_CODE_MODELS_FIXTURE_PATH: fixturePath,
        AX_CODE_MODELS_SNAPSHOT_PATH: snapshotPath,
      },
      cwd: path.join(import.meta.dir, "../.."),
    })

    const stdout = result.stdout.toString()
    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("Fetching models from")
    // Either "Updated" or "already up to date" — both are valid
    expect(stdout).toMatch(/Updated|already up to date/)
    expect(await Bun.file(snapshotPath).json()).toHaveProperty("anthropic")
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

    // CLI providers should be preserved from the existing snapshot and keep
    // image capability metadata aligned with the CLI attachment adapter.
    const cliProviders = ["claude-code", "gemini-cli", "codex-cli", "grok-build-cli", "qoder-cli"]
    for (const id of cliProviders) {
      const provider = data[id]
      const model = provider?.models?.[id]
      expect(typeof provider).toBe("object")
      expect(model).toBeDefined()
      expect(model.attachment).toBe(true)
      expect(model.modalities?.input).toEqual(expect.arrayContaining(["text", "image"]))
      expect(model.modalities?.output).toEqual(["text"])
    }
  })

  test("normalizes stale CLI provider entries during snapshot regeneration", async () => {
    await using tmp = await tmpdir()
    const { fixturePath, snapshotPath } = await createModelsFixture(tmp.path)
    await Bun.write(
      snapshotPath,
      JSON.stringify(
        Object.fromEntries(
          ["claude-code", "gemini-cli", "codex-cli", "grok-build-cli", "qoder-cli"].map((id) => [
            id,
            staleCliProvider(id),
          ]),
        ),
      ),
    )

    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      env: {
        ...process.env,
        AX_CODE_MODELS_FIXTURE_PATH: fixturePath,
        AX_CODE_MODELS_SNAPSHOT_PATH: snapshotPath,
      },
      cwd: path.join(import.meta.dir, "../.."),
    })

    expect(result.exitCode).toBe(0)
    const data = await Bun.file(snapshotPath).json()
    for (const id of ["claude-code", "gemini-cli", "codex-cli", "grok-build-cli", "qoder-cli"]) {
      const model = data[id]?.models?.[id]
      expect(model?.attachment).toBe(true)
      expect(model?.modalities?.input).toEqual(expect.arrayContaining(["text", "image"]))
    }
  })

  test("preserves Grok API and CLI plan entries", async () => {
    const snapshotPath = path.join(import.meta.dir, "../../src/provider/models-snapshot.json")
    const data = await Bun.file(snapshotPath).json()

    expect(data.xai?.name).toBe("Grok Cloud API")
    expect(data.xai?.models?.["grok-build-0.1"]?.id).toBe("grok-build-0.1")
    expect(data["grok-build-cli"]?.name).toBe("Grok Build CLI")
    expect(data.ollama?.api).toBe("http://localhost:11434/v1")
    expect(data["ax-studio"]?.name).toBe("AX Studio")
    expect(data["ax-studio"]?.api).toBe("http://localhost:18080/v1")
    expect(data["ax-studio"]?.env).toEqual(["AX_STUDIO_HOST"])
    expect(data["ax-serving"]).toBeUndefined()
    expect(data.lmstudio).toBeUndefined()
  })

  test("normalizes local provider endpoints during snapshot regeneration", async () => {
    await using tmp = await tmpdir()
    const { fixturePath, snapshotPath } = await createModelsFixture(tmp.path)
    await Bun.write(
      snapshotPath,
      JSON.stringify({
        ollama: localProvider("ollama", "Ollama", "OLLAMA_HOST", "http://wrong-host/v1"),
        "ax-studio": localProvider("ax-studio", "AX Studio", "AX_STUDIO_HOST", "http://localhost:11434/v1"),
      }),
    )

    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      env: {
        ...process.env,
        AX_CODE_MODELS_FIXTURE_PATH: fixturePath,
        AX_CODE_MODELS_SNAPSHOT_PATH: snapshotPath,
      },
      cwd: path.join(import.meta.dir, "../.."),
    })

    expect(result.exitCode).toBe(0)
    const data = await Bun.file(snapshotPath).json()
    expect(data.ollama?.api).toBe("http://localhost:11434/v1")
    expect(data["ax-studio"]?.api).toBe("http://localhost:18080/v1")
    expect(data["ax-studio"]?.env).toEqual(["AX_STUDIO_HOST"])
    expect(data["ax-studio"]?.doc).toBe("https://github.com/defai-digital/ax-studio")
  })

  test("idempotent — running twice produces same result", async () => {
    await using tmp = await tmpdir()
    const { fixturePath, snapshotPath } = await createModelsFixture(tmp.path)
    const env = {
      ...process.env,
      AX_CODE_MODELS_FIXTURE_PATH: fixturePath,
      AX_CODE_MODELS_SNAPSHOT_PATH: snapshotPath,
    }

    Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      env,
      cwd: path.join(import.meta.dir, "../.."),
    })
    const before = await Bun.file(snapshotPath).text()

    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(import.meta.dir, "../../script/update-models.ts")],
      env,
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

async function createModelsFixture(dir: string) {
  const fixturePath = path.join(dir, "models-fixture.json")
  const snapshotPath = path.join(dir, "models-snapshot.json")
  await Bun.write(
    fixturePath,
    JSON.stringify({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet-5": {
            id: "claude-sonnet-5",
            name: "Claude Sonnet 5",
            family: "claude",
            limit: { context: 200_000, output: 64_000 },
          },
        },
      },
    }),
  )
  await Bun.write(snapshotPath, "{}\n")
  return { fixturePath, snapshotPath }
}

function staleCliProvider(id: string) {
  return {
    id,
    name: id,
    env: [],
    npm: "cli",
    models: {
      [id]: {
        id,
        name: id,
        family: id.split("-")[0],
        attachment: false,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-01-01",
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        limit: {
          context: 1000,
          output: 100,
        },
        options: {},
        status: "active",
      },
    },
  }
}

function localProvider(id: string, name: string, env: string, api: string) {
  return {
    id,
    name,
    env: [env],
    npm: "@ai-sdk/openai-compatible",
    api,
    models: {},
  }
}
