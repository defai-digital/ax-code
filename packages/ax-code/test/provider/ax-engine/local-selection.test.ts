import { afterEach, expect, test, vi } from "vitest"
import { getAxEngineModelsCatalog } from "../../../src/provider/ax-engine/catalog"
import { prepareAxEngine } from "../../../src/provider/ax-engine/prepare"
import { startDownloadJob } from "../../../src/provider/ax-engine/download-job"
import {
  AX_ENGINE_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID,
  AX_ENGINE_CYBER_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID,
  AX_ENGINE_DEFAULT_MODEL_ID,
  AX_ENGINE_MODEL_DEFINITIONS,
  axEngineHubReference,
  AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID,
  AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID,
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

const repository = "AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP"
const cyberRepository = "AutomatosX/AX-Cyber-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP"
const selectedID = AX_ENGINE_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID
const selectedIDs = [selectedID, AX_ENGINE_CYBER_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID] as const

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test("the managed model catalog offers only Tiel Coder and Cyber-Tiel Coder MXFP4 MTP", async () => {
  const result = await getAxEngineModelsCatalog()
  expect(result.models.map((model) => model.hfRepo)).toEqual([repository, cyberRepository])
  expect(result.models).toHaveLength(2)
  expect(result.models[0]).toMatchObject({
    id: selectedID,
    quantization: "mlx",
    recommended: false,
    contextTokens: 32_768,
    outputTokens: 8_192,
    verification: "unverified",
  })
  expect(AX_ENGINE_DEFAULT_MODEL_ID).toBe(selectedID)
  expect(
    result.models.every((model) => [repository, cyberRepository].includes(axEngineLocalRepository(model.id)!)),
  ).toBe(true)
  expect(result.discovery.decisions.some((entry) => entry.repoID === "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit")).toBe(
    true,
  )
  expect(result.models.some((model) => model.hfRepo === "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit")).toBe(false)
})

const excludedRepositories = [
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP-copy",
  "AutomatosX/AX-Cyber-Tiel-Coder-35B-A3B-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-8bit",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-8bit-MTP",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-MXFP4",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-MXFP4-MTP",
  "AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-MXFP4-MTP",
  "AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Ornith-1.5-35B-A3B-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Qwen3-Coder-Next-MLX-AXQ-6bit",
  "AutomatosX/AX-Qwen3.8-Flash-Next-MLX-AXQ-6bit-MTP",
  "AutomatosX/AX-Qwen3.8-27B-MLX-6bit",
  "AutomatosX/AX-Qwen3.8-27B-MLX-OptiQ-4bit",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP-copy",
]

const excludedModels: AxEngineModelID[] = [
  AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
  AX_ENGINE_ORNITH_35B_AXQ_6BIT_MODEL_ID,
  AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID,
  ...excludedRepositories.map((repo) => `${repo}@${"a".repeat(40)}` as AxEngineModelID),
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

test("the selected Tiel MTP repository passes preparation admission", async () => {
  const model = HubCatalog.parse(snapshot).models.find((entry) => entry.id === repository)!
  const requireEligibility = vi.fn().mockRejectedValue(new Error("Selected model reached eligibility"))
  await expect(prepareAxEngine({ modelID: hubModelID(model) }, { requireEligibility })).rejects.toThrow(
    "Selected model reached eligibility",
  )
  expect(requireEligibility).toHaveBeenCalledOnce()
})

test("the selected Tiel MTP repository reaches the pinned-download runtime version gate", async () => {
  const model = HubCatalog.parse(snapshot).models.find((entry) => entry.id === repository)!
  await expect(
    downloadModel({ modelID: hubModelID(model), binaryPath: "/never-start", binaryVersion: "6.13.0" }),
  ).rejects.toThrow("AX_ENGINE_VERSION_UNSUPPORTED")
})

test.each(excludedRepositories)(
  "blocks direct downloading of excluded pack %s before metadata or subprocess work",
  async (repo) => {
    const resolve = vi.spyOn(axEngineHubCatalog, "resolve")
    await expect(
      downloadModel({ modelID: `${repo}@${"a".repeat(40)}` as AxEngineModelID, binaryPath: "/never-start" }),
    ).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
    expect(resolve).not.toHaveBeenCalled()
  },
)

test("stale catalogs retain the selected Tiel MTP repository offline and prefer the alias", async () => {
  await using tmp = await tmpdir()
  const catalog = HubCatalog.parse(snapshot)
  const qwen = catalog.models.find((model) => model.id === repository)!
  const old = { ...qwen, sha: "a".repeat(40) }
  const cachePath = path.join(tmp.path, "catalog.json")
  await fs.writeFile(cachePath, JSON.stringify({ version: 1, fetchedAt: 1, models: [] }))
  const fetcher = vi.fn<typeof fetch>()
  const store = createHubCatalogStore({
    cachePath,
    artifactPath: (id) => path.join(tmp.path, encodeURIComponent(id)),
    bundled: { version: 1, fetchedAt: 2, models: [qwen] },
    pinnedModels: async () => [old],
    fetch: fetcher,
  })
  const view = await store.inspect()
  expect(view.source).toBe("cache")
  expect(view.decisions.some((entry) => entry.repoID === repository)).toBe(true)
  expect(
    selectAxEngineLocalModels([{ id: selectedID }, ...view.definitions], (model) => model.id).map((model) => model.id),
  ).toEqual([selectedID])
  expect((await store.resolve(hubModelID(qwen), { offline: true })).revision).toBe(qwen.sha)
  expect(fetcher).not.toHaveBeenCalled()
})

test("managed provider discovery replaces stale configured models with only Tiel Coder and Cyber-Tiel Coder MXFP4 MTP", async () => {
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
            [AX_ENGINE_QWEN3_CODER_NEXT_AXQ_6BIT_MODEL_ID]: { name: "Removed Coder model" },
            [`AutomatosX/AX-Ornith-1.5-35B-A3B-MLX-AXQ-6bit-MTP@${"a".repeat(40)}`]: { name: "Removed 35B model" },
            [`AutomatosX/AX-Ornith-1.5-9B-MLX-AXQ-6bit-MTP@${"a".repeat(40)}`]: { name: "Removed 9B model" },
            [`AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP@${"a".repeat(40)}`]: { name: "Removed 4-bit MTP variant" },
            [`${repository}@${"a".repeat(40)}`]: { name: "Old configured revision" },
            alternate: { id: selectedID, name: "Duplicate alias" },
            [selectedID]: {
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
      expect(Object.keys(provider.models).map(axEngineLocalRepository)).toEqual([repository, cyberRepository])
      expect(Object.keys(provider.models)).toEqual(selectedIDs)
      expect(Object.keys(provider.models)).not.toContain(`${repository}@${"a".repeat(40)}`)
      expect(provider.models[selectedID].options.modelID).toBe(selectedID)
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
    loader.getModel!({ languageModel }, selectedID, {
      modelID,
    }),
  ).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
  expect(languageModel).not.toHaveBeenCalled()
})

test.each(excludedRepositories.filter((repo) => snapshot.models.some((model) => model.id === repo)).slice(0, 4))(
  "excluded %s metadata remains readable for status and cleanup",
  async (repo) => {
    const old = HubCatalog.parse(snapshot).models.find((model) => model.id === repo)!
    expect((await axEngineHubCatalog.resolve(hubModelID(old), { offline: true })).revision).toBe(old.sha)
  },
)

test.each([
  "OtherPublisher/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP@" + "a".repeat(40),
  "AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP@main",
  "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP",
])("rejects untrusted or unpinned selection %s", async (modelID) => {
  expect(axEngineLocalRepository(modelID)).toBeUndefined()
  const requireEligibility = vi.fn()
  await expect(prepareAxEngine({ modelID: modelID as AxEngineModelID }, { requireEligibility })).rejects.toThrow()
  expect(requireEligibility).not.toHaveBeenCalled()
})

test.each(selectedIDs)("pinned alias %s preserves repository, revision and package files", async (id) => {
  const definition = AX_ENGINE_MODEL_DEFINITIONS[id]
  expect(axEngineHubReference(id)).toEqual({
    repoID: definition.quantizations.mlx!.hfRepo,
    revision: definition.revision,
  })
  expect(definition.artifactFiles).toEqual(
    expect.arrayContaining(["mtp.safetensors", "mtplx_runtime.json", "chat_template.jinja"]),
  )
  const requireEligibility = vi.fn().mockRejectedValue(new Error("Selected alias reached eligibility"))
  await expect(prepareAxEngine({ modelID: id }, { requireEligibility })).rejects.toThrow(
    "Selected alias reached eligibility",
  )
  await expect(downloadModel({ modelID: id, binaryPath: "/never-start", binaryVersion: "6.13.0" })).rejects.toThrow(
    "AX_ENGINE_VERSION_UNSUPPORTED",
  )
})
