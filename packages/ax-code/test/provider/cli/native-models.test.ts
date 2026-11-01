import { afterEach, describe, expect, test } from "vitest"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import {
  parseClaudeModelCatalog,
  parseCodexModelsCache,
  parseGrokModelsCache,
  parseMuseModelCatalog,
  readNativeCliModels,
} from "../../../src/provider/cli/native-models"

const originalTestHome = process.env.AX_CODE_TEST_HOME

afterEach(() => {
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

const museCatalog = {
  rows: [
    { model_id: "muse-spark-1.3", display_label: "muse-spark-1.3", visibility: "visible", context_limit: 1000000 },
    { model_id: "muse-spark-1.3-contributor", visibility: "hidden", context_limit: 1000000 },
    { model_id: "muse-image-1.0", visibility: "visible", context_limit: null },
    {
      model_id: "muse-wonder-1.0",
      display_label: "muse-wonder-1.0",
      visibility: "visible",
      is_default: true,
      context_limit: 1000000,
      output_limit: 128000,
    },
  ],
}

function claudeCatalog(fetchedAt: number, mainID: string) {
  return {
    fetchedAt,
    catalog: {
      config: {
        models: [
          {
            id: mainID,
            name: "Opus 5.5",
            section: "main",
            runtime: {
              max_input_tokens: 1000000,
              max_output_tokens: 128000,
              effort_levels: ["low", "max", "xhigh"],
              capabilities: ["mm_images"],
            },
          },
          { id: "claude-opus-4-6", name: "Opus 4.6", section: "overflow", runtime: { max_input_tokens: 1000000 } },
        ],
      },
    },
  }
}

describe("native CLI model caches", () => {
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

  test("muse keeps visible chat models with the default first", () => {
    expect(parseMuseModelCatalog(museCatalog).map((model) => model.id)).toEqual(["muse-wonder-1.0", "muse-spark-1.3"])
  })

  test("claude keeps only the main picker section", () => {
    expect(parseClaudeModelCatalog(claudeCatalog(1, "claude-opus-5-5"))).toEqual([
      {
        id: "claude-opus-5-5",
        name: "Opus 5.5",
        context: 1000000,
        output: 128000,
        image: true,
        efforts: ["low", "xhigh", "max"],
      },
    ])
  })

  test("claude reads the most recently fetched account catalog", async () => {
    await using tmp = await tmpdir()
    process.env.AX_CODE_TEST_HOME = tmp.path
    const dir = path.join(tmp.path, ".claude", "cache", "model-catalog")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "old-account-cc.json"), JSON.stringify(claudeCatalog(100, "claude-opus-5")))
    await writeFile(path.join(dir, "new-account-cc.json"), JSON.stringify(claudeCatalog(200, "claude-opus-5-5")))
    await writeFile(path.join(dir, "published-floor.json"), JSON.stringify({ version: 1 }))
    expect((await readNativeCliModels("claude-code")).map((model) => model.id)).toEqual(["claude-opus-5-5"])
  })

  test("malformed caches yield no models", () => {
    expect(parseClaudeModelCatalog({ catalog: { config: { models: {} } } })).toEqual([])
    expect(parseCodexModelsCache({ models: "nope" })).toEqual([])
    expect(parseGrokModelsCache({ models: [] })).toEqual([])
    expect(parseMuseModelCatalog({})).toEqual([])
  })

  test("reads each CLI's cache from its home directory", async () => {
    await using tmp = await tmpdir()
    process.env.AX_CODE_TEST_HOME = tmp.path
    await mkdir(path.join(tmp.path, ".codex"), { recursive: true })
    await mkdir(path.join(tmp.path, ".grok"), { recursive: true })
    await mkdir(path.join(tmp.path, ".local", "share", "muse", "model-catalog"), { recursive: true })
    await writeFile(path.join(tmp.path, ".codex", "models_cache.json"), JSON.stringify(codexCache))
    await writeFile(path.join(tmp.path, ".grok", "models_cache.json"), JSON.stringify(grokCache))
    await writeFile(
      path.join(tmp.path, ".local", "share", "muse", "model-catalog", "meta.json"),
      JSON.stringify(museCatalog),
    )

    expect((await readNativeCliModels("codex-cli")).map((model) => model.id)).toEqual(["gpt-6-astra", "gpt-5.6-sol"])
    expect((await readNativeCliModels("grok-build-cli")).map((model) => model.id)).toEqual(["grok-4.7", "grok-4.6"])
    expect((await readNativeCliModels("muse-cli")).map((model) => model.id)).toEqual([
      "muse-wonder-1.0",
      "muse-spark-1.3",
    ])
    expect(await readNativeCliModels("claude-code")).toEqual([])
  })

  test("missing or corrupt caches fall back to an empty list", async () => {
    await using tmp = await tmpdir()
    process.env.AX_CODE_TEST_HOME = tmp.path
    expect(await readNativeCliModels("codex-cli")).toEqual([])
    expect(await readNativeCliModels("muse-cli")).toEqual([])
    await mkdir(path.join(tmp.path, ".grok"), { recursive: true })
    await writeFile(path.join(tmp.path, ".grok", "models_cache.json"), "{not json")
    expect(await readNativeCliModels("grok-build-cli")).toEqual([])
  })
})
