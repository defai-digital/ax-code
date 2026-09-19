import { afterEach, expect, test, vi } from "vitest"
import { Hono } from "hono"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { prepareAxEngine } from "../../src/provider/ax-engine"
import { ProviderRoutes } from "../../src/server/routes/provider"

vi.mock("../../src/provider/ax-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/provider/ax-engine")>()
  return { ...actual, prepareAxEngine: vi.fn(async () => ({})) }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test.each(["start", "prepare"])("%s forwards configured and explicitly overridden MTP policy", async (action) => {
  vi.spyOn(Config, "get").mockResolvedValue({ provider: { "ax-engine": { options: { mtpPolicy: "required" } } } })
  vi.spyOn(Provider, "invalidate").mockResolvedValue()
  const app = new Hono().route("/provider", ProviderRoutes())
  for (const [body, expected] of [
    [{}, "required"],
    [{ mtpPolicy: "disabled" }, "disabled"],
    [{ mtpPolicy: "auto" }, "auto"],
  ] as const) {
    const result = await app.request(`/provider/ax-engine/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(result.status).toBe(200)
    expect(prepareAxEngine).toHaveBeenLastCalledWith(expect.objectContaining({ mtpPolicy: expected }))
  }
  vi.mocked(prepareAxEngine).mockClear()
  const invalid = await app.request(`/provider/ax-engine/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mtpPolicy: "pure" }),
  })
  expect(invalid.status).toBe(400)
  expect(prepareAxEngine).not.toHaveBeenCalled()
})
