import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Bus } from "../../src/bus"
import { NotificationEvent } from "../../src/notification/events"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { AuxiliaryModel } from "../../src/session/auxiliary-model"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const model = { name: "M", tool_call: true, limit: { context: 128000, output: 4096 } }
const providers = {
  "remote-gw": {
    npm: "@ai-sdk/openai-compatible",
    options: { apiKey: "test-key", baseURL: "https://api.example.com/v1" },
    models: { big: model, small: model },
  },
  "lan-box": {
    npm: "@ai-sdk/openai-compatible",
    options: { apiKey: "test-key", baseURL: "http://192.168.1.50:11434/v1" },
    models: { m: model },
  },
}
const remote = ProviderID.make("remote-gw")
const local = ProviderID.make("lan-box")
const primary = { providerID: remote, modelID: ModelID.make("big") }
const localPrimary = { providerID: local, modelID: ModelID.make("m") }

async function withConfig(config: Record<string, unknown>, fn: () => Promise<void>): Promise<void> {
  await using tmp = await tmpdir({ config: { provider: providers, ...config } })
  await Instance.provide({ directory: tmp.path, fn })
}

beforeEach(() => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("AuxiliaryModel.resolve", () => {
  test("uses an available small_model", async () => {
    await withConfig({ small_model: "remote-gw/small" }, async () => {
      const result = await AuxiliaryModel.resolve({ purpose: "title", anchor: remote, primary, smallModel: true })
      expect(result.source).toBe("small_model")
      expect(String(result.model?.id)).toBe("small")
      expect(result.degraded).toEqual([])
    })
  })

  test("an unavailable small_model degrades to the session primary and warns once", async () => {
    await withConfig({ small_model: "deepseek/deepseek-v4-flash" }, async () => {
      const toast = vi.spyOn(Bus, "publishDetached")
      const first = await AuxiliaryModel.resolve({ purpose: "recap", anchor: remote, primary, smallModel: true })
      expect(first.source).toBe("primary")
      expect(String(first.model?.id)).toBe("big")
      expect(first.degraded).toEqual([
        { configKey: "small_model", target: "deepseek/deepseek-v4-flash", reason: "unavailable" },
      ])
      const second = await AuxiliaryModel.resolve({ purpose: "recap", anchor: remote, primary, smallModel: true })
      expect(second.source).toBe("primary")
      const notices = toast.mock.calls
        .map((call) => call[1] as { title?: string; message: string; variant: string })
        .filter((payload) => payload?.title === "Auxiliary model unavailable")
      expect(notices).toHaveLength(1)
      const payload = notices[0]!
      expect(payload.variant).toBe("warning")
      expect(payload.message).toContain("small_model")
      expect(payload.message).toContain("remote-gw/big")
    })
  })

  test("warns each project independently about the same unavailable target", async () => {
    const toast = vi.spyOn(Bus, "publishDetached")
    const config = { small_model: "missing/gone" }
    for (const expectedCount of [1, 2]) {
      await withConfig(config, async () => {
        await AuxiliaryModel.resolve({ purpose: "recap", anchor: remote, primary, smallModel: true })
      })
      const warnings = toast.mock.calls.filter(([event]) => event === NotificationEvent.ToastShow)
      expect(warnings).toHaveLength(expectedCount)
    }
  })

  test("without a primary an unavailable small_model skips the work", async () => {
    await withConfig({ small_model: "deepseek/deepseek-v4-flash" }, async () => {
      const result = await AuxiliaryModel.resolve({ purpose: "classify", anchor: remote, smallModel: true })
      expect(result.source).toBe("none")
      expect(result.model).toBeUndefined()
      expect(result.degraded).toHaveLength(1)
    })
  })

  test("an unavailable purpose pin falls through to small_model", async () => {
    await withConfig({ small_model: "remote-gw/small" }, async () => {
      const result = await AuxiliaryModel.resolve({
        purpose: "title",
        anchor: remote,
        primary,
        pin: {
          configKey: "agent.title.model",
          model: { providerID: ProviderID.make("missing"), modelID: ModelID.make("x") },
        },
        smallModel: true,
      })
      expect(result.source).toBe("small_model")
      expect(result.degraded).toEqual([{ configKey: "agent.title.model", target: "missing/x", reason: "unavailable" }])
    })
  })

  test("a purpose that does not use small_model ignores it", async () => {
    await withConfig({ small_model: "remote-gw/small" }, async () => {
      const result = await AuxiliaryModel.resolve({ purpose: "compaction", anchor: remote, primary, smallModel: false })
      expect(result.source).toBe("primary")
      expect(String(result.model?.id)).toBe("big")
      expect(result.degraded).toEqual([])
    })
  })

  test("a local session never resolves a remote auxiliary target", async () => {
    await withConfig({ small_model: "remote-gw/small" }, async () => {
      const result = await AuxiliaryModel.resolve({
        purpose: "title",
        anchor: local,
        primary: localPrimary,
        smallModel: true,
      })
      expect(result.source).toBe("primary")
      expect(String(result.model?.providerID)).toBe("lan-box")
      expect(result.degraded).toEqual([{ configKey: "small_model", target: "remote-gw/small", reason: "local_route" }])
    })
  })

  test("an unavailable primary still fails", async () => {
    await withConfig({}, async () => {
      await expect(
        AuxiliaryModel.resolve({
          purpose: "compaction",
          anchor: remote,
          primary: { providerID: remote, modelID: ModelID.make("gone") },
          smallModel: false,
        }),
      ).rejects.toSatisfy((error: unknown) => Provider.ModelNotFoundError.isInstance(error))
    })
  })
})
