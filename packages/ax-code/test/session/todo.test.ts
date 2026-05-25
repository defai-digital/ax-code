import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Todo } from "../../src/session/todo"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

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

  test("returns only active todos in persisted order", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Todo active test" })
        Todo.update({
          sessionID: session.id,
          todos: [
            { content: "A", status: "completed", priority: "high" },
            { content: "B", status: "pending", priority: "medium" },
            { content: "C", status: "cancelled", priority: "low" },
            { content: "D", status: "in_progress", priority: "high" },
          ],
        })

        expect(Todo.active(session.id)).toEqual([
          { content: "B", status: "pending", priority: "medium" },
          { content: "D", status: "in_progress", priority: "high" },
        ])
      },
    })
  })
})
