/**
 * @ax-code/sdk — AI coding agent SDK
 *
 * The default export is the in-process agent. No HTTP server is
 * spawned — the agent runs directly in your Node.js process with
 * 10-40x faster startup than the server-based path.
 *
 * For GUI or app shell integrations, use:
 *   import { startHeadlessBackend } from "@ax-code/sdk/headless"
 *   import { createAxCodeGrpcClient } from "@ax-code/sdk/grpc"
 *
 * @example
 * ```ts
 * import { createAgent } from "@ax-code/sdk"
 *
 * const agent = await createAgent({ directory: "." })
 * for await (const event of agent.stream("What does src/index.ts do?")) {
 *   if (event.type === "text") process.stdout.write(event.text)
 * }
 * await agent.dispose()
 * ```
 */

// ── Core ─────────────────────────────────────────────────────────────
export { createAgent } from "./programmatic/agent.js"
export { tool } from "./programmatic/tool.js"

// ── Types ────────────────────────────────────────────────────────────
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
  SdkMessage,
  SdkMessagePart,
  ToolCallInfo,
  PermissionRequest,
  SdkTool,
} from "./programmatic/types.js"

// ── Errors ───────────────────────────────────────────────────────────
export {
  AxCodeError,
  ProviderError,
  TimeoutError,
  ToolError,
  PermissionError,
  AgentNotFoundError,
  DisposedError,
} from "./programmatic/types.js"

// ── Version ──────────────────────────────────────────────────────────
export { SDK_VERSION, isSDKVersionCompatible } from "./version.js"

// ── Generated route types ────────────────────────────────────────────
// Keep OpenAPI-derived types like `Project`, `Provider`, `Message`,
// and `Part` available from the top-level package for downstream type
// imports. HTTP client/server runtime values are intentionally not
// public SDK exports; use headless or gRPC/native for app integrations.
export type * from "./gen/types.gen.js"
