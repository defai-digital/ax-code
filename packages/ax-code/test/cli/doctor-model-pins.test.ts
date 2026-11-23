import { expect, test } from "vitest"
import { getDoctorModelPinsCheck } from "../../src/cli/cmd/doctor/model-pins"
import type { ProviderLookup } from "../../src/cli/cmd/debug/routing"
import { Provider } from "../../src/provider/provider"

const providers: Record<string, { models: Record<string, unknown> }> = {
  gateway: { models: { "qwen3.8-max": {}, "glm-5.3": {} } },
  // `modelFamilyDefault` maps the bare family name "glm" onto zai/glm-5.3-flash.
  zai: { models: { "glm-5.3-flash": {} } },
}

const lookup: ProviderLookup = async (providerID) => {
  const provider = providers[providerID]
  return provider ? { status: "ready", models: provider.models } : { status: "missing" }
}

test("doctor model pins report ok when every configured pin resolves", async () => {
  const check = await getDoctorModelPinsCheck(
    {
      model: "gateway/qwen3.8-max",
      small_model: "gateway/glm-5.3",
      agent: { build: { model: "gateway/qwen3.8-max" } },
    },
    lookup,
  )
  expect(check).toEqual({
    name: "Model pins",
    status: "ok",
    detail: "All 3 configured model pins resolve",
  })
})

test("doctor model pins resolve a string pin with trailing spaces using the default parse", async () => {
  const check = await getDoctorModelPinsCheck({ small_model: "gateway/glm-5.3 " }, lookup)
  expect(check).toEqual({
    name: "Model pins",
    status: "ok",
    detail: "All 1 configured model pins resolve",
  })
})

test("doctor model pins report ok without any configured pin", async () => {
  const check = await getDoctorModelPinsCheck({}, lookup)
  expect(check).toMatchObject({ status: "ok", detail: "No model pins configured" })
})

test("doctor model pins warn about a pin on an unconfigured provider", async () => {
  const check = await getDoctorModelPinsCheck({ small_model: "deepseek/deepseek-chat" }, lookup)
  expect(check.name).toBe("Model pins")
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("small_model → deepseek/deepseek-chat (provider not configured)")
  expect(check.detail).toContain("falls back to the session model; complexity routing skipped")
  expect(check.detail).toContain("Use exact IDs from ax-code models")
})

test("doctor model pins warn about a model missing from a configured provider catalog", async () => {
  const check = await getDoctorModelPinsCheck({ wiki: { model: "gateway/no-such-model" } }, lookup)
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("wiki.model → gateway/no-such-model (model not in provider catalog)")
  expect(check.detail).toContain("fails when selected")
})

test("doctor model pins distinguish auxiliary from non-auxiliary consequences", async () => {
  const check = await getDoctorModelPinsCheck(
    {
      small_model: "deepseek/deepseek-chat",
      agent: {
        title: { model: "deepseek/deepseek-chat" },
        compaction: { model: "gateway/no-such-model" },
        build: { model: "gateway/no-such-model" },
      },
    },
    lookup,
  )
  expect(check.status).toBe("warn")
  expect(check.detail).toContain(
    "small_model → deepseek/deepseek-chat (provider not configured) — falls back to the session model; complexity routing skipped",
  )
  expect(check.detail).toContain(
    "agent.title.model → deepseek/deepseek-chat (provider not configured) — tries small_model, then the session model",
  )
  expect(check.detail).toContain(
    "agent.compaction.model → gateway/no-such-model (model not in provider catalog) — uses the session model",
  )
  expect(check.detail).toContain(
    "agent.build.model → gateway/no-such-model (model not in provider catalog) — fails when selected",
  )
})

test("doctor model pins cap the listed entries and summarize the rest", async () => {
  const check = await getDoctorModelPinsCheck(
    {
      small_model: "deepseek/deepseek-chat",
      llm_routing: {
        fallback: Array.from({ length: 10 }, (_, index) => ({ providerID: "deepseek", modelID: `m${index}` })),
      },
    },
    lookup,
  )
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("small_model → deepseek/deepseek-chat")
  expect(check.detail).toContain("llm_routing.fallback[6]")
  expect(check.detail).not.toContain("llm_routing.fallback[7]")
  expect(check.detail).toContain("+3 more")
})

test("doctor model pins degrade to a warning when the provider registry cannot load", async () => {
  const check = await getDoctorModelPinsCheck({ model: "gateway/qwen3.8-max" }, async () => {
    throw new Error("registry unavailable")
  })
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("unable to inspect model pins")
})

test("doctor model pins report an incomplete catalog instead of a stale pin", async () => {
  const check = await getDoctorModelPinsCheck({ small_model: "gateway/glm-5.3-unreleased" }, async () => ({
    status: "incomplete",
    models: { "glm-5.3": {} },
  }))
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("small_model → gateway/glm-5.3-unreleased (catalog unavailable)")
  expect(check.detail).toContain(
    "Some provider catalogs could not be loaded; rerun when those providers are reachable.",
  )
  expect(check.detail).not.toContain("remove stale pins")
})

test("doctor model pins report catalog unavailable when an incomplete provider is missing entirely", async () => {
  const check = await getDoctorModelPinsCheck({ small_model: "lan-box/m" }, async () => ({ status: "incomplete" }))
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("small_model → lan-box/m (catalog unavailable)")
})

test("doctor model pins report invalid model format when the runtime parse rejects the pin", async () => {
  const check = await getDoctorModelPinsCheck({ model: "gateway/qwen3.8-max" }, lookup, () => {
    throw new Error("invalid model format")
  })
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("model → gateway/qwen3.8-max (invalid model format)")
})

test("doctor model pins say an invalid-format pin fails when used", async () => {
  const check = await getDoctorModelPinsCheck({ small_model: "gateway/" }, lookup, (target) =>
    Provider.parseModel(target),
  )
  expect(check.status).toBe("warn")
  expect(check.detail).toContain(
    "small_model → gateway/ (invalid model format) — fails when used; fix the provider/model format",
  )
  expect(check.detail).toContain("Use exact IDs from ax-code models or remove stale pins.")
})

test("doctor model pins say an invalid-format planner pin is ignored for the default model", async () => {
  const check = await getDoctorModelPinsCheck({ experimental: { planner_architect_model: "gateway/" } }, lookup)
  expect(check.status).toBe("warn")
  expect(check.detail).toContain(
    "experimental.planner_architect_model → gateway/ (invalid model format) — ignored; the planner uses the default model",
  )
  expect(check.detail).toContain("Use exact IDs from ax-code models or remove stale pins.")
})

test("real Provider.parseModel resolves colon, trailing-space, and bare family pins", async () => {
  const check = await getDoctorModelPinsCheck(
    {
      model: "gateway:glm-5.3",
      small_model: "gateway/glm-5.3 ",
      wiki: { model: "glm" },
    },
    lookup,
    (target) => Provider.parseModel(target),
  )
  expect(check).toEqual({
    name: "Model pins",
    status: "ok",
    detail: "All 3 configured model pins resolve",
  })
})

test("doctor model pins report a blacklisted pin and its own advice", async () => {
  const check = await getDoctorModelPinsCheck({ small_model: "gateway/glm-5.3" }, async () => ({
    status: "ready",
    models: {},
    exclusion: () => "configured-blacklist",
  }))
  expect(check.status).toBe("warn")
  expect(check.detail).toContain(
    "small_model → gateway/glm-5.3 (excluded by provider blacklist) — falls back to the session model; complexity routing skipped",
  )
  expect(check.detail).toContain("Edit the provider blacklist/whitelist or change the pin.")
  expect(check.detail).not.toContain("Use exact IDs")
})

test("doctor model pins report a whitelist miss and its own advice", async () => {
  const check = await getDoctorModelPinsCheck({ model: "gateway/glm-5.3" }, async () => ({
    status: "ready",
    models: {},
    exclusion: () => "outside-configured-whitelist",
  }))
  expect(check.detail).toContain("model → gateway/glm-5.3 (excluded by provider whitelist)")
  expect(check.detail).toContain("Edit the provider blacklist/whitelist or change the pin.")
  expect(check.detail).not.toContain("AX_CODE_ENABLE_EXPERIMENTAL_MODELS")
})

test("doctor model pins mention the experimental flag only for experimental exclusions", async () => {
  const check = await getDoctorModelPinsCheck({ model: "gateway/glm-5.3" }, async () => ({
    status: "ready",
    models: {},
    exclusion: () => "experimental-model-disabled",
  }))
  expect(check.detail).toContain("model → gateway/glm-5.3 (excluded: experimental models disabled)")
  expect(check.detail).toContain(
    "Set AX_CODE_ENABLE_EXPERIMENTAL_MODELS=1 to allow experimental models, or change the pin.",
  )
  expect(check.detail).not.toContain("blacklist/whitelist")
})

test("doctor model pins report a deprecated registry exclusion", async () => {
  const check = await getDoctorModelPinsCheck({ model: "gateway/glm-5.3" }, async () => ({
    status: "ready",
    models: {},
    exclusion: () => "deprecated-model",
  }))
  expect(check.detail).toContain("model → gateway/glm-5.3 (excluded: deprecated model)")
  expect(check.detail).toContain("Pin a supported model instead.")
  expect(check.detail).not.toContain("blacklist/whitelist")
  expect(check.detail).not.toContain("AX_CODE_ENABLE_EXPERIMENTAL_MODELS")
})

test("doctor model pins order the stale-pin advice before the excluded advice", async () => {
  const check = await getDoctorModelPinsCheck(
    {
      model: "gateway/glm-5.3",
      small_model: "elsewhere/m",
    },
    async (providerID) =>
      providerID === "gateway"
        ? { status: "ready", models: {}, exclusion: () => "configured-blacklist" }
        : { status: "missing" },
  )
  const stale = check.detail.indexOf("Use exact IDs from ax-code models or remove stale pins.")
  const excluded = check.detail.indexOf("Edit the provider blacklist/whitelist or change the pin.")
  expect(stale).toBeGreaterThanOrEqual(0)
  expect(excluded).toBeGreaterThan(stale)
})
