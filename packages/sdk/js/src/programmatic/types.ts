/**
 * Types for the ax-code Programmatic SDK
 */

// ============================================================
// Error Classes
// ============================================================

/** Base error class for all ax-code SDK errors */
export class AxCodeError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = "AxCodeError"
    this.code = code
  }
}

/** Provider API call failed (rate limit, auth, server error) */
export class ProviderError extends AxCodeError {
  readonly status?: number
  readonly provider?: string
  constructor(message: string, options?: { status?: number; provider?: string }) {
    super(message, "PROVIDER_ERROR")
    this.name = "ProviderError"
    this.status = options?.status
    this.provider = options?.provider
  }
  get isRetryable(): boolean {
    return this.status === 429 || (this.status !== undefined && this.status >= 500)
  }
}

/** Operation timed out */
export class TimeoutError extends AxCodeError {
  readonly timeout: number
  constructor(ms: number, operation?: string) {
    super(`${operation ?? "Operation"} timed out after ${ms}ms`, "TIMEOUT")
    this.name = "TimeoutError"
    this.timeout = ms
  }
}

/** Tool execution failed */
export class ToolError extends AxCodeError {
  readonly tool: string
  constructor(tool: string, message: string) {
    super(`Tool "${tool}" failed: ${message}`, "TOOL_ERROR")
    this.name = "ToolError"
    this.tool = tool
  }
}

/** Permission was denied */
export class PermissionError extends AxCodeError {
  readonly permission: string
  readonly patterns: string[]
  constructor(permission: string, patterns: string[] = []) {
    super(`Permission denied: ${permission} (${patterns.join(", ")})`, "PERMISSION_DENIED")
    this.name = "PermissionError"
    this.permission = permission
    this.patterns = patterns
  }
}

/** Agent not found */
export class AgentNotFoundError extends AxCodeError {
  readonly agent: string
  readonly available: string[]
  constructor(agent: string, available: string[] = []) {
    super(`Agent "${agent}" not found. Available: ${available.join(", ")}`, "AGENT_NOT_FOUND")
    this.name = "AgentNotFoundError"
    this.agent = agent
    this.available = available
  }
}

/** Agent has been disposed */
export class DisposedError extends AxCodeError {
  constructor() {
    super("Agent has been disposed. Create a new agent with createAgent().", "DISPOSED")
    this.name = "DisposedError"
  }
}

// ============================================================
// Options & Configuration
// ============================================================

export interface AgentOptions {
  /** Project directory to operate in */
  directory: string
  /** Provider ID (e.g., "xai", "google") */
  provider?: string
  /** Model ID (e.g., "grok-4", "gemini-2.5-pro") */
  model?: string
  /** Agent mode (e.g., "build", "security", "architect", "debug", "perf") */
  agent?: string
  /** Custom system prompt override */
  system?: string
  /** Provider variant (e.g., "high" for high-effort reasoning) */
  variant?: string
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Event hooks */
  hooks?: AgentHooks
  /** Maximum retries on transient provider errors (429, 500, network). Default: 0 */
  maxRetries?: number
  /** Timeout in ms for agent creation. Default: no timeout */
  timeout?: number
  /** Direct API key authentication (skips local config) */
  auth?: AuthConfig
}

export interface AuthConfig {
  /** Provider to authenticate with */
  provider: string
  /** API key */
  apiKey: string
}

export interface AgentHooks {
  /** Called before a tool is executed. Return false to block. */
  onToolCall?: (tool: string, input: unknown) => boolean | Promise<boolean>
  /** Called after a tool completes */
  onToolResult?: (tool: string, output: string) => void | Promise<void>
  /** Called when a permission is requested. Return "allow" or "deny". */
  onPermissionRequest?: (permission: PermissionRequest) => "allow" | "deny" | Promise<"allow" | "deny">
  /** Called on errors */
  onError?: (error: Error) => void
  /** Called on each retry attempt */
  onRetry?: (attempt: number, error: Error) => void
}

export interface PermissionRequest {
  id: string
  permission: string
  patterns: string[]
}

export interface RunOptions {
  /** Override model for this call */
  model?: { providerID: string; modelID: string }
  /** Override agent for this call */
  agent?: string
  /** Override variant for this call */
  variant?: string
  /** Abort signal */
  signal?: AbortSignal
  /** Timeout in milliseconds */
  timeout?: number
}

export interface RunResult {
  /** Final text response */
  text: string
  /** Which agent handled the request */
  agent: string
  /** Which model was used */
  model: { providerID: string; modelID: string }
  /** Token usage */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Tool calls made during execution */
  toolCalls: ToolCallInfo[]
  /** Session ID */
  sessionID: string
  /** Message ID */
  messageID: string
}

export interface ToolCallInfo {
  tool: string
  input: unknown
  output: string
  status: "completed" | "error"
  duration?: number
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool-call"; tool: string; input: unknown; id: string }
  | { type: "tool-result"; tool: string; output: string; id: string; status: "completed" | "error" }
  | { type: "reasoning"; text: string }
  | { type: "step-start"; index: number }
  | { type: "step-finish"; index: number }
  | { type: "error"; error: Error }
  | { type: "done"; result: RunResult }

// ============================================================
// Stream Handle (convenience wrapper)
// ============================================================

export interface StreamHandle extends AsyncIterable<StreamEvent> {
  /** Collect all text and return the final string */
  text(): Promise<string>
  /** Wait for completion and return the full result */
  result(): Promise<RunResult>
  /** Register an event callback. Returns self for chaining. */
  on(event: "text", callback: (text: string) => void): StreamHandle
  on(event: "tool-call", callback: (tool: string, input: unknown) => void): StreamHandle
  on(event: "tool-result", callback: (tool: string, output: string, status: string) => void): StreamHandle
  on(event: "reasoning", callback: (text: string) => void): StreamHandle
  on(event: "error", callback: (error: Error) => void): StreamHandle
  on(event: "done", callback: (result: RunResult) => void): StreamHandle
  /** Wait for the stream to complete (use after .on() callbacks) */
  done(): Promise<void>
}

// ============================================================
// Session & Agent interfaces
// ============================================================

export interface SessionHandle {
  /** Session ID */
  readonly id: string
  /** Send a prompt and get the final result */
  run(message: string, options?: RunOptions): Promise<RunResult>
  /** Send a prompt and stream events */
  stream(message: string, options?: RunOptions): StreamHandle
  /** Get all messages in this session */
  messages(): Promise<unknown[]>
  /** Fork this session into a new branch */
  fork(): Promise<SessionHandle>
  /** Abort the current execution */
  abort(): Promise<void>
}

export interface Agent {
  /** Send a prompt and get the final result (creates a new session) */
  run(message: string, options?: RunOptions): Promise<RunResult>
  /** Send a prompt and stream events (creates a new session) */
  stream(message: string, options?: RunOptions): StreamHandle
  /** Create a persistent session for multi-turn conversation */
  session(): Promise<SessionHandle>
  /** Execute a tool directly */
  tool(name: string, input: Record<string, unknown>): Promise<unknown>
  /** List available models (e.g., ["google/gemini-2.5-pro", "xai/grok-4"]) */
  models(): Promise<string[]>
  /** List available tool names (e.g., ["bash", "read", "write", "grep"]) */
  tools(): Promise<string[]>
  /** Dispose the agent and clean up resources */
  dispose(): Promise<void>
}
