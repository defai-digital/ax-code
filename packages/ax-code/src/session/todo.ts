import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import z from "zod"
import { Database, eq, asc } from "../storage/db"
import { TodoTable } from "./session.sql"
import { isActiveTodoStatus, isActiveTodo } from "./todo-status"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      priority: z.enum(["high", "medium", "low"]),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export function formatLines(
    todos: readonly { status: string; content: string }[],
    options?: {
      prefix?: string
      statusTransform?: (status: string) => string
    },
  ) {
    const prefix = options?.prefix ?? "- "
    const statusTransform = options?.statusTransform ?? ((status: string) => status)
    return todos.map((todo) => `${prefix}[${statusTransform(todo.status)}] ${todo.content}`)
  }

  export function isActive(todo: Pick<Info, "status">) {
    return isActiveTodo(todo)
  }

  export function countActive(todos: readonly { status?: unknown }[]) {
    return todos.filter((todo) => isActiveTodoStatus(todo.status)).length
  }

  export function formatCheckboxLines(todos: readonly { status: string; content: string }[]) {
    return formatLines(todos, {
      prefix: "",
      statusTransform: (status) => (status === "completed" ? "x" : " "),
    })
  }

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: SessionID.zod,
        todos: z.array(Info),
      }),
    ),
  }

  export function update(input: { sessionID: SessionID; todos: Info[] }) {
    Database.transaction((db) => {
      db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
      if (input.todos.length === 0) return
      db.insert(TodoTable)
        .values(
          input.todos.map((todo, position) => ({
            session_id: input.sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            position,
          })),
        )
        .run()
    })
    Bus.publishDetached(Event.Updated, input)
  }

  export function get(sessionID: SessionID): Info[] {
    const rows = Database.use((db) =>
      db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
    )
    return rows.map((row) =>
      Info.parse({
        content: row.content,
        status: row.status,
        priority: row.priority,
      }),
    )
  }

  export function active(sessionID: SessionID) {
    return get(sessionID).filter(isActive)
  }
}
