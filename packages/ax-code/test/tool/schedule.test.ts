import { describe, expect, test } from "vitest"
import z from "zod"
// Load the session module graph before the tool module: tool/schedule →
// session/scheduled-task → task-queue participates in an import cycle with
// server routes that only resolves when the session side loads first (the
// same anchor order test/tool/goal.test.ts establishes via its Session
// import).
import "../../src/session"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { MessageID } from "../../src/session/schema"
import { ListScheduledTasksTool, ManageScheduledTaskTool, ScheduleTaskTool } from "../../src/tool/schedule"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// Conversational scheduling tools (PRD-2026-07-25 G1b): a thin surface over
// the existing ScheduledTask engine. The round-trip below exercises the
// real engine (validation, persistence, nextRunAt computation) through the
// tool layer only.

function toolContext(sessionID: string) {
  return {
    sessionID: sessionID as never,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    extra: {},
    metadata() {},
    async ask() {},
  } as never
}

describe("schedule tools", () => {
  test("schedule parameter accepts every schedule shape and rejects garbage", async () => {
    const tool = await ScheduleTaskTool.init()
    const base = { title: "t", prompt: "p" }

    expect(() =>
      tool.parameters.parse({ ...base, schedule: { type: "once", runAt: Date.now() + 60_000 } }),
    ).not.toThrow()
    expect(() => tool.parameters.parse({ ...base, schedule: { type: "daily", time: "09:00" } })).not.toThrow()
    expect(() =>
      tool.parameters.parse({ ...base, schedule: { type: "weekly", day: 1, time: "09:00", timezone: "Asia/Taipei" } }),
    ).not.toThrow()
    expect(() =>
      tool.parameters.parse({ ...base, schedule: { type: "cron", expression: "0 9 * * 1-5" } }),
    ).not.toThrow()

    expect(() => tool.parameters.parse({ ...base, schedule: { type: "sometime" } })).toThrow()
    expect(() => tool.parameters.parse({ ...base, schedule: { type: "weekly", day: 9, time: "09:00" } })).toThrow()
  })

  test("schedule coercion preserves the provider-facing object schema", async () => {
    const tool = await ScheduleTaskTool.init()
    const schema = z.toJSONSchema(tool.parameters) as {
      properties?: { schedule?: { oneOf?: Array<{ type?: string }> } }
    }
    expect(schema.properties?.schedule?.oneOf).toHaveLength(4)
    expect(schema.properties?.schedule?.oneOf?.every((item) => item.type === "object")).toBe(true)
  })

  test("schedule passed as a JSON-encoded string is coerced into an object", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = toolContext("ses_schedule_stringified")
        const create = await ScheduleTaskTool.init()
        const list = await ListScheduledTasksTool.init()

        // Some providers/models serialize nested object arguments as JSON
        // strings; the tool must coerce them back into objects.
        const runAt = Date.now() + 60 * 60 * 1000
        const created = await create.execute(
          {
            title: "Stringified schedule",
            prompt: "Check the deployment dashboard and report anything unhealthy.",
            schedule: JSON.stringify({ type: "once", runAt }),
          } as never,
          ctx,
        )
        const createdTask = (created.metadata as { task: { id: string; status: string; schedule: unknown } }).task
        expect(createdTask.status).toBe("active")
        expect(createdTask.schedule).toEqual({ type: "once", runAt })

        const listed = await list.execute({}, ctx)
        expect((listed.metadata as { count: number }).count).toBe(1)
        expect(listed.output).toContain("Stringified schedule")
      },
    })
  })

  test("malformed JSON schedule string fails with a readable error", async () => {
    const create = await ScheduleTaskTool.init()
    expect(() => create.parameters.parse({ title: "t", prompt: "p", schedule: '{"type": "once", "runAt":' })).toThrow(
      /JSON-encoded/,
    )
    await expect(
      create.execute({ title: "t", prompt: "p", schedule: "not json at all" } as never, toolContext("ses_bad_json")),
    ).rejects.toThrow(/JSON-encoded/)
  })

  test("create, list, pause, resume, and delete round-trip through the engine", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = toolContext("ses_schedule_tools")
        const create = await ScheduleTaskTool.init()
        const list = await ListScheduledTasksTool.init()
        const manage = await ManageScheduledTaskTool.init()

        const created = await create.execute(
          {
            title: "Deployment reminder",
            prompt: "Check the deployment dashboard and report anything unhealthy.",
            schedule: { type: "once", runAt: Date.now() + 60 * 60 * 1000 },
          },
          ctx,
        )
        const createdTask = (created.metadata as { task: { id: string; status: string; nextRunAt?: number } }).task
        expect(createdTask.status).toBe("active")
        expect(createdTask.nextRunAt).toBeGreaterThan(Date.now())

        const listed = await list.execute({ status: "active" }, ctx)
        expect((listed.metadata as { count: number }).count).toBe(1)
        expect(listed.output).toContain("Deployment reminder")

        const paused = await manage.execute({ id: createdTask.id, action: "pause" }, ctx)
        expect((paused.metadata as { task: { status: string } }).task.status).toBe("paused")

        const resumed = await manage.execute({ id: createdTask.id, action: "resume" }, ctx)
        expect((resumed.metadata as { task: { status: string } }).task.status).toBe("active")

        const deleted = await manage.execute({ id: createdTask.id, action: "delete" }, ctx)
        expect((deleted.metadata as { deleted: string }).deleted).toBe(createdTask.id)

        const after = await list.execute({}, ctx)
        expect((after.metadata as { count: number }).count).toBe(0)
      },
    })
  })

  test("invalid schedules surface the engine's validation error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = toolContext("ses_schedule_invalid")
        const create = await ScheduleTaskTool.init()
        await expect(
          create.execute(
            {
              title: "Bad tz",
              prompt: "never",
              schedule: { type: "daily", time: "09:00", timezone: "Not/AZone" },
            },
            ctx,
          ),
        ).rejects.toThrow(/timezone/i)
      },
    })
  })
})
