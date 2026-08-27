import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { GoalContractVerification } from "../../src/session/goal-contract-verification"
import { GoalPlan } from "../../src/session/goal-plan"
import { tmpdir } from "../fixture/fixture"

describe("GoalContractVerification", () => {
  test("allows completion when no contract exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        expect(
          GoalContractVerification.decide({
            sessionID: session.id,
            created: Date.now(),
          }),
        ).toEqual({ ok: true })
        await Session.remove(session.id)
      },
    })
  })

  test("requires evidence for every acceptance id and a matching digest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = Date.now()
        const written = await GoalPlan.write(session.id, created, GoalPlan.render(GoalPlan.sample("ship the feature")))
        const missing = GoalContractVerification.decide({
          sessionID: session.id,
          created,
        })
        expect(missing.ok).toBe(false)
        if (missing.ok) throw new Error("expected missing evidence")
        expect(missing.reason).toBe("missing_evidence")

        const ok = GoalContractVerification.decide({
          sessionID: session.id,
          created,
          acceptanceEvidence: { AC1: "ran verify_project; all checks passed" },
        })
        expect(ok).toEqual({ ok: true })

        const mutated = GoalPlan.render({
          ...written.contract,
          acceptance: [{ id: "AC1", text: "a weaker criterion" }],
        })
        // Overwrite the markdown without refreshing the stored digest.
        const fs = await import("fs/promises")
        await fs.writeFile(written.path, mutated)
        const drifted = GoalContractVerification.decide({
          sessionID: session.id,
          created,
          acceptanceEvidence: { AC1: "ran tests" },
        })
        expect(drifted.ok).toBe(false)
        if (drifted.ok) throw new Error("expected digest mismatch")
        expect(drifted.reason).toBe("digest_mismatch")
        await Session.remove(session.id)
      },
    })
  })
})
