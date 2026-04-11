import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SessionBranchRank } from "../../src/session/branch"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("session branch ranking", () => {
  test("loads a session family and recommends the strongest branch", async () => {
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

        const detail = await SessionBranchRank.family(root.id)

        expect(detail.root.id).toBe(root.id)
        expect(detail.current.id).toBe(root.id)
        expect(detail.recommended.id).toBe(root.id)
        expect(detail.items.map((item) => item.id)).toEqual([root.id, fork.id])
        expect(detail.items.find((item) => item.id === fork.id)?.semantic?.primary).toBe("rewrite")
        expect(detail.reasons).toContain("avoids a broad rewrite")
      },
    })
  })
})
