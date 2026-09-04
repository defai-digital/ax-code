import { describe, expect, test } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { AppErrorEnvelope } from "../../src/server/error"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

describe("feature config persistence errors", () => {
  test.each([
    { route: "autonomous", body: { enabled: true } },
    { route: "smart-llm", body: { enabled: true } },
    { route: "super-long", body: { enabled: false } },
    { route: "isolation", body: { mode: "read-only" } },
  ])("returns the standard error envelope from PUT /$route", async ({ route, body }) => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(path.join(tmp.path, "ax-code.json"), "{not json")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/${route}?directory=${encodeURIComponent(tmp.path)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const payload = await response.json()

        expect(response.status).toBe(500)
        expect(AppErrorEnvelope.safeParse(payload).success).toBe(true)
        expect(payload).not.toHaveProperty("error")
      },
    })
  })
})
