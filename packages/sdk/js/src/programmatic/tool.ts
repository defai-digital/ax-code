import type { SdkTool } from "./types.js"

/**
 * Define a custom tool that the agent can invoke during its loop.
 *
 * The `parameters` field accepts a Zod schema. The `execute` function
 * receives a typed argument matching that schema and returns any
 * JSON-serializable value — the runtime stringifies it for the LLM.
 *
 * @example
 * ```ts
 * import { createAgent, tool } from "@ax-code/sdk"
 * import { z } from "zod"
 *
 * const deploy = tool({
 *   name: "deploy_staging",
 *   description: "Deploy the current branch to staging",
 *   parameters: z.object({
 *     service: z.enum(["api", "web", "worker"]),
 *     skipTests: z.boolean().default(false),
 *   }),
 *   execute: async ({ service, skipTests }) => {
 *     // your code runs here
 *     return { url: `https://staging.example.com/${service}` }
 *   },
 * })
 *
 * const agent = await createAgent({
 *   directory: "/repo",
 *   tools: [deploy],
 * })
 * ```
 */
export function tool<I>(definition: {
  /** Unique tool name. Must be alphanumeric + underscores (a-z, 0-9, _). */
  name: string
  /** One-line description shown to the LLM to decide when to use this tool. */
  description: string
  /** Zod schema for the tool's input. The `execute` arg type is inferred from this. */
  parameters: { parse: (input: unknown) => I; _input?: I }
  /** Implementation. Receives the validated, typed input. Return value is
   *  JSON-stringified and sent back to the LLM as the tool result. */
  execute: (input: I) => unknown | Promise<unknown>
}): SdkTool<I> {
  return {
    __brand: "SdkTool" as const,
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    execute: definition.execute,
  }
}
