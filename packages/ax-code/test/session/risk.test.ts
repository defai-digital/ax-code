import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRisk } from "../../src/session/risk"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("session risk", () => {
  test("loads explainable risk detail for a session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "risk demo" })

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

        const detail = await SessionRisk.load(session.id)

        expect(detail.id).toBe(session.id)
        expect(detail.title).toBe("risk demo")
        expect(detail.assessment.level).toBe("HIGH")
        expect(detail.assessment.score).toBe(50)
        expect(detail.drivers).toEqual([
          "Validation coverage: no validation run recorded (+25)",
          "API surface: 1 route files affected (+15)",
          "Code churn: 121 lines changed (+10)",
        ])
        expect(detail.semantic?.headline).toBe("rewrite · demo.ts")
        expect(detail.semantic?.risk).toBe("high")
      },
    })
  })
})
