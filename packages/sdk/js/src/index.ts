/**
 * @ax-code/sdk — AI coding agent SDK
 *
 * The default export is the in-process agent. No HTTP server is
 * spawned — the agent runs directly in your Node.js process with
 * 10-40x faster startup than the server-based path.
 *
 * For the HTTP-server-based client (the default in 1.4.0), use:
 *   import { createAxCode } from "@ax-code/sdk/http"
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

// ── Backward-compatible re-exports ───────────────────────────────────
// The 1.4.0 top-level export included the HTTP client factory and
// all the generated v2 types. Plugin packages and downstream consumers
// import types like `Project`, `Provider`, `Message`, `Part` etc.
// from `@ax-code/sdk`. Keep those accessible so the migration from
// 1.4.0 → 2.0.0 doesn't break type imports — the only breaking
// change is that the _default function_ moved from `createAxCode` to
// `createAgent`.
export * from "./client.js"
export * from "./server.js"
