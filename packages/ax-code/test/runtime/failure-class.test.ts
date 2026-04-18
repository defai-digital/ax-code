import { describe, expect, test } from "bun:test"
import { RuntimeFailureClass } from "../../src/runtime/failure-class"

describe("RuntimeFailureClass", () => {
  test("lists the expected failure classes in stable order", () => {
    expect(RuntimeFailureClass.list().map((item) => item.kind)).toEqual([
      "service_bootstrap",
      "event_queue_pressure",
      "focus_conflict",
      "render_loop",
      "transcript_projection",
      "renderer_input",
      "worker_stream",
    ])
  })

  test("returns metadata for a single failure class", () => {
    const item = RuntimeFailureClass.get("focus_conflict")

    expect(item.owner).toBe("tui.focus")
    expect(item.examples.length).toBeGreaterThan(0)
  })
})
