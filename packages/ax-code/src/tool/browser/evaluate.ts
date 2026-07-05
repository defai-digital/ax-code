import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./browser-evaluate.txt"
import { BrowserRuntime } from "./runtime"

export const BrowserEvaluateTool = Tool.define("browser_evaluate", {
  description: DESCRIPTION,
  parameters: z.object({
    function: z
      .string()
      .describe(
        'A JavaScript function declaration to evaluate in the page. Example: "() => document.title" or "(el) => el.innerText"',
      ),
    args: z
      .array(z.object({ uid: z.string().describe("Element UID from the latest snapshot") }))
      .optional()
      .describe("Arguments to pass to the function (elements referenced by UID)"),
  }),
  async execute(params, ctx) {
    const runtime = BrowserRuntime.get()
    const result = await runtime.evaluate("latest", params.function, params.args)

    return {
      title: "Evaluate result",
      output: JSON.stringify(result, null, 2) ?? "undefined",
      metadata: {
        function: params.function,
        args: params.args,
      },
    }
  },
})
