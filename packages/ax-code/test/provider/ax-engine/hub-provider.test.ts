import { afterEach, expect, test, vi } from "vitest"
import { tmpdir } from "../../fixture/fixture"
import { Instance } from "../../../src/project/instance"
import { Provider } from "../../../src/provider/provider"
import { ProviderID, ModelID } from "../../../src/provider/schema"

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

test("rechecks AX Engine live capabilities even when its language adapter was cached", async () => {
  await using tmp = await tmpdir()
  vi.stubEnv(
    "AX_CODE_CONFIG_CONTENT",
    JSON.stringify({
      enabled_providers: ["ax-engine"],
      provider: {
        "ax-engine": { options: { connectionMode: "attach", baseURL: "http://127.0.0.1:31491/v1", apiKey: "local" } },
      },
    }),
  )
  let toolcall = true
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      if (String(url) !== "http://127.0.0.1:31491/v1/models") throw new Error(`Unexpected fetch: ${String(url)}`)
      return Response.json({
        data: [
          {
            id: "live-candidate",
            capabilities: { toolcall, input: { text: true }, output: { text: true } },
            limit: { context: 32768, output: 8192 },
          },
        ],
      })
    }),
  )
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Provider.ready()
      const model = await Provider.getModel(ProviderID.make("ax-engine"), ModelID.make("live-candidate"))
      await Provider.getLanguage(model)
      toolcall = false
      await expect(Provider.getLanguage(model)).rejects.toThrow("AX_ENGINE_TOOLCALL_UNSUPPORTED")
    },
  })
})
