import { describe, expect, test } from "vitest"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"

describe("workflowEffortToRequestedDepth", () => {
  test("normal effort returns undefined (preserves auto policy)", () => {
    expect(TaskQueueExecutor.workflowEffortToRequestedDepth("normal")).toBeUndefined()
  })

  test("workflow effort maps to standard depth", () => {
    expect(TaskQueueExecutor.workflowEffortToRequestedDepth("workflow")).toBe("standard")
  })

  test("deep effort maps to deep depth", () => {
    expect(TaskQueueExecutor.workflowEffortToRequestedDepth("deep")).toBe("deep")
  })

  test("max-workflow effort maps to xdeep depth", () => {
    expect(TaskQueueExecutor.workflowEffortToRequestedDepth("max-workflow")).toBe("xdeep")
  })

  test("unknown effort returns undefined", () => {
    expect(TaskQueueExecutor.workflowEffortToRequestedDepth("unknown")).toBeUndefined()
    expect(TaskQueueExecutor.workflowEffortToRequestedDepth("")).toBeUndefined()
    expect(TaskQueueExecutor.workflowEffortToRequestedDepth("fast")).toBeUndefined()
  })
})
