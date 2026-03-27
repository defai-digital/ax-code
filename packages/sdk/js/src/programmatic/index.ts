/**
 * ax-code Programmatic SDK
 *
 * Direct agent instantiation without HTTP server overhead.
 * 10-40x faster startup than spawning a server process.
 *
 * @example
 * ```typescript
 * import { createAgent } from "@ax-code/sdk/programmatic"
 *
 * const agent = await createAgent({ directory: process.cwd() })
 *
 * // One-shot
 * const result = await agent.run("Fix the login bug")
 * console.log(result.text)
 *
 * // Streaming
 * for await (const event of agent.stream("Explain this codebase")) {
 *   if (event.type === "text") process.stdout.write(event.text)
 * }
 *
 * // Multi-turn
 * const session = await agent.session()
 * await session.run("Read src/auth/index.ts")
 * await session.run("Now add input validation")
 *
 * // Cleanup
 * await agent.dispose()
 * ```
 */

export { createAgent } from "./agent.js"
export type {
  Agent,
  AgentOptions,
  AgentHooks,
  RunOptions,
  RunResult,
  StreamEvent,
  SessionHandle,
  ToolCallInfo,
  PermissionRequest,
} from "./types.js"
