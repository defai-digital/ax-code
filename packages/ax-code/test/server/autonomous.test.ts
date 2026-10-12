import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "path"
import { ScopedFlag } from "../../src/flag/scoped"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

const originalAutonomous = process.env.AX_CODE_AUTONOMOUS

// The scoped-flag state is module-global for the process; without a reset a
// test that records an explicit project config would leak "managed" into the
// silent-directory tests and make them order-dependent.
beforeEach(() => {
  ScopedFlag.resetForTests()
})

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

  test("a second silent directory keeps the env-disabled autonomous mode off", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    await writeFile(path.join(first.path, "ax-code.json"), "{}")
    await writeFile(path.join(second.path, "ax-code.json"), "{}")
    process.env.AX_CODE_AUTONOMOUS = "false"

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        const firstResponse = await Server.Default().request(`/autonomous?directory=${encodeURIComponent(first.path)}`)
        expect(await firstResponse.json()).toEqual({ enabled: false })

        // The first silent directory must not pin the flag: the second silent
        // directory still belongs to the pristine env's "off". The previous
        // code marked the flag managed on the first env-derived read and then
        // answered every later silent directory with the hardcoded default,
        // clobbering the env.
        const secondResponse = await Server.Default().request(
          `/autonomous?directory=${encodeURIComponent(second.path)}`,
        )
        expect(await secondResponse.json()).toEqual({ enabled: false })
        expect(process.env.AX_CODE_AUTONOMOUS).toBe("false")
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
