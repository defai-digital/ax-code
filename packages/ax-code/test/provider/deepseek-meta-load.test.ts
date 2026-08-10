import { describe, expect, test } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"

describe("DeepSeek and Meta Muse Spark provider load", () => {
  test("loads deepseek and meta from env keys with models and base URLs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-ds-meta-"))
    const prevDs = process.env.DEEPSEEK_API_KEY
    const prevMeta = process.env.META_MODEL_API_KEY
    const prevModel = process.env.MODEL_API_KEY
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek"
    process.env.MODEL_API_KEY = "sk-test-meta"
    delete process.env.META_MODEL_API_KEY

    try {
      await Instance.provide({
        directory: dir,
        async fn() {
          await Provider.invalidate()
          const list = await Provider.list()

          expect(list[ProviderID.make("deepseek")]).toBeDefined()
          expect(list[ProviderID.make("meta")]).toBeDefined()

          const deepseek = list[ProviderID.make("deepseek")]!
          expect(deepseek.key).toBe("sk-test-deepseek")
          expect(deepseek.models["deepseek-v4-pro"]).toBeDefined()
          expect(deepseek.models["deepseek-v4-flash"]).toBeDefined()
          expect(deepseek.models["deepseek-v4-pro"]!.api.npm).toBe("@ai-sdk/openai-compatible")
          expect(deepseek.models["deepseek-v4-pro"]!.api.url).toMatch(/api\.deepseek\.com/)

          const meta = list[ProviderID.make("meta")]!
          expect(meta.key).toBe("sk-test-meta")
          expect(meta.models["muse-spark-1.2"]).toBeDefined()
          expect(meta.models["muse-spark-1.2"]!.api.npm).toBe("@ai-sdk/openai")
          expect(meta.models["muse-spark-1.2"]!.api.url).toMatch(/api\.meta\.ai/)

          // getModel should resolve without throw
          const dsModel = await Provider.getModel(ProviderID.make("deepseek"), ModelID.make("deepseek-v4-pro"))
          expect(dsModel.id).toBe("deepseek-v4-pro")
          const metaModel = await Provider.getModel(ProviderID.make("meta"), ModelID.make("muse-spark-1.2"))
          expect(metaModel.id).toBe("muse-spark-1.2")
        },
      })
    } finally {
      if (prevDs === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = prevDs
      if (prevMeta === undefined) delete process.env.META_MODEL_API_KEY
      else process.env.META_MODEL_API_KEY = prevMeta
      if (prevModel === undefined) delete process.env.MODEL_API_KEY
      else process.env.MODEL_API_KEY = prevModel
    }
  })
})
