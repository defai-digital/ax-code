import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { GoalContractVerification } from "../../src/session/goal-contract-verification"
import { GoalPlan } from "../../src/session/goal-plan"
import { SessionGoal } from "../../src/session/goal"
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

  test("rejects an unparseable plan when its frozen digest exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = Date.now()
        const written = await GoalPlan.write(session.id, created, GoalPlan.render(GoalPlan.sample("ship the feature")))
        await fs.writeFile(written.path, "# Plan: ship the feature\n\nthis is no longer valid plan markdown\n")

        const decision = GoalContractVerification.decide({
          sessionID: session.id,
          created,
        })
        expect(decision.ok).toBe(false)
        if (decision.ok) throw new Error("expected corrupt contract rejection")
        expect(decision.reason).toBe("digest_mismatch")
        await Session.remove(session.id)
      },
    })
  })

  test("enforces the UTF-8 byte limit at write and read boundaries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = Date.now()
        const base = GoalPlan.sample("x")
        const baseMarkdown = GoalPlan.render(base)
        const padding = GoalPlan.MAX_READ_BYTES - Buffer.byteLength(baseMarkdown, "utf8")
        const exact = GoalPlan.render({
          ...base,
          acceptance: [{ id: "AC1", text: base.acceptance[0]!.text + "x".repeat(padding) }],
        })
        expect(Buffer.byteLength(exact, "utf8")).toBe(GoalPlan.MAX_READ_BYTES)

        await GoalPlan.write(session.id, created, exact)
        const result = GoalPlan.read(session.id, created)
        expect(result.status).toBe("found")
        expect(GoalPlan.hasValidContract(session.id, created)).toBe(true)

        const oversizedCreated = created + 1
        const multibyte = GoalPlan.render(GoalPlan.sample("界".repeat(3_000)))
        await expect(GoalPlan.write(session.id, oversizedCreated, multibyte)).rejects.toThrow(/exceeds/)
        expect(GoalPlan.readCapped(GoalPlan.pathFor(session.id, oversizedCreated))).toBeUndefined()
        expect(GoalPlan.storedDigest(session.id, oversizedCreated)).toBeUndefined()

        const expandedCreated = created + 2
        const expanded = GoalPlan.render(GoalPlan.sample("x")).replace(
          "run the relevant tests or verify_project",
          "\\x".repeat(3_500),
        )
        expect(Buffer.byteLength(expanded, "utf8")).toBeLessThan(GoalPlan.MAX_READ_BYTES)
        expect(Buffer.byteLength(GoalPlan.render(GoalPlan.parse(expanded)), "utf8")).toBeGreaterThan(
          GoalPlan.MAX_READ_BYTES,
        )
        await expect(GoalPlan.write(session.id, expandedCreated, expanded)).rejects.toThrow(/exceeds/)
        expect(GoalPlan.readCapped(GoalPlan.pathFor(session.id, expandedCreated))).toBeUndefined()
        expect(GoalPlan.storedDigest(session.id, expandedCreated)).toBeUndefined()
        await GoalPlan.remove(session.id, created)
        await Session.remove(session.id)
      },
    })
  })
})

describe("goal contract visibility (item 2, option A)", () => {
  test("a goal whose planning never completed says so wherever it is shown", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // Created but never planned: the planner failed, or this is a pre-v1 goal.
        const goal = await SessionGoal.create({ sessionID: session.id, objective: "ship the feature" })

        expect(GoalPlan.lookupContract(session.id, goal.time.created)).toEqual({ state: "missing" })
        const text = SessionGoal.format(goal)
        expect(text).toContain("No assurance contract")
        expect(text).toContain("basic gate")
      },
    })
  })

  test("a goal with a usable contract carries no notice", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const goal = await SessionGoal.create({ sessionID: session.id, objective: "ship it" })
        await GoalPlan.write(session.id, goal.time.created, GoalPlan.render(GoalPlan.sample("ship it")))

        expect(GoalPlan.lookupContract(session.id, goal.time.created).state).toBe("present")
        const text = SessionGoal.format(goal)
        expect(text).not.toContain("No assurance contract")
        expect(text).not.toContain("contract unusable")
      },
    })
  })

  test("a contract whose digest no longer matches is reported as unusable", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const goal = await SessionGoal.create({ sessionID: session.id, objective: "ship it" })
        // Write the plan without its digest: the artifacts exist but do not verify.
        const plan = GoalPlan.pathFor(session.id, goal.time.created)
        await fs.mkdir(path.dirname(plan), { recursive: true })
        await fs.writeFile(plan, GoalPlan.render(GoalPlan.sample("ship it")), "utf8")

        expect(GoalPlan.lookupContract(session.id, goal.time.created).state).toBe("invalid")
        expect(SessionGoal.format(goal)).toContain("Assurance contract unusable")
      },
    })
  })
})
