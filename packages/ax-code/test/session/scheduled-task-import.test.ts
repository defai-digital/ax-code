import { expect, test } from "vitest"

test("scheduled-task can initialize before the session and tool registries", async () => {
  const { ScheduledTask } = await import("../../src/session/scheduled-task")
  expect(ScheduledTask.CatchUpPolicy).toBeDefined()

  const { ManageScheduledTaskTool } = await import("../../src/tool/schedule")
  expect(ManageScheduledTaskTool.id).toBe("manage_scheduled_task")
  const tool = await ManageScheduledTaskTool.init()
  expect(tool.parameters).toBeDefined()
})
