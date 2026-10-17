import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./execute.txt"
import { execute } from "../codemode/interpreter"
import { createToolBarrier, dispatchToolPart } from "./nested-dispatch"

export const CODE_MODE_EXCLUDED = new Set([
  "execute",
  "batch",
  "read_recipe",
  "task",
  "task_parallel",
  "council",
  "arena",
  "browser_workflow",
  // Interactive or agent-switching tools wait on the user, which the program's wall-clock budget would abort.
  "question",
  "plan_exit",
  "invalid",
])
export function codeModeToolIDs(ids: readonly string[]) {
  return ids.filter((id) => !CODE_MODE_EXCLUDED.has(id))
}
export const ExecuteTool = Tool.define("execute", async () => ({
  description: DESCRIPTION,
  parameters: z.object({
    code: z.string().describe("JavaScript subset program; final expression or return is the result"),
  }),
  async execute({ code }, ctx) {
    const { Config } = await import("../config/config")
    const config = (await Config.get()).code_mode
    if (config?.enabled !== true) throw new Error("Code Mode is disabled")
    const dispatcher = ctx.extra?.toolDispatcher as Tool.Dispatcher | undefined
    if (!dispatcher) throw new Error("Code Mode requires the session's scoped tool dispatcher")
    const ids = codeModeToolIDs(dispatcher.ids)
    const schedule = createToolBarrier(dispatcher)
    const result = await execute(code, {
      limits: config,
      signal: ctx.abort,
      clock: Date.now,
      tools: ids,
      dispatch: (id, parameters, signal) =>
        schedule({ tool: id, parameters }, async () => {
          signal.throwIfAborted()
          return dispatchToolPart({
            ctx: { ...ctx, abort: signal },
            tool: id,
            parameters,
            run: (callID) => dispatcher.execute({ tool: id, parameters, callID, abort: signal }),
          })
        }),
    })
    // Already byte-bounded JSON: generic text truncation would invalidate it.
    return { title: "Code Mode", output: result.output, metadata: { ...result.metadata, truncated: false } }
  },
}))
