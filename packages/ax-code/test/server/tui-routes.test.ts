import { afterEach, expect, test, vi } from "vitest"
import { Hono } from "hono"
import { Bus } from "../../src/bus"
import { TuiRoutes } from "../../src/server/routes/tui"

afterEach(() => {
  vi.restoreAllMocks()
})

test("execute-command rejects names that only resolve through Object.prototype", async () => {
  const publish = vi.spyOn(Bus, "publish").mockResolvedValue(undefined as never)
  const app = new Hono().route("/tui", TuiRoutes())
  for (const command of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const result = await app.request("/tui/execute-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command }),
    })
    expect(result.status).toBe(400)
  }
  expect(publish).not.toHaveBeenCalled()
})
