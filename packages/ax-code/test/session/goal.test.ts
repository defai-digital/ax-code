import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"
import { Snapshot } from "../../src/snapshot"
import { Todo } from "../../src/session/todo"
import { readFile } from "node:fs/promises"

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: {
    context: 128_000,
    output: 8_192,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

let streamSpy: MockInstance | undefined
let modelSpy: MockInstance | undefined
let snapshotTrackSpy: MockInstance | undefined
let usageSpy: MockInstance | undefined
let goalReadSpy: MockInstance | undefined

// Goal auto-continuation runs inside the autonomous prompt loop. Pin the
// flag explicitly: config loads with an `autonomous` key sync the env, so
// earlier tests in the process could otherwise leak it off.
const origAutonomous = process.env.AX_CODE_AUTONOMOUS
beforeEach(() => {
  process.env.AX_CODE_AUTONOMOUS = "1"
  // Goal-loop behavior is independent of git snapshotting. Avoid spawning git
  // for every synthetic continuation so this suite stays deterministic under
  // the full test matrix's subprocess load.
  snapshotTrackSpy = vi.spyOn(Snapshot, "track").mockResolvedValue(undefined)
})

afterEach(() => {
  if (origAutonomous === undefined) {
    delete process.env.AX_CODE_AUTONOMOUS
  } else {
    process.env.AX_CODE_AUTONOMOUS = origAutonomous
  }
  streamSpy?.mockRestore()
  streamSpy = undefined
  modelSpy?.mockRestore()
  modelSpy = undefined
  goalReadSpy?.mockRestore()
  goalReadSpy = undefined
  usageSpy?.mockRestore()
  usageSpy = undefined
  snapshotTrackSpy?.mockRestore()
  snapshotTrackSpy = undefined
})

describe("SessionGoal", () => {
  test("persists lifecycle and budget usage per session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = await SessionGoal.create({
          sessionID: session.id,
          objective: "finish the migration",
          tokenBudget: 25,
        })

        expect(created.status).toBe("active")
        expect(created.tokensUsed).toBe(0)
        expect(created.tokenBudget).toBe(25)

        const updated = await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_usage" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 3_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              total: 30,
              input: 10,
              output: 15,
              reasoning: 5,
              cache: { read: 0, write: 0 },
            },
          },
        })

        expect(updated?.status).toBe("budget_limited")
        expect(updated?.tokensUsed).toBe(30)
        expect(updated?.timeUsedSeconds).toBe(2)

        await SessionGoal.clear(session.id)
        expect(await SessionGoal.get(session.id)).toBeUndefined()
        await Session.remove(session.id)
      },
    })
  })

  test("a wall-clock time budget flips the goal to budget_limited and blocks resume", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = await SessionGoal.create({
          sessionID: session.id,
          objective: "train the teacher model",
          timeBudgetSeconds: 5,
        })

        expect(created.status).toBe("active")
        expect(created.timeBudgetSeconds).toBe(5)

        // A token-free turn (e.g. waiting on a remote job) still accrues time.
        const updated = await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_time_budget" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 7_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              total: 0,
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        })

        expect(updated?.timeUsedSeconds).toBe(6)
        expect(updated?.status).toBe("budget_limited")

        await expect(SessionGoal.resume(session.id)).rejects.toThrow("time budget")

        await SessionGoal.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("rejects a non-positive time budget at creation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await expect(
          SessionGoal.create({ sessionID: session.id, objective: "x", timeBudgetSeconds: 0 }),
        ).rejects.toThrow("time budget")
        await Session.remove(session.id)
      },
    })
  })

  test("forking a session carries the goal and its usage to the fork", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "ship the feature",
          tokenBudget: 1_000,
        })
        await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_fork_usage" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 3_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              total: 30,
              input: 10,
              output: 15,
              reasoning: 5,
              cache: { read: 0, write: 0 },
            },
          },
        })

        const fork = await Session.fork({ sessionID: session.id })
        const copied = await SessionGoal.get(fork.id)
        expect(copied?.objective).toBe("ship the feature")
        expect(copied?.status).toBe("active")
        expect(copied?.tokenBudget).toBe(1_000)
        expect(copied?.tokensUsed).toBe(30)

        const bare = await Session.create({})
        const bareFork = await Session.fork({ sessionID: bare.id })
        expect(await SessionGoal.get(bareFork.id)).toBeUndefined()
      },
    })
  })

  test("a failing goal copy does not fail the fork", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "ship the feature" })

        // copyTo runs after the fork is already committed and its events
        // published; a failure there must not reject the whole fork.
        const copySpy = vi.spyOn(SessionGoal, "copyTo").mockRejectedValue(new Error("database is locked"))
        try {
          const fork = await Session.fork({ sessionID: session.id })
          expect(fork.id).toBeTruthy()
          // The fork session itself is fully persisted and retrievable.
          expect(await Session.get(fork.id)).toBeTruthy()
        } finally {
          copySpy.mockRestore()
        }
      },
    })
  })

  test("re-creating over a terminal goal resets usage and creation time", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const first = await SessionGoal.create({
          sessionID: session.id,
          objective: "first goal",
        })
        await SessionGoal.setStatus({ sessionID: session.id, status: "complete" })

        await new Promise((r) => setTimeout(r, 5))
        const second = await SessionGoal.create({
          sessionID: session.id,
          objective: "second goal",
        })

        expect(second.objective).toBe("second goal")
        expect(second.status).toBe("active")
        expect(second.tokensUsed).toBe(0)
        expect(second.time.created).toBeGreaterThan(first.time.created)

        await SessionGoal.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("adds concurrent usage updates without losing increments", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "track concurrent usage",
          tokenBudget: 100,
        })

        const message = (id: string, total: number, created: number, completed: number) => ({
          id: id as any,
          sessionID: session.id,
          parentID: "message_parent" as any,
          role: "assistant" as const,
          time: { created, completed },
          modelID: "test-model" as any,
          providerID: "test" as any,
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: {
            total,
            input: 0,
            output: total,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })

        await Promise.all([
          SessionGoal.addUsage({ sessionID: session.id, message: message("message_goal_usage_a", 30, 1_000, 3_000) }),
          SessionGoal.addUsage({ sessionID: session.id, message: message("message_goal_usage_b", 40, 4_000, 7_000) }),
        ])

        const updated = await SessionGoal.get(session.id)
        expect(updated?.status).toBe("active")
        expect(updated?.tokensUsed).toBe(70)
        expect(updated?.timeUsedSeconds).toBe(5)

        await SessionGoal.addUsage({
          sessionID: session.id,
          message: message("message_goal_usage_c", 30, 8_000, 9_000),
        })

        const limited = await SessionGoal.get(session.id)
        expect(limited?.status).toBe("budget_limited")
        expect(limited?.tokensUsed).toBe(100)
        expect(limited?.timeUsedSeconds).toBe(6)

        // The tripping turn above was recorded in full by the same UPDATE that
        // flipped the status. Later turns on a budget_limited goal — the user
        // keeps chatting, or a forked session keeps working — must not accrue:
        // usage would otherwise grow forever and goal status/forks would show
        // ever-increasing overage.
        await SessionGoal.addUsage({
          sessionID: session.id,
          message: message("message_goal_usage_d", 10, 10_000, 11_000),
        })
        const after = await SessionGoal.get(session.id)
        expect(after?.status).toBe("budget_limited")
        expect(after?.tokensUsed).toBe(100)
        expect(after?.timeUsedSeconds).toBe(6)

        await Session.remove(session.id)
      },
    })
  })

  test("paused and terminal goals do not accrue usage from unrelated turns", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "paused goal must keep its budget",
          tokenBudget: 100,
        })

        const message = (id: string, total: number) => ({
          id: id as any,
          sessionID: session.id,
          parentID: "message_parent" as any,
          role: "assistant" as const,
          time: { created: 1_000, completed: 3_000 },
          modelID: "test-model" as any,
          providerID: "test" as any,
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: {
            total,
            input: 0,
            output: total,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })

        await SessionGoal.addUsage({ sessionID: session.id, message: message("message_paused_a", 40) })
        await SessionGoal.pause(session.id)

        // Unrelated work in the same session while the goal is paused: the
        // paused goal must not be charged, or it would drift past its budget
        // and become permanently un-resumable.
        await SessionGoal.addUsage({ sessionID: session.id, message: message("message_paused_b", 80) })
        const paused = await SessionGoal.get(session.id)
        expect(paused?.status).toBe("paused")
        expect(paused?.tokensUsed).toBe(40)
        expect(paused?.timeUsedSeconds).toBe(2)

        const resumed = await SessionGoal.resume(session.id)
        expect(resumed.status).toBe("active")

        // Terminal states are frozen too: completed goals report final usage.
        await SessionGoal.setStatus({ sessionID: session.id, status: "complete" })
        await SessionGoal.addUsage({ sessionID: session.id, message: message("message_paused_c", 25) })
        const completed = await SessionGoal.get(session.id)
        expect(completed?.status).toBe("complete")
        expect(completed?.tokensUsed).toBe(40)

        await Session.remove(session.id)
      },
    })
  })

  test("uses component token sum when reported total is zero", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "track zero-total providers",
          tokenBudget: 100,
        })

        await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_zero_total" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 2_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              total: 0,
              input: 11,
              output: 13,
              reasoning: 17,
              cache: { read: 0, write: 0 },
            },
          },
        })

        const updated = await SessionGoal.get(session.id)
        expect(updated?.tokensUsed).toBe(41)

        await Session.remove(session.id)
      },
    })
  })

  test("prefers component tokens over a cache-inflated reported total", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "budget measures work, not cache reads",
          tokenBudget: 1_000,
        })

        // Goal continuations re-send the whole conversation from cache; the
        // reported total includes those cache reads. Only new work (net
        // input + output + reasoning) may burn the budget.
        await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_cache_total" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 2_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              // 500k cache-read-inflated total would exhaust the budget in
              // one turn; component sum is 60.
              total: 500_000,
              input: 10,
              output: 40,
              reasoning: 10,
              cache: { read: 499_940, write: 0 },
            },
          },
        })

        const updated = await SessionGoal.get(session.id)
        expect(updated?.tokensUsed).toBe(60)
        expect(updated?.status).toBe("active")

        await Session.remove(session.id)
      },
    })
  })

  test("ignores non-finite assistant token usage", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "track malformed provider usage",
          tokenBudget: 100,
        })

        await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_nan_usage" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 2_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              total: Number.NaN,
              input: Number.NaN,
              output: Number.POSITIVE_INFINITY,
              reasoning: Number.NEGATIVE_INFINITY,
              cache: { read: 0, write: 0 },
            },
          },
        })

        const updated = await SessionGoal.get(session.id)
        expect(updated?.status).toBe("active")
        expect(updated?.tokensUsed).toBe(0)
        expect(updated?.timeUsedSeconds).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("concurrent goal creation does not replace an active goal", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const results = await Promise.allSettled([
          SessionGoal.create({ sessionID: session.id, objective: "first concurrent goal" }),
          SessionGoal.create({ sessionID: session.id, objective: "second concurrent goal" }),
        ])

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
        expect((await SessionGoal.get(session.id))?.objective).toBe("first concurrent goal")

        await Session.remove(session.id)
      },
    })
  })

  test("refuses to resume a budget-exhausted goal even after it was paused", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "stop at the budget",
          tokenBudget: 10,
        })

        await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_pause_bypass" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 2_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: { total: 10, input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        })

        // Pause moves status from budget_limited → paused
        await SessionGoal.pause(session.id)
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")

        // Resume must still refuse because the budget is exhausted
        await expect(SessionGoal.resume(session.id)).rejects.toThrow("Cannot resume a budget-limited goal")
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")

        await Session.remove(session.id)
      },
    })
  })

  test("refuses to resume a budget-limited goal that is already over budget", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "stop at the budget",
          tokenBudget: 10,
        })

        await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_budget_limit" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 2_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              total: 10,
              input: 5,
              output: 5,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        })

        await expect(SessionGoal.resume(session.id)).rejects.toThrow("Cannot resume a budget-limited goal")
        await expect(SessionGoal.setStatus({ sessionID: session.id, status: "active" })).rejects.toThrow(
          "Cannot resume a budget-limited goal",
        )
        expect((await SessionGoal.get(session.id))?.status).toBe("budget_limited")

        await Session.remove(session.id)
      },
    })
  })

  test("goal command controls lifecycle without invoking the model for view and pause", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "ship the goal command" })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {})(),
        } as any)

        const view = await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "",
          agent: "build",
          model: "test/test-model",
        })
        expect(view.parts.some((part) => part.type === "text" && part.text.includes("ship the goal command"))).toBe(
          true,
        )

        const paused = await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "pause",
          agent: "build",
          model: "test/test-model",
        })
        expect(paused.parts.some((part) => part.type === "text" && part.text.includes("Goal paused"))).toBe(true)
        expect(streamSpy).not.toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("goal command surfaces control errors as messages without invoking the model", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {})(),
        } as any)

        const hasText = (message: Awaited<ReturnType<typeof SessionPrompt.command>>, needle: string) =>
          message.parts.some((part) => part.type === "text" && part.text.includes(needle))

        // pause with no goal set — must report, not throw
        const noGoal = await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "pause",
          agent: "build",
          model: "test/test-model",
        })
        expect(hasText(noGoal, "No goal is set for this session")).toBe(true)

        // create over an existing active goal — must report, not throw or replace
        await SessionGoal.create({ sessionID: session.id, objective: "first goal" })
        const duplicate = await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "second goal",
          agent: "build",
          model: "test/test-model",
        })
        expect(hasText(duplicate, "already has an active goal")).toBe(true)
        expect((await SessionGoal.get(session.id))?.objective).toBe("first goal")

        // invalid budget — must report the validation error, not throw
        await SessionGoal.clear(session.id)
        const badBudget = await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "--budget 0 do it",
          agent: "build",
          model: "test/test-model",
        })
        expect(hasText(badBudget, "must be a positive integer")).toBe(true)

        expect(streamSpy).not.toHaveBeenCalled()
        await Session.remove(session.id)
      },
    })
  })

  test("goal command safely formats non-printable control errors", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {})(),
        } as any)
        const broken = function brokenThrowable() {
          return undefined
        }
        Object.defineProperty(broken, Symbol.toPrimitive, {
          value() {
            throw new Error("cannot stringify")
          },
        })
        const createSpy = vi.spyOn(SessionGoal, "create").mockRejectedValue(broken)

        try {
          const message = await SessionPrompt.command({
            sessionID: session.id,
            command: "goal",
            arguments: "ship it",
            agent: "build",
            model: "test/test-model",
          })

          expect(message.parts.some((part) => part.type === "text" && part.text.includes("Goal command failed."))).toBe(
            true,
          )
          expect(streamSpy).not.toHaveBeenCalled()
        } finally {
          createSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("active goal continues until model marks it complete", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "finish the durable goal" })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        let streams = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async () => {
          streams++
          if (streams >= 2) {
            await SessionGoal.setStatus({ sessionID: session.id, status: "complete" })
          }
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: `text_${streams}` }
              yield { type: "text-delta", id: `text_${streams}`, text: `turn ${streams}` }
              yield { type: "text-end", id: `text_${streams}` }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "start work" }],
        })

        expect(streamSpy?.mock.calls.length ?? 0).toBeGreaterThanOrEqual(2)
        expect((await SessionGoal.get(session.id))?.status).toBe("complete")

        await Session.remove(session.id)
      },
    })
  })

  test("recovers goal binding after a transient initial storage read failure", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "finish the durable goal" })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        let streams = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async () => {
          streams++
          if (streams >= 2) {
            await SessionGoal.setStatus({ sessionID: session.id, status: "complete" })
          }
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: `text_${streams}` }
              yield { type: "text-delta", id: `text_${streams}`, text: `turn ${streams}` }
              yield { type: "text-end", id: `text_${streams}` }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        const getSpy = vi.spyOn(SessionGoal, "get").mockRejectedValueOnce(new Error("transient storage read"))
        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: model.providerID, modelID: model.id },
            parts: [{ type: "text", text: "start work" }],
          })

          expect(streamSpy?.mock.calls.length ?? 0).toBeGreaterThanOrEqual(2)
          expect((await SessionGoal.get(session.id))?.status).toBe("complete")
        } finally {
          getSpy.mockRestore()
        }
        await Session.remove(session.id)
      },
    })
  })

  test("prose-only active goal recovers then pauses before the global ceiling", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "finish the durable goal" })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        let streams = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async () => {
          streams++
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: `text_${streams}` }
              yield { type: "text-delta", id: `text_${streams}`, text: `turn ${streams}` }
              yield { type: "text-end", id: `text_${streams}` }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "start work" }],
        })

        expect(
          (await Session.messages({ sessionID: session.id })).filter(
            (m) => m.info.role === "assistant" && !m.info.summary,
          ),
        ).toHaveLength(4)
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")

        await Session.remove(session.id)
      },
    })
  })

  test("/goal resume restarts the prompt loop after a pause", async () => {
    // Regression: resume is an activation that flips status back to "active",
    // so it must re-enter the prompt loop the same way /goal <objective>
    // (create) does. Previously it only wrote a stopped control message and
    // the agent sat dormant until the next user message.
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        await SessionGoal.create({ sessionID: session.id, objective: "resume and continue" })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        let streams = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async () => {
          streams++
          // On the first stream after resume, mark the goal complete so the
          // loop terminates instead of auto-continuing forever.
          if (streams >= 2) {
            await SessionGoal.setStatus({ sessionID: session.id, status: "complete" })
          }
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: `text_${streams}` }
              yield { type: "text-delta", id: `text_${streams}`, text: `turn ${streams}` }
              yield { type: "text-end", id: `text_${streams}` }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        // Pause the goal, then resume it via the /goal command.
        await SessionGoal.pause(session.id)
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")
        const beforeResume = streamSpy?.mock.calls.length ?? 0

        await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "resume",
          agent: "build",
          model: "test/test-model",
        })

        // resume must have invoked the model (re-entered the loop) at least once.
        expect(streamSpy?.mock.calls.length ?? 0).toBeGreaterThan(beforeResume)
        expect((await SessionGoal.get(session.id))?.status).toBe("complete")

        await Session.remove(session.id)
      },
    })
  })

  test.each(["stop", "length", "other", "tool-calls", "empty", "error"])(
    "budget exhaustion on tool-calls permits one terminal request even with %s output and pending todos",
    async (wrapFinish) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Budget boundary control" })
          await SessionGoal.create({
            sessionID: session.id,
            objective: "implement the unfinished module",
            tokenBudget: 10,
          })
          await Todo.update({
            sessionID: session.id,
            todos: [{ content: "Implement remaining work", status: "pending", priority: "high" }],
          })
          modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
          let streams = 0
          const exposed: string[][] = []
          streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async (input: LLM.StreamInput) => {
            const turn = ++streams
            exposed.push(Object.keys(input.tools))
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "start-step" }
                if (turn === 2 && wrapFinish === "error") throw new Error("Budget summary unavailable")
                if (!(turn === 2 && wrapFinish === "empty")) {
                  yield { type: "text-start", id: `text_${turn}` }
                  yield {
                    type: "text-delta",
                    id: `text_${turn}`,
                    text: turn === 1 ? "Inspection finished." : "Budget reached; implementation remains pending.",
                  }
                  yield { type: "text-end", id: `text_${turn}` }
                }
                yield {
                  type: "finish-step",
                  finishReason:
                    turn === 1 ? "tool-calls" : turn === 2 ? (wrapFinish === "empty" ? "other" : wrapFinish) : "stop",
                  usage:
                    turn === 2 && wrapFinish === "empty"
                      ? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
                      : { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
                }
                yield { type: "finish" }
              })(),
            } as any
          }) as any)
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: model.providerID, modelID: model.id },
            parts: [{ type: "text", text: "start budgeted work" }],
          })
          expect(streams).toBe(2)
          expect(exposed[0]).toContain("write")
          expect(exposed[1]).not.toContain("write")
          expect(exposed[1]).not.toContain("bash")
          expect(exposed[1]).not.toContain("batch")
          expect(exposed[1]).not.toContain("task")
          expect(Todo.active(session.id)).toHaveLength(1)
          expect((await SessionGoal.get(session.id))?.status).toBe("budget_limited")
          const messages = await Session.messages({ sessionID: session.id })
          expect(
            messages.filter((m) =>
              m.parts.some((p) => p.type === "text" && p.text.includes("has reached its token budget")),
            ),
          ).toHaveLength(1)
          await Session.remove(session.id)
        },
      })
    },
  )

  test.each(["token", "time", "manual", "already-limited", "read-failure"] as const)(
    "accepted writes finish before %s enforcement; exhausted historical goals remain inert",
    async (kind) => {
      await using tmp = await tmpdir({ git: true, config: { permission: { "*": "allow" } } })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "In-flight budget boundary" })
          await SessionGoal.create({
            sessionID: session.id,
            objective: "Write accepted evidence",
            ...(kind === "time" ? { timeBudgetSeconds: 1 } : { tokenBudget: 10 }),
          })
          if (kind === "manual") process.env.AX_CODE_AUTONOMOUS = "0"
          if (kind === "already-limited")
            await SessionGoal.setStatus({ sessionID: session.id, status: "budget_limited" })
          if (kind === "time") {
            const addUsage = SessionGoal.addUsage
            usageSpy = vi.spyOn(SessionGoal, "addUsage").mockImplementation((input) =>
              addUsage({
                ...input,
                message: {
                  ...input.message,
                  time: { ...input.message.time, completed: input.message.time.created + 2000 },
                },
              }),
            )
          }
          if (kind === "read-failure") {
            const addUsage = SessionGoal.addUsage
            const getGoal = SessionGoal.get
            let failNextRead = false
            usageSpy = vi.spyOn(SessionGoal, "addUsage").mockImplementation(async (input) => {
              const goal = await addUsage(input)
              if (goal?.status === "budget_limited") failNextRead = true
              return goal
            })
            goalReadSpy = vi.spyOn(SessionGoal, "get").mockImplementation(async (id) => {
              if (failNextRead) {
                failNextRead = false
                throw new Error("Injected identity refresh failure")
              }
              return getGoal(id)
            })
          }
          modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
          const filePath = `${tmp.path}/accepted.txt`
          let streams = 0
          streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async (input: LLM.StreamInput) => {
            const turn = ++streams
            if (turn === 2 && kind !== "already-limited")
              expect(Object.keys(input.tools).filter((name) => name !== "invalid")).toEqual(["update_goal"])
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "start-step" }
                if (turn === 1) {
                  const args = { filePath, content: "Accepted before exhaustion" }
                  yield { type: "tool-call", toolCallId: "accepted-write", toolName: "write", input: args }
                  const output = await input.tools.write.execute!(args, {
                    toolCallId: "accepted-write",
                    messages: input.messages,
                    abortSignal: input.abort,
                  })
                  yield { type: "tool-result", toolCallId: "accepted-write", toolName: "write", input: args, output }
                  if (kind === "already-limited") {
                    yield { type: "text-start", id: "ordinary-answer" }
                    yield {
                      type: "text-delta",
                      id: "ordinary-answer",
                      text: "The independently requested evidence was written.",
                    }
                    yield { type: "text-end", id: "ordinary-answer" }
                  }
                } else {
                  yield { type: "text-start", id: "summary" }
                  yield {
                    type: "text-delta",
                    id: "summary",
                    text: "Budget reached; accepted write is durable and other work remains.",
                  }
                  yield { type: "text-end", id: "summary" }
                }
                yield {
                  type: "finish-step",
                  finishReason: kind === "already-limited" || turn > 1 ? "stop" : "tool-calls",
                  usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
                }
                yield { type: "finish" }
              })(),
            } as any
          }) as any)
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: model.providerID, modelID: model.id },
            parts: [{ type: "text", text: "Write evidence, then report" }],
          })
          expect(await readFile(filePath, "utf8")).toBe("Accepted before exhaustion")
          if (kind !== "already-limited") expect(streams).toBe(kind === "read-failure" ? 1 : 2)
          expect((await SessionGoal.get(session.id))?.status).toBe("budget_limited")
          const messages = await Session.messages({ sessionID: session.id })
          if (kind === "already-limited") {
            expect(
              messages.some((m) =>
                m.parts.some(
                  (p) => p.type === "text" && p.synthetic && p.text.includes("has reached its token budget"),
                ),
              ),
            ).toBe(false)
          }
          const tools = messages.flatMap((m) => m.parts).filter((p) => p.type === "tool")
          expect(tools).toHaveLength(1)
          expect(tools[0]).toMatchObject({ tool: "write", state: { status: "completed" } })
          await Session.remove(session.id)
        },
      })
    },
  )

  test.each(["first", "wrap-up", "missing-after-completion"] as const)(
    "structured budget output is retained at %s without false completion or recovery",
    async (mode) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Structured budget boundary" })
          await SessionGoal.create({ sessionID: session.id, objective: "Implement remaining work", tokenBudget: 10 })
          modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
          let streams = 0
          streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async (input: LLM.StreamInput) => {
            const turn = ++streams
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "start-step" }
                if (mode === "first" || (turn === 2 && mode === "wrap-up")) {
                  const args = { status: "partial-preserved" }
                  yield { type: "tool-call", toolCallId: "structured", toolName: "StructuredOutput", input: args }
                  const output = await input.tools.StructuredOutput.execute!(args, {
                    toolCallId: "structured",
                    messages: input.messages,
                  })
                  yield {
                    type: "tool-result",
                    toolCallId: "structured",
                    toolName: "StructuredOutput",
                    input: args,
                    output,
                  }
                } else {
                  if (turn === 2 && mode === "missing-after-completion")
                    await SessionGoal.setStatus({ sessionID: session.id, status: "complete" })
                  yield { type: "text-start", id: `text_${turn}` }
                  yield { type: "text-delta", id: `text_${turn}`, text: "Partial work remains." }
                  yield { type: "text-end", id: `text_${turn}` }
                }
                yield {
                  type: "finish-step",
                  finishReason: turn === 1 ? "tool-calls" : "stop",
                  usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
                }
                yield { type: "finish" }
              })(),
            } as any
          }) as any)
          const response = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: model.providerID, modelID: model.id },
            format: {
              type: "json_schema",
              retryCount: 0,
              schema: {
                type: "object",
                properties: { status: { type: "string" } },
                required: ["status"],
                additionalProperties: false,
              },
            },
            parts: [{ type: "text", text: "Implement and return the structured status" }],
          })
          expect(streams).toBe(mode === "first" ? 1 : 2)
          if (mode === "missing-after-completion")
            expect(response.info).toMatchObject({ error: { name: "StructuredOutputError" } })
          else {
            expect(response.info).toMatchObject({ structured: { status: "partial-preserved" } })
            expect((await SessionGoal.get(session.id))?.status).toBe("budget_limited")
          }
          await Session.remove(session.id)
        },
      })
    },
  )

  test("budget-limited goal schedules one wrap-up continuation", async () => {
    await using tmp = await tmpdir({ git: true, config: { session: { max_continuations: 2 } } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "summarize budgeted work",
          tokenBudget: 10,
        })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        let streams = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async () => {
          streams++
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: `text_${streams}` }
              yield { type: "text-delta", id: `text_${streams}`, text: streams === 1 ? "work" : "wrap up" }
              yield { type: "text-end", id: `text_${streams}` }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: {
                  inputTokens: 8,
                  outputTokens: 4,
                  totalTokens: 12,
                },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "start budgeted work" }],
        })

        expect(streamSpy?.mock.calls.length ?? 0).toBeGreaterThanOrEqual(2)
        expect((await SessionGoal.get(session.id))?.status).toBe("budget_limited")
        const messages = await Session.messages({ sessionID: session.id })
        const budgetContinuationCount = messages.filter((message) =>
          message.parts.some((part) => part.type === "text" && part.text.includes("has reached its token budget")),
        ).length
        expect(budgetContinuationCount).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("budget wrap-up still fires after the goal runs past maxContinuations", async () => {
    // Regression: active goals deliberately ignore the continuation cap, so a
    // long goal reaches budget exhaustion with `continuations` already past
    // maxContinuations. The single wrap-up turn must still fire — it previously
    // got a spurious "continuation limit reached" stop instead.
    await using tmp = await tmpdir({ git: true, config: { session: { max_continuations: 1 } } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // 12 tokens/turn, budget 25 → exhausts on turn 3, by which point the
        // active goal has already auto-continued twice (continuations = 2 > 1).
        await SessionGoal.create({
          sessionID: session.id,
          objective: "long goal that exhausts its budget",
          tokenBudget: 25,
        })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        let streams = 0
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async () => {
          streams++
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: `text_${streams}` }
              yield { type: "text-delta", id: `text_${streams}`, text: `turn ${streams}` }
              yield { type: "text-end", id: `text_${streams}` }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "start the long goal" }],
        })

        // The goal must end budget_limited and receive exactly one wrap-up turn,
        // even though continuations exceeded max_continuations (1) before the
        // budget was hit.
        expect(streamSpy?.mock.calls.length ?? 0).toBeGreaterThanOrEqual(3)
        expect((await SessionGoal.get(session.id))?.status).toBe("budget_limited")
        const messages = await Session.messages({ sessionID: session.id })
        const wrapUpCount = messages.filter((message) =>
          message.parts.some((part) => part.type === "text" && part.text.includes("has reached its token budget")),
        ).length
        expect(wrapUpCount).toBe(1)

        await Session.remove(session.id)
      },
    })
  })
})
