import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { goalResumeExitCode, resolveAnyGoalSession, resolveGoalSession } from "../../src/cli/cmd/goal-impl"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("goalResumeExitCode", () => {
  test("maps goal terminal states to kimi-style headless exit codes", () => {
    expect(goalResumeExitCode({ goalStatus: "complete", timedOut: false })).toBe(0)
    expect(goalResumeExitCode({ goalStatus: "blocked", timedOut: false })).toBe(3)
    expect(goalResumeExitCode({ goalStatus: "budget_limited", timedOut: false })).toBe(4)
    expect(goalResumeExitCode({ goalStatus: "paused", timedOut: false })).toBe(6)
    expect(goalResumeExitCode({ goalStatus: undefined, timedOut: false })).toBe(6)
  })

  test("session errors and idle timeouts take precedence over the goal state", () => {
    expect(goalResumeExitCode({ goalStatus: "complete", sessionError: "provider auth failed", timedOut: false })).toBe(
      1,
    )
    expect(goalResumeExitCode({ goalStatus: "complete", sessionError: "provider auth failed", timedOut: true })).toBe(
      124,
    )
    expect(goalResumeExitCode({ goalStatus: undefined, timedOut: true })).toBe(124)
  })
})

describe("resolveGoalSession", () => {
  test("an explicit session id always wins", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const resolved = await resolveGoalSession(session.id)
        expect(resolved).toBe(session.id)
      },
    })
  })

  test("errors without goals in the project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(resolveGoalSession(undefined)).rejects.toThrow("No goal is set in this project")
      },
    })
  })

  test("picks the single resumable goal without --session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "finish the migration", status: "paused" })
        expect(await resolveGoalSession(undefined)).toBe(session.id)
      },
    })
  })

  test("prefers resumable goals over terminal ones and rejects ambiguity", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const complete = await Session.create({})
        const completedGoal = await SessionGoal.create({
          sessionID: complete.id,
          objective: "done already",
          status: "paused",
        })
        await SessionGoal.setStatus({
          sessionID: complete.id,
          status: "complete",
          expected: { created: completedGoal.time.created, status: "paused", updated: completedGoal.time.updated },
        })
        // A complete goal alone is not resumable by default.
        await expect(resolveGoalSession(undefined)).rejects.toThrow("No resumable goal")

        const paused = await Session.create({})
        await SessionGoal.create({ sessionID: paused.id, objective: "parked work", status: "paused" })
        expect(await resolveGoalSession(undefined)).toBe(paused.id)

        const other = await Session.create({})
        await SessionGoal.create({ sessionID: other.id, objective: "more parked work", status: "paused" })
        await expect(resolveGoalSession(undefined)).rejects.toThrow("Multiple sessions have resumable goals")
      },
    })
  })

  test("SessionGoal.list returns every project goal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({})
        const second = await Session.create({})
        await SessionGoal.create({ sessionID: first.id, objective: "one", status: "paused" })
        await SessionGoal.create({ sessionID: second.id, objective: "two", status: "active" })
        const goals = await SessionGoal.list()
        expect(goals.map((goal) => goal.objective).sort()).toEqual(["one", "two"])
      },
    })
  })
})

describe("resolveAnyGoalSession", () => {
  test("errors without goals in the project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(resolveAnyGoalSession(undefined)).rejects.toThrow("No goal is set in this project")
      },
    })
  })

  test("resolves a budget_limited goal without --session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const goal = await SessionGoal.create({ sessionID: session.id, objective: "budget ran out", status: "active" })
        await SessionGoal.setStatus({
          sessionID: session.id,
          status: "budget_limited",
          expected: { created: goal.time.created, status: "active", updated: goal.time.updated },
        })
        expect(await resolveAnyGoalSession(undefined)).toBe(session.id)
      },
    })
  })

  test("resolves a complete goal without --session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const goal = await SessionGoal.create({ sessionID: session.id, objective: "done already", status: "paused" })
        await SessionGoal.setStatus({
          sessionID: session.id,
          status: "complete",
          expected: { created: goal.time.created, status: "paused", updated: goal.time.updated },
        })
        expect(await resolveAnyGoalSession(undefined)).toBe(session.id)
        // resume still refuses the same goal.
        await expect(resolveGoalSession(undefined)).rejects.toThrow("No resumable goal")
      },
    })
  })

  test("requires --session when multiple goals exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({})
        const second = await Session.create({})
        await SessionGoal.create({ sessionID: first.id, objective: "one", status: "paused" })
        const limited = await SessionGoal.create({ sessionID: second.id, objective: "two", status: "active" })
        await SessionGoal.setStatus({
          sessionID: second.id,
          status: "budget_limited",
          expected: { created: limited.time.created, status: "active", updated: limited.time.updated },
        })
        await expect(resolveAnyGoalSession(undefined)).rejects.toThrow("Multiple sessions have goals")
        expect(await resolveAnyGoalSession(first.id)).toBe(first.id)
      },
    })
  })
})

describe("goalPauseRefusal", () => {
  test("refuses terminal goals so pause cannot demote them into resumable work", async () => {
    const { goalPauseRefusal } = await import("../../src/cli/cmd/goal-impl")
    expect(goalPauseRefusal(undefined)).toContain("No goal")
    const base = {
      sessionID: {} as never,
      objective: "obj",
      tokensUsed: 0,
      timeUsedSeconds: 0,
      time: { created: 0 },
    }
    expect(goalPauseRefusal({ ...base, status: "complete" })).toContain("already complete")
    expect(goalPauseRefusal({ ...base, status: "budget_limited" })).toContain("already budget_limited")
    expect(goalPauseRefusal({ ...base, status: "active" })).toBeUndefined()
    expect(goalPauseRefusal({ ...base, status: "paused" })).toBeUndefined()
    expect(goalPauseRefusal({ ...base, status: "blocked" })).toBeUndefined()
  })
})
