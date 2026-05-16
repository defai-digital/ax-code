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
 * // Streaming with convenience methods
 * const text = await agent.stream("Explain this codebase").text()
 *
 * // Streaming with callbacks
 * const stream = agent.stream("Explain this codebase")
 * stream.on("text", (t) => process.stdout.write(t))
 * await stream.done()
 *
 * // Multi-turn
 * const session = await agent.session()
 * await session.run("Read src/auth/index.ts")
 * await session.run("Now add input validation")
 *
 * // Direct API key (no local config needed)
 * const agent2 = await createAgent({
 *   directory: ".",
 *   auth: { provider: "xai", apiKey: "xai-abc123" },
 * })
 *
 * // Cleanup
 * await agent.dispose()
 * ```
 */

export { createAgent } from "./agent.js"
export { tool } from "./tool.js"
export type {
  Agent,
  AgentOptions,
  AgentHooks,
  AuthConfig,
  RunOptions,
  RunResult,
  StreamEvent,
  StreamHandle,
  SessionHandle,
  ToolCallInfo,
  PermissionRequest,
  SdkTool,
} from "./types.js"
export {
  AxCodeError,
  ProviderError,
  TimeoutError,
  ToolError,
  PermissionError,
  AgentNotFoundError,
  DisposedError,
} from "./types.js"
