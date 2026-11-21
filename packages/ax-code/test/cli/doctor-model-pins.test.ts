import { expect, test } from "vitest"
import { getDoctorModelPinsCheck } from "../../src/cli/cmd/doctor/model-pins"

const providers: Record<string, { models: Record<string, unknown> }> = {
  gateway: { models: { "qwen3.8-max": {}, "glm-5.3": {} } },
}

const lookup = async (providerID: string) => providers[providerID]

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

test("doctor model pins report ok without any configured pin", async () => {
  const check = await getDoctorModelPinsCheck({}, lookup)
  expect(check).toMatchObject({ status: "ok", detail: "No model pins configured" })
})

test("doctor model pins warn about a pin on an unconfigured provider", async () => {
  const check = await getDoctorModelPinsCheck({ small_model: "deepseek/deepseek-chat" }, lookup)
  expect(check.name).toBe("Model pins")
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("small_model → deepseek/deepseek-chat (provider not configured)")
  expect(check.detail).toContain("fall back to the session model")
})

test("doctor model pins warn about a model missing from a configured provider catalog", async () => {
  const check = await getDoctorModelPinsCheck({ wiki: { model: "gateway/no-such-model" } }, lookup)
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("wiki.model → gateway/no-such-model (model not in provider catalog)")
  expect(check.detail).toContain("fail when selected; update or remove them")
})

test("doctor model pins distinguish auxiliary from non-auxiliary consequences", async () => {
  const check = await getDoctorModelPinsCheck(
    {
      small_model: "deepseek/deepseek-chat",
      agent: { title: { model: "deepseek/deepseek-chat" }, build: { model: "gateway/no-such-model" } },
    },
    lookup,
  )
  expect(check.status).toBe("warn")
  const entries = check.detail.split(" | ")
  expect(entries).toEqual([
    "small_model → deepseek/deepseek-chat (provider not configured) — fall back to the session model",
    "agent.title.model → deepseek/deepseek-chat (provider not configured) — fall back to the session model",
    "agent.build.model → gateway/no-such-model (model not in provider catalog) — fail when selected; update or remove them",
  ])
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
  expect(check.detail.endsWith("+3 more")).toBe(true)
})

test("doctor model pins degrade to a warning when the provider registry cannot load", async () => {
  const check = await getDoctorModelPinsCheck({ model: "gateway/qwen3.8-max" }, async () => {
    throw new Error("registry unavailable")
  })
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("unable to inspect model pins")
})
