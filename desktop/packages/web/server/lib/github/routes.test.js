import express from "express"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

const activateGitHubAuth = vi.fn()
const getGitHubAuthAccounts = vi.fn()

vi.mock("./index.js", () => ({
  activateGitHubAuth,
  clearGitHubAuth: vi.fn(),
  exchangeDeviceCode: vi.fn(),
  getGitHubAuth: vi.fn(() => null),
  getGitHubAuthAccounts,
  getGitHubClientId: vi.fn(() => "client-id"),
  getGitHubScopes: vi.fn(() => ["repo"]),
  getOctokitOrNull: vi.fn(() => null),
  resolveGitHubRepoFromDirectory: vi.fn(async () => ({ repo: null })),
  setGitHubAuth: vi.fn(),
  startDeviceFlow: vi.fn(),
}))

const { registerGitHubRoutes } = await import("./routes.js")

const createApp = () => {
  const app = express()
  app.use(express.json())
  registerGitHubRoutes(app)
  return app
}

describe("github routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getGitHubAuthAccounts.mockReturnValue([{ id: "known-account" }])
  })

  it("rejects unknown account activation before mutating auth state", async () => {
    const app = createApp()

    const response = await request(app)
      .post("/api/github/auth/activate")
      .send({ accountId: "missing-account" })
      .expect(404)

    expect(response.body).toEqual({ error: "GitHub account not found" })
    expect(activateGitHubAuth).not.toHaveBeenCalled()
  })

  it("rejects blank account activation before mutating auth state", async () => {
    const app = createApp()

    const response = await request(app).post("/api/github/auth/activate").send({ accountId: "   " }).expect(400)

    expect(response.body).toEqual({ error: "accountId is required" })
    expect(activateGitHubAuth).not.toHaveBeenCalled()
  })
})
