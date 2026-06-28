import { describe, test, expect } from "vitest"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import { readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"

const packageRoot = path.join(import.meta.dirname, "../..")
const updateModelsScript = path.join(packageRoot, "script/update-models.ts")

function runUpdateModels(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", updateModelsScript], {
    env,
    cwd: packageRoot,
  })
}

describe("update-models script", () => {
  test("fetches models and writes snapshot", async () => {
    await using tmp = await tmpdir()
    const { fixturePath, snapshotPath } = await createModelsFixture(tmp.path)

    const result = runUpdateModels({
      ...process.env,
      AX_CODE_MODELS_FIXTURE_PATH: fixturePath,
      AX_CODE_MODELS_SNAPSHOT_PATH: snapshotPath,
    })

    const stdout = result.output?.[1]?.toString()
    expect(result.status).toBe(0)
    expect(stdout).toContain("Fetching models from")
    // Either "Updated" or "already up to date" — both are valid
    expect(stdout).toMatch(/Updated|already up to date/)
    expect(JSON.parse(await readFile(snapshotPath, "utf-8"))).toHaveProperty("anthropic")
  })

  test("snapshot file is valid JSON with provider entries", async () => {
    const snapshotPath = path.join(import.meta.dirname, "../../src/provider/models-snapshot.json")
    const data = JSON.parse(await readFile(snapshotPath, "utf-8"))

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
    const snapshotPath = path.join(import.meta.dirname, "../../src/provider/models-snapshot.json")
    const data = JSON.parse(await readFile(snapshotPath, "utf-8"))

    // CLI providers should be preserved from the existing snapshot and keep
    // image capability metadata aligned with the CLI attachment adapter.
    const cliProviders = ["claude-code", "gemini-cli", "codex-cli", "grok-build-cli", "qoder-cli", "antigravity-cli"]
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
    await writeFile(
      snapshotPath,
      JSON.stringify(
        Object.fromEntries(
          ["claude-code", "gemini-cli", "codex-cli", "grok-build-cli", "qoder-cli", "antigravity-cli"].map((id) => [
            id,
            staleCliProvider(id),
          ]),
        ),
      ),
    )

    const result = runUpdateModels({
      ...process.env,
      AX_CODE_MODELS_FIXTURE_PATH: fixturePath,
      AX_CODE_MODELS_SNAPSHOT_PATH: snapshotPath,
    })

    expect(result.status).toBe(0)
    const data = JSON.parse(await readFile(snapshotPath, "utf-8"))
    for (const id of ["claude-code", "gemini-cli", "codex-cli", "grok-build-cli", "qoder-cli", "antigravity-cli"]) {
      const model = data[id]?.models?.[id]
      expect(model?.attachment).toBe(true)
      expect(model?.modalities?.input).toEqual(expect.arrayContaining(["text", "image"]))
    }
  })

  test("preserves Grok API and CLI plan entries", async () => {
    const snapshotPath = path.join(import.meta.dirname, "../../src/provider/models-snapshot.json")
    const data = JSON.parse(await readFile(snapshotPath, "utf-8"))

    expect(data.xai?.name).toBe("Grok Cloud API")
    expect(data.xai?.models?.["grok-build-0.1"]?.id).toBe("grok-build-0.1")
    expect(data.groq?.name).toBe("GroqCloud")
    expect(data.groq?.env).toEqual(["GROQ_API_KEY"])
    expect(data.groq?.api).toBe("https://api.groq.com/openai/v1")
    expect(data.groq?.npm).toBe("@ai-sdk/openai-compatible")
    expect(data.groq?.models?.["qwen/qwen3.6-27b"]?.limit).toEqual({ context: 131_072, output: 32_768 })
    expect(data.groq?.models?.["qwen/qwen3.6-27b"]?.modalities?.input).toEqual(["text", "image"])
    expect(data.groq?.models?.["openai/gpt-oss-120b"]?.limit).toEqual({ context: 131_072, output: 65_536 })
    expect(data.groq?.models?.["openai/gpt-oss-120b"]?.tool_call).toBe(true)
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
    await writeFile(
      snapshotPath,
      JSON.stringify({
        ollama: localProvider("ollama", "Ollama", "OLLAMA_HOST", "http://wrong-host/v1"),
        "ax-studio": localProvider("ax-studio", "AX Studio", "AX_STUDIO_HOST", "http://localhost:11434/v1"),
      }),
    )

    const result = runUpdateModels({
      ...process.env,
      AX_CODE_MODELS_FIXTURE_PATH: fixturePath,
      AX_CODE_MODELS_SNAPSHOT_PATH: snapshotPath,
    })

    expect(result.status).toBe(0)
    const data = JSON.parse(await readFile(snapshotPath, "utf-8"))
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

    runUpdateModels(env)
    const before = await readFile(snapshotPath, "utf-8")

    const result = runUpdateModels(env)

    expect(result.status).toBe(0)
    const stdout = result.output?.[1]?.toString()
    expect(stdout).toContain("already up to date")

    const after = await readFile(snapshotPath, "utf-8")
    expect(after).toBe(before)
  })

  test("handles network failure gracefully", async () => {
    const result = runUpdateModels({
      ...process.env,
      AX_CODE_MODELS_URL: "http://localhost:19999", // unreachable
    })

    // Should exit 0 (not block commits) even on network failure
    expect(result.status).toBe(0)
    const stderr = result.output?.[2]?.toString()
    expect(stderr).toContain("Failed to fetch models")
  })
})

async function createModelsFixture(dir: string) {
  const fixturePath = path.join(dir, "models-fixture.json")
  const snapshotPath = path.join(dir, "models-snapshot.json")
  await writeFile(
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
  await writeFile(snapshotPath, "{}\n")
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
