import { afterEach, describe, expect, test } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

const originalAutonomous = process.env.AX_CODE_AUTONOMOUS

afterEach(() => {
  if (originalAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
  else process.env.AX_CODE_AUTONOMOUS = originalAutonomous
})

describe("autonomous route", () => {
  test("GET does not re-enable autonomous mode that the env disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    // Silent project config: the env flag must win over a hard default-on.
    await writeFile(path.join(tmp.path, "ax-code.json"), "{}")
    process.env.AX_CODE_AUTONOMOUS = "false"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/autonomous?directory=${encodeURIComponent(tmp.path)}`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ enabled: false })
      },
    })
  })

  test("a project config autonomous setting still wins over the env", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ autonomous: true }))
    process.env.AX_CODE_AUTONOMOUS = "false"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/autonomous?directory=${encodeURIComponent(tmp.path)}`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ enabled: true })
      },
    })
  })
})
