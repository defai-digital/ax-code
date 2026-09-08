import { expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlan } from "../../src/session/goal-plan"
import type { GoalAssurance } from "../../src/session/goal-assurance"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { VerifyProjectTool } from "../../src/tool/verify_project"
import { UpdateGoalTool } from "../../src/tool/goal"
import type { Tool } from "../../src/tool/tool"
import { buildTurnContext } from "../../src/session/prompt-turn-context"
import * as SourceState from "../../src/quality/source-state"
import { tmpdir } from "../fixture/fixture"

const assurance: GoalAssurance.Contract = {
  version: 1,
  sourcePaths: ["logic.cjs", "check.cjs"],
  sources: [{ role: "legacy", reference: "legacy/schema.sql at fixture-v1" }],
  checks: [
    {
      id: "parity",
      acceptanceIds: ["AC1"],
      command: "node check.cjs parity",
      purpose: "Assert legacy field parity",
      environment: "local fixture",
    },
    {
      id: "database",
      acceptanceIds: ["AC1"],
      command: "node check.cjs database",
      purpose: "Assert target identity and trigger availability",
      environment: "target-staging schema ERP",
    },
  ],
}

function context(sessionID: SessionID, ask: Tool.Context["ask"] = async () => {}): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    ask,
  }
}

async function prepare(directory: string) {
  await fs.writeFile(path.join(directory, "logic.cjs"), "module.exports = ['ID', 'AMOUNT']\n")
  await fs.writeFile(
    path.join(directory, "check.cjs"),
    [
      "const assert = require('node:assert/strict')",
      "const fs = require('node:fs')",
      "if (process.argv[2] === 'parity') assert.deepEqual(require('./logic.cjs'), ['ID', 'AMOUNT'])",
      "else {",
      "  const state = JSON.parse(fs.readFileSync('.git/target-state.json', 'utf8'))",
      "  assert.equal(state.instance, 'target-staging')",
      "  assert.equal(state.triggerActive, true)",
      "}",
    ].join("\n"),
  )
  await fs.writeFile(
    path.join(directory, ".git/target-state.json"),
    JSON.stringify({ instance: "target-staging", triggerActive: true }),
  )
  const session = await Session.create({})
  const goal = await SessionGoal.create({ sessionID: session.id, objective: "Migrate the bounded invoice flow" })
  await GoalPlan.write(
    session.id,
    goal.time.created,
    GoalPlan.render({ ...GoalPlan.sample(goal.objective), assurance }),
  )
  return { session, goal }
}

async function record(
  sessionID: SessionID,
  directory: string,
  checkID: string,
  result: Pick<Tool.InvocationResult, "title" | "output" | "metadata">,
) {
  const messageID = MessageID.ascending()
  await Session.updateMessage({
    id: messageID,
    parentID: MessageID.ascending(),
    sessionID,
    role: "assistant",
    agent: "build",
    mode: "build",
    path: { cwd: directory, root: directory },
    modelID: "test" as ModelID,
    providerID: "test" as ProviderID,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now(), completed: Date.now() },
  } satisfies MessageV2.Assistant)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "tool",
    tool: "verify_project",
    callID: `call-${messageID}`,
    state: {
      status: "completed",
      input: { goalCheck: checkID },
      output: result.output,
      title: result.title,
      metadata: result.metadata,
      time: { start: Date.now(), end: Date.now() },
    },
  })
}

const complete = { status: "complete" as const, acceptanceEvidence: { AC1: "Checks prove the fixture acceptance" } }

test("a concurrent pause during source verification cannot be overwritten by completion", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session } = await prepare(tmp.path)
      const ctx = context(session.id)
      const verify = await VerifyProjectTool.init()
      for (const id of ["parity", "database"])
        await record(session.id, tmp.path, id, await verify.execute({ goalCheck: id }, ctx))
      const original = SourceState.currentSourceState
      const spy = vi.spyOn(SourceState, "currentSourceState").mockImplementationOnce(async (...args) => {
        const source = await original(...args)
        await SessionGoal.pause(session.id)
        return source
      })
      try {
        await expect((await UpdateGoalTool.init()).execute(complete, ctx)).rejects.toThrow(
          /goal changed during verification/,
        )
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")
      } finally {
        spy.mockRestore()
        await Session.remove(session.id)
      }
    },
  })
})

test("completion requires every actual check and rejects stale source after an unrecorded edit", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session } = await prepare(tmp.path)
      const ctx = context(session.id)
      const verify = await VerifyProjectTool.init()
      const update = await UpdateGoalTool.init()
      await expect(update.execute(complete, ctx)).rejects.toThrow(/parity, database/)
      for (const id of ["parity", "database"]) {
        const result = await verify.execute({ goalCheck: id }, ctx)
        expect(result.metadata.passed).toBe(true)
        await record(session.id, tmp.path, id, result)
        if (id === "parity") await expect(update.execute(complete, ctx)).rejects.toThrow(/database/)
      }
      // No edit/write tool event: reproduces shell, delegated and external edits.
      await fs.appendFile(path.join(tmp.path, "logic.cjs"), "// A subsequent edit\n")
      await expect(update.execute(complete, ctx)).rejects.toThrow(/current successful execution/)
      for (const id of ["parity", "database"]) {
        await record(session.id, tmp.path, id, await verify.execute({ goalCheck: id }, ctx))
      }
      await update.execute(complete, ctx)
      expect((await SessionGoal.get(session.id))?.status).toBe("complete")
      await Session.remove(session.id)
    },
  })
})

test("a later environment failure supersedes a pass even when source content is unchanged", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session } = await prepare(tmp.path)
      const ctx = context(session.id)
      const verify = await VerifyProjectTool.init()
      for (const id of ["parity", "database"])
        await record(session.id, tmp.path, id, await verify.execute({ goalCheck: id }, ctx))
      await fs.writeFile(
        path.join(tmp.path, ".git/target-state.json"),
        JSON.stringify({ instance: "wrong-instance", triggerActive: false }),
      )
      const failed = await verify.execute({ goalCheck: "database" }, ctx)
      expect(failed.metadata.passed).toBe(false)
      expect(failed.output).toContain("wrong-instance")
      await record(session.id, tmp.path, "database", failed)
      await expect((await UpdateGoalTool.init()).execute(complete, ctx)).rejects.toThrow(/database/)
      await Session.remove(session.id)
    },
  })
})

test("checks preserve permission denial and cannot override the frozen command", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session } = await prepare(tmp.path)
      const tool = await VerifyProjectTool.init()
      const ctx = context(session.id, async (request) => {
        expect(request.permission).toBe("bash")
        expect(request.patterns).toEqual(["node check.cjs parity"])
        throw new Error("Denied by fixture")
      })
      await expect(tool.execute({ goalCheck: "parity", commands: { test: "true" } }, ctx)).rejects.toThrow(
        /cannot be combined/,
      )
      await expect(tool.execute({ goalCheck: "unknown" }, ctx)).rejects.toThrow(/Unknown goal check/)
      await expect(tool.execute({ goalCheck: "parity" }, ctx)).rejects.toThrow(/Denied by fixture/)
      await Session.remove(session.id)
    },
  })
})

test("a source-mutating check cannot produce successful evidence", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session } = await prepare(tmp.path)
      await fs.appendFile(
        path.join(tmp.path, "check.cjs"),
        "\nfs.appendFileSync('logic.cjs', '// mutated by verification\\n')\n",
      )
      const result = await (await VerifyProjectTool.init()).execute({ goalCheck: "parity" }, context(session.id))
      expect(result.metadata.passed).toBe(false)
      expect(result.metadata.goalCheckReceipt?.exitCode).toBe(0)
      expect(result.output).toContain("Source changed during verification")
      await Session.remove(session.id)
    },
  })
})

test("a goal changed while awaiting permission prevents command execution", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session } = await prepare(tmp.path)
      const ctx = context(session.id, async () => {
        await SessionGoal.pause(session.id)
      })
      await expect((await VerifyProjectTool.init()).execute({ goalCheck: "parity" }, ctx)).rejects.toThrow(
        /changed while awaiting/,
      )
      await Session.remove(session.id)
    },
  })
})

test("cancelled goal checks never return a successful receipt", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session } = await prepare(tmp.path)
      const controller = new AbortController()
      const ctx = {
        ...context(session.id, async () => {
          controller.abort()
        }),
        abort: controller.signal,
      }
      await expect((await VerifyProjectTool.init()).execute({ goalCheck: "parity" }, ctx)).rejects.toThrow()
      await expect((await UpdateGoalTool.init()).execute(complete, context(session.id))).rejects.toThrow(
        /required checks/,
      )
      await Session.remove(session.id)
    },
  })
})

test("turn context reloads frozen authority after history loss and refuses tampered environment facts", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, goal } = await prepare(tmp.path)
      const build = () =>
        buildTurnContext({ sessionID: session.id, messages: [], decisionHints: async () => undefined })
      const text = await build()
      expect(text).toContain("legacy/schema.sql at fixture-v1")
      expect(text).toContain("target-staging schema ERP")
      expect(text).toContain("Required check database")
      const file = GoalPlan.pathFor(session.id, goal.time.created)
      await fs.writeFile(
        file,
        (await fs.readFile(file, "utf8")).replace("target-staging schema ERP", "untrusted-production"),
      )
      const changed = await build()
      expect(changed).toContain("Goal contract is invalid or changed")
      expect(changed).not.toContain("untrusted-production")
      await expect(
        (await VerifyProjectTool.init()).execute({ goalCheck: "database" }, context(session.id)),
      ).rejects.toThrow(/Restore/)
      await Session.remove(session.id)
    },
  })
})
