import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionRisk } from "../../src/session/risk"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("session risk endpoint", () => {
  test("returns explainable risk detail for a session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await Storage.write(
          ["session_diff", session.id],
          [
            {
              file: path.join(tmp.path, "src/server/routes/demo.ts"),
              before: "export const demo = () => 1\n",
              after: Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i}\n`).join(""),
              additions: 120,
              deletions: 1,
              status: "modified",
            },
          ],
        )

        const app = Server.Default()
        const res = await app.request(`/session/${session.id}/risk`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionRisk.Detail
        expect(body.id).toBe(session.id)
        expect(body.assessment.level).toBe("HIGH")
        expect(body.drivers[0]).toBe("Validation coverage: no validation run recorded (+25)")
        expect(body.semantic?.headline).toBe("rewrite · demo.ts")
      },
    })
  })

  test("returns 404 for a missing session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/risk")
        expect(res.status).toBe(404)
      },
    })
  })
})
