import express from "express"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"

import { registerOpenChamberRoutes } from "./openchamber-routes.js"

const createApp = () => {
  const app = express()
  const dependencies = {
    modelsDevApiUrl: "https://models.dev/api.json",
    modelsMetadataCacheTtl: 300000,
    fetchFreeZenModels: vi.fn(),
    getCachedZenModels: vi.fn(),
  }

  registerOpenChamberRoutes(app, dependencies)
  return { app, dependencies }
}

describe("openchamber routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not register removed server-side update routes", async () => {
    const { app } = createApp()

    await request(app).get("/api/openchamber/update-check").expect(404)
    await request(app).post("/api/openchamber/update-install").expect(404)
  })

  it("strips model cost metadata from the proxied models.dev response", async () => {
    const { app } = createApp()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          openai: {
            models: {
              "gpt-test": {
                id: "gpt-test",
                name: "GPT Test",
                cost: { input: 1, output: 2 },
                experimental: {
                  modes: {
                    flex: {
                      cost: { input: 0.5, output: 1 },
                    },
                  },
                },
              },
            },
          },
        }),
      })),
    )

    const response = await request(app).get("/api/openchamber/models-metadata").expect(200)

    const model = response.body.openai.models["gpt-test"]
    expect(model.name).toBe("GPT Test")
    expect(model.cost).toBeUndefined()
    expect(model.experimental.modes.flex.cost).toBeUndefined()
  })
})
