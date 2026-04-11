import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Risk } from "../../src/risk/score"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("risk score", () => {
  test("uses session diff data for churn and breakdown", async () => {
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
              before: "export const a = 1\n",
              after: Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i}\n`).join(""),
              additions: 120,
              deletions: 1,
              status: "modified",
            },
          ],
        )

        const risk = Risk.fromSession(session.id)

        expect(risk.signals.filesChanged).toBe(1)
        expect(risk.signals.linesChanged).toBe(121)
        expect(risk.signals.apiEndpointsAffected).toBe(1)
        expect(risk.summary).toContain("no test coverage")
        expect(Risk.explain(risk, 3)).toContain("Validation coverage: no validation run recorded (+25)")
        expect(Risk.explain(risk, 3)).toContain("API surface: 1 route files affected (+15)")
      },
    })
  })
})
