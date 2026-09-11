import { afterEach, expect, test, vi } from "vitest"
import { getAxEngineModelsCatalog } from "../../../src/provider/ax-engine/catalog"
import { prepareAxEngine } from "../../../src/provider/ax-engine/prepare"
import { startDownloadJob } from "../../../src/provider/ax-engine/download-job"
import {
  AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID,
  AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
} from "../../../src/provider/ax-engine/constants"
import type { AxEngineModelID } from "../../../src/provider/ax-engine/constants"
import { axEngineLocalRepository, selectAxEngineLocalModels } from "../../../src/provider/ax-engine/local-models"
import { axEngineHubCatalog, createHubCatalogStore } from "../../../src/provider/ax-engine/hub-catalog"
import { HubCatalog, hubModelID } from "../../../src/provider/ax-engine/hub-model"
import snapshot from "../../../src/provider/ax-engine/hub-catalog-snapshot.json"
import { axEngineLoader } from "../../../src/provider/ax-engine/provider-loader"
import { downloadModel } from "../../../src/provider/ax-engine/model-cache"
import { ModelsDev } from "../../../src/provider/models"
import { Provider } from "../../../src/provider/provider"
import { ProviderID } from "../../../src/provider/schema"
import { Instance } from "../../../src/project/instance"
import * as platform from "../../../src/provider/ax-engine/platform"
import { tmpdir } from "../../fixture/fixture"
import fs from "node:fs/promises"
import path from "node:path"

const repositories = [
  "AutomatosX/AX-Ornith-1.5-35B-A3B-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit",
]

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test("the managed model catalog offers exactly the three selected repositories", async () => {
  const result = await getAxEngineModelsCatalog()
  expect(result.models.map((model) => model.hfRepo)).toEqual(repositories)
  expect(result.models[0]).toMatchObject({
    quantization: "mlx",
    estimatedResources: true,
    verification: "unverified",
    contextTokens: 32_768,
    outputTokens: 8_192,
  })
  expect(result.models[0].id).toMatch(/^AutomatosX\/AX-Ornith-1\.5-35B-A3B-MLX-AXQ-6bit-MTP@[a-f0-9]{40}$/)
})

const excludedModels: AxEngineModelID[] = [
  AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID,
  `AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP@${"a".repeat(40)}`,
  `AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP@${"a".repeat(40)}`,
]

test.each(excludedModels)(
  "excluded preparation of %s stops before eligibility checks or persistence",
  async (modelID) => {
    const requireEligibility = vi.fn().mockRejectedValue(new Error("Eligibility must not be inspected"))
    await expect(prepareAxEngine({ modelID }, { requireEligibility })).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
    expect(requireEligibility).not.toHaveBeenCalled()
  },
)

test.each(excludedModels)("excluded download of %s stops before creating a background job", async (modelID) => {
  const requireEligibility = vi.fn().mockRejectedValue(new Error("Eligibility must not be inspected"))
  await expect(startDownloadJob({ modelID }, { requireEligibility })).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
  expect(requireEligibility).not.toHaveBeenCalled()
})

test.each(repositories)("selected repository %s passes preparation admission", async (repo) => {
  const model = HubCatalog.parse(snapshot).models.find((entry) => entry.id === repo)!
  const requireEligibility = vi.fn().mockRejectedValue(new Error("Selected model reached eligibility"))
  await expect(prepareAxEngine({ modelID: hubModelID(model) }, { requireEligibility })).rejects.toThrow(
    "Selected model reached eligibility",
  )
  expect(requireEligibility).toHaveBeenCalledOnce()
})

test("selected Ornith 35B reaches the pinned-download runtime version gate", async () => {
  const model = HubCatalog.parse(snapshot).models.find((entry) => entry.id === repositories[0])!
  await expect(
    downloadModel({ modelID: hubModelID(model), binaryPath: "/never-start", binaryVersion: "6.13.0" }),
  ).rejects.toThrow("AX_ENGINE_VERSION_UNSUPPORTED")
})

test.each([
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP",
  "AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-MXFP4-MTP",
  "AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Ornith-1.5-35B-A3B-MLX-AXQ-4bit-MTP",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit",
])("blocks direct downloading of excluded pack %s before metadata or subprocess work", async (repo) => {
  const resolve = vi.spyOn(axEngineHubCatalog, "resolve")
  await expect(
    downloadModel({ modelID: `${repo}@${"a".repeat(40)}` as AxEngineModelID, binaryPath: "/never-start" }),
  ).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
  expect(resolve).not.toHaveBeenCalled()
})

test("stale catalogs retain the selected bundled pack offline and deduplicate prepared revisions", async () => {
  await using tmp = await tmpdir()
  const catalog = HubCatalog.parse(snapshot)
  const ornith = catalog.models.find((model) => model.id === repositories[0])!
  const old = { ...ornith, sha: "a".repeat(40) }
  const cachePath = path.join(tmp.path, "catalog.json")
  await fs.writeFile(cachePath, JSON.stringify({ version: 1, fetchedAt: 1, models: [] }))
  const fetcher = vi.fn<typeof fetch>()
  const store = createHubCatalogStore({
    cachePath,
    artifactPath: (id) => path.join(tmp.path, encodeURIComponent(id)),
    bundled: { version: 1, fetchedAt: 2, models: [ornith] },
    pinnedModels: async () => [old],
    fetch: fetcher,
  })
  const view = await store.inspect()
  expect(view.source).toBe("cache")
  expect(selectAxEngineLocalModels(view.definitions, (model) => model.id).map((model) => model.id)).toEqual([
    hubModelID(ornith),
  ])
  expect((await store.resolve(hubModelID(ornith), { offline: true })).revision).toBe(ornith.sha)
  expect(fetcher).not.toHaveBeenCalled()
})

test("managed provider discovery replaces stale configured models with exactly three choices", async () => {
  vi.spyOn(platform, "isSupportedHost").mockResolvedValue(true)
  vi.stubEnv(
    "AX_CODE_CONFIG_CONTENT",
    JSON.stringify({
      enabled_providers: ["ax-engine"],
      provider: {
        "ax-engine": {
          options: { connectionMode: "managed" },
          models: {
            [AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID]: { name: "Removed model" },
            [`AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP@${"a".repeat(40)}`]: { name: "Removed 9B model" },
            [`${repositories[0]}@${"a".repeat(40)}`]: { name: "Old configured revision" },
            alternate: { id: AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID, name: "Duplicate alias" },
            [AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID]: {
              options: { modelID: AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID },
            },
          },
        },
      },
    }),
  )
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Provider.ready()
      const provider = (await Provider.list())[ProviderID.make("ax-engine")]
      expect(Object.keys(provider.models).map(axEngineLocalRepository)).toEqual(repositories)
      expect(Object.keys(provider.models)).not.toContain(`${repositories[0]}@${"a".repeat(40)}`)
      expect(provider.models[AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID].options.modelID).toBe(
        AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
      )
    },
  })
})

test.each(excludedModels)("managed activation cannot use excluded %s or a redirected target", async (modelID) => {
  const provider = Provider.fromModelsDevProvider((await ModelsDev.get())["ax-engine"])!
  provider.options = { connectionMode: "managed" }
  const loader = (await axEngineLoader()(provider))!
  const languageModel = vi.fn()
  await expect(loader.getModel!({ languageModel }, modelID)).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
  await expect(
    loader.getModel!({ languageModel }, AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID, {
      modelID,
    }),
  ).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
  expect(languageModel).not.toHaveBeenCalled()
})

test.each(["AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP", "AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP"])(
  "excluded %s metadata remains readable for status and cleanup",
  async (repo) => {
    const old = HubCatalog.parse(snapshot).models.find((model) => model.id === repo)!
    expect((await axEngineHubCatalog.resolve(hubModelID(old), { offline: true })).revision).toBe(old.sha)
  },
)
