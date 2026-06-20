import { afterAll, describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"

const originalTestHome = process.env.AX_CODE_TEST_HOME
const testHome = path.join(os.tmpdir(), `ax-code-prompt-history-${Math.random().toString(36).slice(2)}`)
process.env.AX_CODE_TEST_HOME = testHome

const runtime = Promise.all([
  import("../../src/server/server"),
  import("../fixture/fixture"),
  import("../../src/storage/db"),
])

afterAll(async () => {
  const [, , { Database }] = await runtime
  Database.close()
  if (originalTestHome === undefined) delete process.env.AX_CODE_TEST_HOME
  else process.env.AX_CODE_TEST_HOME = originalTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("prompt history route", () => {
  test("stores and reads prompt history scoped to the current project", async () => {
    const [{ Server }, { tmpdir }] = await runtime
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const postFirst = await Server.Default().request(`/prompt-history?directory=${encodeURIComponent(first.path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "fix the first project",
        mode: "normal",
        parts: [{ type: "text", text: "fix the first project" }],
      }),
    })
    expect(postFirst.status).toBe(200)

    const postSecond = await Server.Default().request(`/prompt-history?directory=${encodeURIComponent(second.path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "fix the second project",
        mode: "normal",
        parts: [{ type: "text", text: "fix the second project" }],
      }),
    })
    expect(postSecond.status).toBe(200)

    const firstList = await Server.Default().request(`/prompt-history?directory=${encodeURIComponent(first.path)}`)
    expect(firstList.status).toBe(200)
    expect(await firstList.json()).toEqual([
      {
        input: "fix the first project",
        mode: "normal",
        parts: [{ type: "text", text: "fix the first project" }],
      },
    ])
  })

  test("keeps only the newest project-scoped prompt history entries", async () => {
    const [{ Server }, { tmpdir }] = await runtime
    await using project = await tmpdir({ git: true })
    for (let i = 0; i < 55; i++) {
      const response = await Server.Default().request(`/prompt-history?directory=${encodeURIComponent(project.path)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: `prompt ${i}`,
          parts: [{ type: "text", text: `prompt ${i}` }],
        }),
      })
      expect(response.status).toBe(200)
    }

    const list = await Server.Default().request(`/prompt-history?directory=${encodeURIComponent(project.path)}`)
    expect(list.status).toBe(200)
    const body = (await list.json()) as Array<{ input: string }>
    expect(body).toHaveLength(50)
    expect(body[0]?.input).toBe("prompt 5")
    expect(body.at(-1)?.input).toBe("prompt 54")
  })
})
