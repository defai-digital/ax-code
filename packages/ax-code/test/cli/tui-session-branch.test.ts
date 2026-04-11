import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { SessionBranch } from "../../src/cli/cmd/tui/routes/session/branch"
import { tmpdir } from "../fixture/fixture"

describe("tui session branch helpers", () => {
  test("ranks a branch family and recommends the safer session", async () => {
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

        const detail = SessionBranch.detail({
          currentID: root.id,
          sessions: [
            { id: root.id, title: root.title },
            { id: fork.id, title: fork.title },
          ],
          semantic: {
            [root.id]: null,
            [fork.id]: {
              headline: "rewrite · demo.ts",
              risk: "high",
              primary: "rewrite",
              files: 1,
              additions: 120,
              deletions: 1,
              counts: [{ kind: "rewrite", count: 1 }],
              signals: ["121 lines touched"],
              changes: [
                {
                  file: path.join(tmp.path, "src/server/routes/demo.ts"),
                  status: "modified",
                  kind: "rewrite",
                  risk: "high",
                  summary: "rewrite · demo.ts",
                  additions: 120,
                  deletions: 1,
                  signals: ["121 lines touched"],
                },
              ],
            },
          },
        })

        expect(detail?.recommendedID).toBe(root.id)
        expect(detail?.items.map((item) => item.id)).toEqual([root.id, fork.id])
        expect(SessionBranch.summary(detail!)).toBe("branch ranking: current session is recommended (2 total)")
        expect(SessionBranch.entries(detail!).some((item) => item.title === `Recommended ${root.title}`)).toBe(true)
        expect(SessionBranch.continueEntries(detail!)).toHaveLength(1)
        expect(SessionBranch.continueEntries(detail!)[0]?.id).toBe(`continue:${root.id}`)
        expect(SessionBranch.continueEntries(detail!)[0]?.title).toBe("Continue current branch")
        expect(SessionBranch.continueEntries(detail!)[0]?.category).toBe("Continue")
        expect(SessionBranch.continueEntries(detail!)[0]?.sessionID).toBe(root.id)
        expect(SessionBranch.continueEntries(detail!)[0]?.footer).toContain("confidence")
        expect(SessionBranch.compareEntries(detail!)).toHaveLength(1)
        expect(SessionBranch.compareEntries(detail!)[0]?.id).toBe(`compare:${fork.id}`)
        expect(SessionBranch.compareEntries(detail!)[0]?.title).toBe(`Compare with ${fork.title}`)
        expect(SessionBranch.compareEntries(detail!)[0]?.category).toBe("Compare")
        expect(SessionBranch.compareEntries(detail!)[0]?.sessionID).toBe(fork.id)
        expect(SessionBranch.compareEntries(detail!)[0]?.description).toContain("rewrite · demo.ts")
        expect(SessionBranch.compareEntries(detail!)[0]?.footer).toContain("change risk")
      },
    })
  })
})
