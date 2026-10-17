import type {
  Event,
  Project,
  Model,
  Provider,
  PermissionRequest,
  UserMessage,
  Message,
  Part,
  Auth,
  Config,
} from "@ax-code/sdk"
import type { AxCodeClient } from "@ax-code/sdk/v2"

import type { BunShell } from "./shell.js"
import { type ToolDefinition } from "./tool.js"

export * from "./tool.js"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type PluginHookContext = {
  /** Cooperative cancellation for this callback's deadline or plugin disposal. */
  signal: AbortSignal
}

export type PluginLifecycle = {
  /** Aborted when the plugin is retired or its workspace instance is disposed. */
  signal: AbortSignal
  /** Register cleanup; the returned function unregisters this registration. */
  onDispose(cleanup: () => void | Promise<void>): () => void
}

export type PluginInput = {
  client: AxCodeClient
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
  /** Supplied by current hosts. Optional for compatibility with older hosts. */
  lifecycle?: PluginLifecycle
  /**
   * Optional host capability for permission assertion, session administration,
   * and dialog selection. Hosts that do not supply it leave the field
   * undefined; plugins must check before calling.
   *
   * Every call is subject to the host's plugin callback deadline (15s) and
   * must not throw into the host — failures return `{ ok: false, error }`.
   * Inputs are detached from runtime state via the host's plain-data draft
   * helper before being handed to plugin code.
   */
  permission?: PluginPermissionAPI
  session?: PluginSessionAPI
}

export type PluginPermissionAskResult = { ok: true; status: "allow" | "deny" } | { ok: false; error: string }

export type PluginPermissionAPI = {
  /**
   * Ask the host to evaluate a permission request. The host runs the same
   * ruleset + interactive flow a tool would, and returns the final decision.
   * Plugins must check the result; a `deny` here blocks the host's own
   * tool call but does not undo side effects the plugin has already taken.
   */
  ask(input: {
    permission: string
    patterns: string[]
    metadata?: Record<string, unknown>
  }): Promise<PluginPermissionAskResult>
}

export type PluginSessionCreateResult = { ok: true; sessionID: string } | { ok: false; error: string }

export type PluginSessionTargetResult = { ok: true } | { ok: false; error: string }

export type PluginSessionAPI = {
  /**
   * Create a new session in the host project. The returned sessionID is
   * owned by the calling plugin and the host records that ownership so the
   * compact/remove calls below are scoped to it.
   */
  create(input: { parentID?: string; title?: string }): Promise<PluginSessionCreateResult>
  /** Compact the named session. Refused for sessions the plugin does not own. */
  compact(sessionID: string): Promise<PluginSessionTargetResult>
  /** Remove the named session. Refused for sessions the plugin does not own. */
  remove(sessionID: string): Promise<PluginSessionTargetResult>
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

type Rule = {
  key: string
  op: "eq" | "neq"
  value: string
}

export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOAuthResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}

export type AuthOAuthResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(signal?: AbortSignal): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
  | {
      method: "code"
      callback(code: string): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
)

/** @deprecated Misspelled alias kept for compatibility; use {@link AuthOAuthResult}. */
export type AuthOuathResult = AuthOAuthResult

export interface Hooks {
  event?: (input: { event: Event }, context?: PluginHookContext) => Promise<void>
  config?: (input: Config, context?: PluginHookContext) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  auth?: AuthHook
  /**
   * Called when a new message is received
   */
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
    context?: PluginHookContext,
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
    context?: PluginHookContext,
  ) => Promise<void>
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
    context?: PluginHookContext,
  ) => Promise<void>
  "permission.ask"?: (
    input: PermissionRequest,
    output: { status: "ask" | "deny" | "allow" },
    context?: PluginHookContext,
  ) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
    context?: PluginHookContext,
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
    context?: PluginHookContext,
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
    context?: PluginHookContext,
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      metadata: any
    },
    context?: PluginHookContext,
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
    context?: PluginHookContext,
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: {
      system: string[]
    },
    context?: PluginHookContext,
  ) => Promise<void>
  /**
   * Called before session compaction starts. Allows plugins to customize
   * the compaction prompt.
   *
   * - `context`: Additional context strings appended to the default prompt
   * - `prompt`: If set, replaces the default compaction prompt entirely
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
    context?: PluginHookContext,
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
    context?: PluginHookContext,
  ) => Promise<void>
  /**
   * Modify tool definitions (description and parameters) sent to LLM
   */
  "tool.definition"?: (
    input: { toolID: string },
    output: { description: string; parameters: any },
    context?: PluginHookContext,
  ) => Promise<void>
}
