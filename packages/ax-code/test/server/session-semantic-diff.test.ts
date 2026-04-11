import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionSemanticDiff } from "../../src/session/semantic-diff"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("session semantic diff endpoint", () => {
  test("returns a semantic summary for recorded file changes", async () => {
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
              after:
                "export function demo(v?: string) {\n  if (!v) throw new Error('missing')\n  return v?.trim() ?? ''\n}\n",
              additions: 4,
              deletions: 1,
              status: "modified" as const,
            },
          ],
        )

        const app = Server.Default()
        const res = await app.request(`/session/${session.id}/diff/semantic`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionSemanticDiff.Summary
        expect(body.primary).toBe("bug_fix")
        expect(body.risk).toBe("medium")
        expect(body.changes[0]?.summary).toBe("bug fix · demo.ts")
      },
    })
  })

  test("returns 404 for a missing session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/diff/semantic")
        expect(res.status).toBe(404)
      },
    })
  })
})
