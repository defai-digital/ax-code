import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionBranchRank } from "../../src/session/branch"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("session branch ranking endpoint", () => {
  test("returns a ranked session family with a recommendation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root" })
        const fork = await Session.fork({ sessionID: root.id })

        await Storage.write(
          ["session_diff", fork.id],
          [
            {
              file: path.join(tmp.path, "src/server/routes/demo.ts"),
              before: "export const a = 1\n",
              after: Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i}\n`).join(""),
              additions: 120,
              deletions: 1,
              status: "modified",
            },
          ],
        )

        const app = Server.Default()
        const res = await app.request(`/session/${root.id}/branch/rank`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionBranchRank.Family
        expect(body.root.id).toBe(root.id)
        expect(body.current.id).toBe(root.id)
        expect(body.recommended.id).toBe(root.id)
        expect(body.items.map((item) => item.id)).toEqual([root.id, fork.id])
        expect(body.items.find((item) => item.id === fork.id)?.semantic?.primary).toBe("rewrite")
        expect(body.reasons).toContain("avoids a broad rewrite")
      },
    })
  })

  test("returns 404 for a missing session family", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/branch/rank")
        expect(res.status).toBe(404)
      },
    })
  })
})
