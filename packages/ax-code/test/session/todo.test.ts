import { describe, expect, test } from "bun:test"
import { Todo } from "../../src/session/todo"

describe("session.todo", () => {
  test("accepts only documented status and priority values", () => {
    expect(
      Todo.Info.safeParse({
        content: "Ship release",
        status: "completed",
        priority: "high",
      }).success,
    ).toBe(true)

    expect(
      Todo.Info.safeParse({
        content: "Ship release",
        status: "done",
        priority: "urgent",
      }).success,
    ).toBe(false)
  })
})
