import express from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"

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
  it("keeps server-side update installation disabled", async () => {
    const { app } = createApp()

    const response = await request(app).post("/api/openchamber/update-install").expect(400)

    expect(response.body).toEqual({ error: "No update available" })
  })
})
