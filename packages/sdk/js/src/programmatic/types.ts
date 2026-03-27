/**
 * Types for the Programmatic SDK
 */

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

export interface SessionHandle {
  /** Session ID */
  readonly id: string
  /** Send a prompt and get the final result */
  run(message: string, options?: RunOptions): Promise<RunResult>
  /** Send a prompt and stream events */
  stream(message: string, options?: RunOptions): AsyncIterable<StreamEvent>
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
  stream(message: string, options?: RunOptions): AsyncIterable<StreamEvent>
  /** Create a persistent session for multi-turn conversation */
  session(): Promise<SessionHandle>
  /** Execute a tool directly */
  tool(name: string, input: Record<string, unknown>): Promise<unknown>
  /** Dispose the agent and clean up resources */
  dispose(): Promise<void>
}
