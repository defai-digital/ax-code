import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import {
  parseCodexModelsCache,
  parseGrokModelsCache,
  readNativeCliModels,
} from "../../../src/provider/cli/native-models"

const originalTestHome = process.env.AX_CODE_TEST_HOME

afterEach(() => {
  vi.unstubAllEnvs()
  if (originalTestHome === undefined) delete process.env.AX_CODE_TEST_HOME
  else process.env.AX_CODE_TEST_HOME = originalTestHome
})

const codexCache = {
  models: [
    { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list", priority: 6, context_window: 272000 },
    { slug: "gpt-reserve", display_name: "Reserve", visibility: "hide", priority: 4 },
    {
      slug: "gpt-6-astra",
      display_name: "GPT-6-Astra",
      visibility: "list",
      priority: 2,
      context_window: 272000,
      input_modalities: ["text", "image"],
      supported_reasoning_levels: [{ effort: "max" }, { effort: "low" }, { effort: 'bad value"' }, { effort: "high" }],
    },
  ],
}

const grokCache = {
  models: {
    "grok-4.7": {
      info: {
        id: "grok-4.7",
        name: "Grok 4.7",
        hidden: false,
        context_window: 256000,
        supports_reasoning_effort: true,
        reasoning_efforts: [{ value: "xhigh" }, { value: "high" }, { value: "low" }],
      },
    },
    "grok-internal": { info: { id: "grok-internal", name: "Internal", hidden: true } },
    "grok-4.6": { info: { id: "grok-4.6", name: "Grok 4.6", context_window: 256000, max_completion_tokens: 64000 } },
  },
}

describe("native CLI model caches", () => {
  test.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "returns no models for inherited provider name %s",
    async (providerID) => {
      expect(await readNativeCliModels(providerID)).toEqual([])
    },
  )

  test("codex priority zero sorts before positive priorities", () => {
    const models = parseCodexModelsCache({
      models: [
        { slug: "second", visibility: "list", priority: 1 },
        { slug: "first", visibility: "list", priority: 0 },
        { slug: "unranked", visibility: "list" },
      ],
    })
    expect(models.map((model) => model.id)).toEqual(["first", "second", "unranked"])
  })

  test("codex keeps only picker-visible models in priority order", () => {
    expect(parseCodexModelsCache(codexCache)).toEqual([
      { id: "gpt-6-astra", name: "GPT-6-Astra", context: 272000, image: true, efforts: ["low", "high", "max"] },
      { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", context: 272000, image: false },
    ])
  })

  test("grok drops hidden models", () => {
    expect(parseGrokModelsCache(grokCache)).toEqual([
      { id: "grok-4.7", name: "Grok 4.7", context: 256000, output: undefined, efforts: ["low", "high", "xhigh"] },
      { id: "grok-4.6", name: "Grok 4.6", context: 256000, output: 64000 },
    ])
  })

  test("malformed caches yield no models", () => {
    expect(parseCodexModelsCache({ models: "nope" })).toEqual([])
    expect(parseGrokModelsCache({ models: [] })).toEqual([])
  })

  test("reads each CLI's cache from its home directory", async () => {
    await using tmp = await tmpdir()
    process.env.AX_CODE_TEST_HOME = tmp.path
    vi.stubEnv("CODEX_HOME", path.join(tmp.path, "other-codex"))
    await mkdir(path.join(tmp.path, ".codex"), { recursive: true })
    await mkdir(path.join(tmp.path, "other-codex"))
    await mkdir(path.join(tmp.path, ".grok"), { recursive: true })
    await writeFile(path.join(tmp.path, ".codex", "models_cache.json"), JSON.stringify(codexCache))
    await writeFile(path.join(tmp.path, "other-codex", "models_cache.json"), JSON.stringify({ models: [] }))
    await writeFile(path.join(tmp.path, ".grok", "models_cache.json"), JSON.stringify(grokCache))

    expect((await readNativeCliModels("codex-cli")).map((model) => model.id)).toEqual(["gpt-6-astra", "gpt-5.6-sol"])
    expect((await readNativeCliModels("grok-build-cli")).map((model) => model.id)).toEqual(["grok-4.7", "grok-4.6"])
    // Retired closed-source CLIs have no cache reader.
    expect(await readNativeCliModels("claude-code")).toEqual([])
    expect(await readNativeCliModels("muse-cli")).toEqual([])
  })

  test("missing or corrupt caches fall back to an empty list", async () => {
    await using tmp = await tmpdir()
    process.env.AX_CODE_TEST_HOME = tmp.path
    expect(await readNativeCliModels("codex-cli")).toEqual([])
    await mkdir(path.join(tmp.path, ".grok"), { recursive: true })
    await writeFile(path.join(tmp.path, ".grok", "models_cache.json"), "{not json")
    expect(await readNativeCliModels("grok-build-cli")).toEqual([])
  })

  test("reads the Codex cache from CODEX_HOME", async () => {
    await using tmp = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", undefined)
    vi.stubEnv("CODEX_HOME", tmp.path)
    await writeFile(path.join(tmp.path, "models_cache.json"), JSON.stringify(codexCache))

    expect((await readNativeCliModels("codex-cli")).map((model) => model.id)).toEqual(["gpt-6-astra", "gpt-5.6-sol"])
  })
})
