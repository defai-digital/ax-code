import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { goalProgress } from "../../src/session/goal-progress"
import { goalWindowMessages } from "../../src/session/prompt/prompt-loop-messages"
import { MessageID, type SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

async function seed(
  sessionID: SessionID,
  directory: string,
  role: "user" | "assistant",
  created: number,
  completed?: number,
) {
  const id = MessageID.ascending()
  if (role === "user") {
    await Session.updateMessage({
      id,
      sessionID,
      role: "user",
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      time: { created },
    } as any)
    return id
  }
  await Session.updateMessage({
    id,
    parentID: MessageID.ascending(),
    sessionID,
    role: "assistant",
    agent: "build",
    mode: "build",
    path: { cwd: directory, root: directory },
    modelID: "test",
    providerID: "test",
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: completed === undefined ? { created } : { created, completed },
  } as any)
  return id
}

describe("goalWindowMessages", () => {
  test("stops at the first assistant turn that completed before the goal and keeps everything newer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        try {
          const since = 1_000
          await seed(session.id, tmp.path, "user", 100)
          await seed(session.id, tmp.path, "assistant", 110, 200)
          await seed(session.id, tmp.path, "user", 300)
          const beforeGoal = await seed(session.id, tmp.path, "assistant", 310, 400)
          await seed(session.id, tmp.path, "user", 900)
          // Started before the goal, finished after it (create_goal then edit in one turn).
          const straddling = await seed(session.id, tmp.path, "assistant", 910, 1_200)
          const aborted = await seed(session.id, tmp.path, "assistant", 1_300)
          const latest = await seed(session.id, tmp.path, "assistant", 1_400, 1_500)

          const all = await Session.messages({ sessionID: session.id })
          const window = await goalWindowMessages(session.id, since)

          expect(window.map((m) => m.info.id)).toEqual(all.slice(4).map((m) => m.info.id))
          expect(window.map((m) => m.info.id)).toContain(straddling)
          expect(window.map((m) => m.info.id)).toContain(aborted)
          expect(window.at(-1)?.info.id).toBe(latest)
          expect(window.map((m) => m.info.id)).not.toContain(beforeGoal)
          expect(goalProgress(window, since)).toEqual(goalProgress(all, since))
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })
})
