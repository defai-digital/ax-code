import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

const TodoWriteItem = Todo.Info.extend({
  reason: z
    .string()
    .optional()
    .describe("Why this item was cancelled. Stored in content; the todo table has no reason column."),
})

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(TodoWriteItem).describe("The updated todo list"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    // Echo the stored shape so the tool result matches what todoread returns.
    const todos = params.todos.map((todo) => Todo.absorbCancellationReason(todo))
    await Todo.update({
      sessionID: ctx.sessionID,
      todos,
    })
    return {
      title: `${Todo.countActive(todos)} todos`,
      output: JSON.stringify(todos, null, 2),
      metadata: {
        todos,
      },
    }
  },
})

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your todo list",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const todos = await Todo.get(ctx.sessionID)
    return {
      title: `${Todo.countActive(todos)} todos`,
      metadata: {
        todos,
      },
      output: JSON.stringify(todos, null, 2),
    }
  },
})
