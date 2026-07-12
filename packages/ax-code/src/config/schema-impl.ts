import z from "zod"
import { isRecord } from "@/util/record"
import { ModelsDev } from "../provider/models"
import { Log } from "../util/log"
import { LSPServer } from "../lsp/server"
import { GITHUB_REPO_URL as REPO_URL } from "@/constants/project"

const MODEL_SCHEMA_URL = "https://models.dev/model-schema.json#/$defs/Model"
const MCP_TIMEOUT_MS = 5000
const MCP_TIMEOUT_SECONDS = MCP_TIMEOUT_MS / 1000
const PROVIDER_TIMEOUT_MS = 300_000
const PROVIDER_TIMEOUT_MINUTES = 5
const TCP_PORT_MAX = 65_535
const RFC_DYNAMIC_CLIENT_REGISTRATION = "RFC 7591"

const ModelId = z.string().meta({ $ref: MODEL_SCHEMA_URL })
const SafeInteger = z.number().int().refine(Number.isSafeInteger, "must be a safe integer")
const PositiveInteger = SafeInteger.positive()
const NonNegativeInteger = SafeInteger.min(0)
const McpLocalCommand = z
  .array(z.string())
  .min(1, "Command must include an executable")
  .refine((command) => command[0]?.trim().length > 0, {
    message: "Command executable must be a non-empty string",
    path: [0],
  })
const McpRemoteUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value)
      return url.protocol === "http:" || url.protocol === "https:"
    } catch {
      return false
    }
  },
  { message: "Remote MCP URL must be a valid HTTP(S) URL" },
)

const McpTimeout = PositiveInteger.optional().describe(
  `Timeout in ms for MCP server requests. Defaults to ${MCP_TIMEOUT_MS} (${MCP_TIMEOUT_SECONDS} seconds) if not specified.`,
)

export const McpLocal = z
  .object({
    type: z.literal("local").describe("Type of MCP server connection"),
    command: McpLocalCommand.describe("Command and arguments to run the MCP server"),
    environment: z
      .record(z.string(), z.string())
      .optional()
      .describe("Environment variables to set when running the MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
    timeout: McpTimeout,
  })
  .strict()
  .meta({
    ref: "McpLocalConfig",
  })

export const McpOAuth = z
  .object({
    clientId: z
      .string()
      .optional()
      .describe(
        `OAuth client ID. If not provided, dynamic client registration (${RFC_DYNAMIC_CLIENT_REGISTRATION}) will be attempted.`,
      ),
    clientSecret: z.string().optional().describe("OAuth client secret (if required by the authorization server)"),
    scope: z.string().optional().describe("OAuth scopes to request during authorization"),
  })
  .strict()
  .meta({
    ref: "McpOAuthConfig",
  })
export type McpOAuth = z.infer<typeof McpOAuth>

export const McpRemote = z
  .object({
    type: z.literal("remote").describe("Type of MCP server connection"),
    url: McpRemoteUrl.describe("URL of the remote MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
    headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
    oauth: z
      .union([McpOAuth, z.literal(false)])
      .optional()
      .describe("OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection."),
    timeout: McpTimeout,
  })
  .strict()
  .meta({
    ref: "McpRemoteConfig",
  })

export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote]).describe(
  // The permission system identifies each MCP tool by `<server>_<tool>`
  // (non-alphanumeric chars in either are replaced with `_`). Use that
  // form — with wildcards if you like — in the top-level `permission`
  // map to allow / deny MCP tools, e.g.
  //   { "permission": { "github_*": "deny", "github_search_repos": "allow" } }
  // The same rule shape works inside `agent.<name>.permission` to scope
  // MCP tools per agent.
  "MCP server config. Tools surface as permission keys `<server>_<tool>` — use the top-level `permission` map (with wildcards) to allow / deny them, or scope them per agent via `agent.<name>.permission`.",
)
export type Mcp = z.infer<typeof Mcp>

export const PermissionAction = z.enum(["ask", "allow", "deny"]).meta({
  ref: "PermissionActionConfig",
})
export type PermissionAction = z.infer<typeof PermissionAction>

export const PermissionObject = z.record(z.string(), PermissionAction).meta({
  ref: "PermissionObjectConfig",
})
export type PermissionObject = z.infer<typeof PermissionObject>

export const PermissionRule = z.union([PermissionAction, PermissionObject]).meta({
  ref: "PermissionRuleConfig",
})
export type PermissionRule = z.infer<typeof PermissionRule>

// Capture original key order before zod reorders, then rebuild in original order
const permissionPreprocess = (val: unknown) => {
  if (isRecord(val)) {
    return { __originalKeys: Object.keys(val), ...val }
  }
  return val
}

const permissionTransform = (x: unknown): Record<string, PermissionRule> => {
  if (typeof x === "string") return { "*": x as PermissionAction }
  const obj = x as { __originalKeys?: string[] } & Record<string, unknown>
  const { __originalKeys, ...rest } = obj
  if (!__originalKeys) return rest as Record<string, PermissionRule>
  const result: Record<string, PermissionRule> = {}
  for (const key of __originalKeys) {
    if (key in rest) result[key] = rest[key] as PermissionRule
  }
  return result
}

export const IsolationMode = z.enum(["read-only", "workspace-write", "full-access"]).meta({
  ref: "IsolationMode",
})
export type IsolationMode = z.infer<typeof IsolationMode>

export const IsolationBackend = z.enum(["app", "os", "auto"]).meta({
  ref: "IsolationBackend",
})
export type IsolationBackend = z.infer<typeof IsolationBackend>

export const Isolation = z
  .object({
    mode: IsolationMode.default("workspace-write").describe(
      "Isolation mode: read-only blocks all mutations, workspace-write allows writes inside workspace only, full-access disables isolation",
    ),
    network: z
      .boolean()
      .default(false)
      .describe("Allow network access from tools. Defaults to false in read-only and workspace-write modes"),
    protected: z
      .array(z.string())
      .optional()
      .describe(
        "Additional paths relative to workspace root that are protected from writes. .git and .ax-code are always protected",
      ),
    // Optional in config input; Isolation.resolve / OsSandbox.resolveBackend
    // default to "app". Using .default() would make z.infer require backend on
    // every hand-written config object (routes, tests, partial updates).
    backend: IsolationBackend.optional().describe(
      "Isolation enforcement backend: app (portable tool checks, default), os (kernel sandbox for bash when available), auto (prefer os with app fallback)",
    ),
  })
  .strict()
  .meta({ ref: "IsolationConfig" })
// Config objects are written partially; defaults apply at resolve/parse time.
// z.input keeps mode/network/backend optional for callers that only set what they change.
export type Isolation = z.input<typeof Isolation>

export const Permission = z
  .preprocess(
    permissionPreprocess,
    z
      .object({
        __originalKeys: z.string().array().optional(),
        read: PermissionRule.optional(),
        edit: PermissionRule.optional(),
        glob: PermissionRule.optional(),
        grep: PermissionRule.optional(),
        list: PermissionRule.optional(),
        bash: PermissionRule.optional(),
        task: PermissionRule.optional(),
        external_directory: PermissionRule.optional(),
        todowrite: PermissionAction.optional(),
        todoread: PermissionAction.optional(),
        question: PermissionAction.optional(),
        webfetch: PermissionAction.optional(),
        websearch: PermissionAction.optional(),
        codesearch: PermissionAction.optional(),
        lsp: PermissionRule.optional(),
        doom_loop: PermissionAction.optional(),
        skill: PermissionRule.optional(),
      })
      .catchall(PermissionRule)
      .or(PermissionAction),
  )
  .transform(permissionTransform)
  .meta({
    ref: "PermissionConfig",
  })
export type Permission = z.infer<typeof Permission>

export const Command = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: ModelId.optional(),
  subtask: z.boolean().optional(),
  workflow: z.string().optional(),
  location: z.string().optional(),
  sourceTool: z.enum(["ax-code", "agents", "opencode", "claude", "builtin", "config"]).optional(),
  scope: z.enum(["project", "user", "config"]).optional(),
  warnings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        severity: z.enum(["info", "warn", "error"]),
      }),
    )
    .optional(),
  allowShell: z.boolean().optional(),
})
export type Command = z.infer<typeof Command>

export const Skills = z.object({
  paths: z.array(z.string()).optional().describe("Additional paths to skill folders"),
  urls: z
    .array(z.string())
    .optional()
    .describe("URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)"),
})
export type Skills = z.infer<typeof Skills>

export const Agent = z
  .object({
    model: ModelId.optional(),
    variant: z
      .string()
      .optional()
      .describe("Default model variant for this agent (applies only when using the agent's configured model)."),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    prompt: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead"),
    disable: z.boolean().optional(),
    description: z.string().optional().describe("Description of when to use the agent"),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
    hidden: z
      .boolean()
      .optional()
      .describe("Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)"),
    tier: z
      .enum(["core", "specialist", "internal"])
      .optional()
      .describe(
        "Agent visibility tier: core (always shown in picker), specialist (expandable, accessed via @-mention), internal (hidden)",
      ),
    options: z.record(z.string(), z.any()).optional(),
    color: z
      .union([
        z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format"),
        z.enum(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
      ])
      .optional()
      .describe("Hex color code (e.g., #FF5733) or theme color (e.g., primary)"),
    steps: PositiveInteger.optional().describe(
      "Maximum number of agentic iterations before forcing text-only response",
    ),
    maxSteps: PositiveInteger.optional().describe("@deprecated Use 'steps' field instead."),
    permission: Permission.optional(),
  })
  .catchall(z.any())
  .transform((agent, _ctx) => {
    const knownKeys = new Set([
      "name",
      "model",
      "variant",
      "prompt",
      "description",
      "temperature",
      "top_p",
      "mode",
      "hidden",
      "tier",
      "color",
      "steps",
      "maxSteps",
      "options",
      "permission",
      "disable",
      "tools",
    ])

    // Extract unknown properties into options
    const options: Record<string, unknown> = { ...agent.options }
    for (const [key, value] of Object.entries(agent)) {
      if (!knownKeys.has(key)) options[key] = value
    }

    // Convert legacy tools config to permissions
    const legacyPerms: Permission = {}
    for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
      const action = enabled ? "allow" : "deny"
      // write, edit, patch, multiedit all map to edit permission
      if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
        legacyPerms.edit = action
      } else {
        legacyPerms[tool] = action
      }
    }
    const permission: Permission = { ...legacyPerms, ...agent.permission }

    // Convert legacy maxSteps to steps
    const steps = agent.steps ?? agent.maxSteps

    return { ...agent, options, permission, steps } as typeof agent & {
      options?: Record<string, unknown>
      permission?: Permission
      steps?: number
    }
  })
  .meta({
    ref: "AgentConfig",
  })
export type Agent = z.infer<typeof Agent>

export const Keybinds = z
  .object({
    leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
    app_exit: z.string().optional().default("ctrl+c,ctrl+d,<leader>q").describe("Exit the application"),
    editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
    theme_list: z.string().optional().default("<leader>t").describe("List available themes"),
    sidebar_toggle: z.string().optional().default("<leader>b").describe("Toggle sidebar"),
    scrollbar_toggle: z.string().optional().default("none").describe("Toggle session scrollbar"),
    username_toggle: z.string().optional().default("none").describe("Toggle username visibility"),
    status_view: z.string().optional().default("<leader>s").describe("View status"),
    session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
    session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
    session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
    session_timeline: z.string().optional().default("<leader>g").describe("Show session timeline"),
    session_fork: z.string().optional().default("none").describe("Fork session from message"),
    session_rename: z.string().optional().default("ctrl+r").describe("Rename session"),
    session_delete: z.string().optional().default("ctrl+d").describe("Delete session"),
    stash_delete: z.string().optional().default("ctrl+d").describe("Delete stash entry"),
    model_provider_list: z.string().optional().default("ctrl+a").describe("Open provider list from model dialog"),
    model_favorite_toggle: z.string().optional().default("ctrl+f").describe("Toggle model favorite status"),
    session_interrupt: z.string().optional().default("escape").describe("Interrupt current session"),
    session_compact: z.string().optional().default("<leader>c").describe("Compact the session"),
    session_pin_toggle: z.string().optional().default("ctrl+f").describe("Pin or unpin session in the session list"),
    session_diff_view: z.string().optional().default("<leader>d").describe("View session diff"),
    session_quick_switch_1: z.string().optional().default("<leader>1").describe("Switch to session in quick slot 1"),
    session_quick_switch_2: z.string().optional().default("<leader>2").describe("Switch to session in quick slot 2"),
    session_quick_switch_3: z.string().optional().default("<leader>3").describe("Switch to session in quick slot 3"),
    session_quick_switch_4: z.string().optional().default("<leader>4").describe("Switch to session in quick slot 4"),
    session_quick_switch_5: z.string().optional().default("<leader>5").describe("Switch to session in quick slot 5"),
    session_quick_switch_6: z.string().optional().default("<leader>6").describe("Switch to session in quick slot 6"),
    session_quick_switch_7: z.string().optional().default("<leader>7").describe("Switch to session in quick slot 7"),
    session_quick_switch_8: z.string().optional().default("<leader>8").describe("Switch to session in quick slot 8"),
    session_quick_switch_9: z.string().optional().default("<leader>9").describe("Switch to session in quick slot 9"),
    messages_page_up: z.string().optional().default("pageup,ctrl+alt+b").describe("Scroll messages up by one page"),
    messages_page_down: z
      .string()
      .optional()
      .default("pagedown,ctrl+alt+f")
      .describe("Scroll messages down by one page"),
    messages_line_up: z.string().optional().default("ctrl+alt+y").describe("Scroll messages up by one line"),
    messages_line_down: z.string().optional().default("ctrl+alt+e").describe("Scroll messages down by one line"),
    messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
    messages_half_page_down: z.string().optional().default("ctrl+alt+d").describe("Scroll messages down by half page"),
    messages_first: z.string().optional().default("ctrl+g").describe("Navigate to first message"),
    messages_last: z.string().optional().default("ctrl+alt+g").describe("Navigate to last message"),
    messages_next: z.string().optional().default("none").describe("Navigate to next message"),
    messages_previous: z.string().optional().default("none").describe("Navigate to previous message"),
    messages_last_user: z.string().optional().default("none").describe("Navigate to last user message"),
    messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
    messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
    messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
    messages_toggle_conceal: z
      .string()
      .optional()
      .default("<leader>h")
      .describe("Toggle code block concealment in messages"),
    tool_details: z.string().optional().default("none").describe("Toggle tool details visibility"),
    model_list: z.string().optional().default("<leader>m").describe("List available models"),
    model_cycle_recent: z.string().optional().default("f2").describe("Next recently used model"),
    model_cycle_recent_reverse: z.string().optional().default("shift+f2").describe("Previous recently used model"),
    model_cycle_favorite: z.string().optional().default("none").describe("Next favorite model"),
    model_cycle_favorite_reverse: z.string().optional().default("none").describe("Previous favorite model"),
    command_list: z.string().optional().default("ctrl+p").describe("List available commands"),
    agent_list: z.string().optional().default("<leader>a").describe("List agents"),
    agent_cycle: z.string().optional().default("tab").describe("Next agent"),
    agent_cycle_reverse: z.string().optional().default("shift+tab").describe("Previous agent"),
    variant_cycle: z.string().optional().default("ctrl+t").describe("Cycle model variants"),
    input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
    input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
    input_submit: z.string().optional().default("return").describe("Submit input"),
    input_newline: z
      .string()
      .optional()
      .default("shift+return,ctrl+return,alt+return,ctrl+j")
      .describe("Insert newline in input"),
    input_move_left: z.string().optional().default("left,ctrl+b").describe("Move cursor left in input"),
    input_move_right: z.string().optional().default("right,ctrl+f").describe("Move cursor right in input"),
    input_move_up: z.string().optional().default("up").describe("Move cursor up in input"),
    input_move_down: z.string().optional().default("down").describe("Move cursor down in input"),
    input_select_left: z.string().optional().default("shift+left").describe("Select left in input"),
    input_select_right: z.string().optional().default("shift+right").describe("Select right in input"),
    input_select_up: z.string().optional().default("shift+up").describe("Select up in input"),
    input_select_down: z.string().optional().default("shift+down").describe("Select down in input"),
    input_line_home: z.string().optional().default("ctrl+a").describe("Move to start of line in input"),
    input_line_end: z.string().optional().default("ctrl+e").describe("Move to end of line in input"),
    input_select_line_home: z.string().optional().default("ctrl+shift+a").describe("Select to start of line in input"),
    input_select_line_end: z.string().optional().default("ctrl+shift+e").describe("Select to end of line in input"),
    input_visual_line_home: z.string().optional().default("alt+a").describe("Move to start of visual line in input"),
    input_visual_line_end: z.string().optional().default("alt+e").describe("Move to end of visual line in input"),
    input_select_visual_line_home: z
      .string()
      .optional()
      .default("alt+shift+a")
      .describe("Select to start of visual line in input"),
    input_select_visual_line_end: z
      .string()
      .optional()
      .default("alt+shift+e")
      .describe("Select to end of visual line in input"),
    input_buffer_home: z.string().optional().default("home").describe("Move to start of buffer in input"),
    input_buffer_end: z.string().optional().default("end").describe("Move to end of buffer in input"),
    input_select_buffer_home: z
      .string()
      .optional()
      .default("shift+home")
      .describe("Select to start of buffer in input"),
    input_select_buffer_end: z.string().optional().default("shift+end").describe("Select to end of buffer in input"),
    input_delete_line: z.string().optional().default("ctrl+shift+d").describe("Delete line in input"),
    input_delete_to_line_end: z.string().optional().default("ctrl+k").describe("Delete to end of line in input"),
    input_delete_to_line_start: z.string().optional().default("ctrl+u").describe("Delete to start of line in input"),
    input_backspace: z.string().optional().default("backspace,shift+backspace").describe("Backspace in input"),
    input_delete: z.string().optional().default("ctrl+d,delete,shift+delete").describe("Delete character in input"),
    input_undo: z.string().optional().default("ctrl+-,super+z").describe("Undo in input"),
    input_redo: z.string().optional().default("ctrl+.,super+shift+z").describe("Redo in input"),
    input_word_forward: z
      .string()
      .optional()
      .default("alt+f,alt+right,ctrl+right")
      .describe("Move word forward in input"),
    input_word_backward: z
      .string()
      .optional()
      .default("alt+b,alt+left,ctrl+left")
      .describe("Move word backward in input"),
    input_select_word_forward: z
      .string()
      .optional()
      .default("alt+shift+f,alt+shift+right")
      .describe("Select word forward in input"),
    input_select_word_backward: z
      .string()
      .optional()
      .default("alt+shift+b,alt+shift+left")
      .describe("Select word backward in input"),
    input_delete_word_forward: z
      .string()
      .optional()
      .default("alt+d,alt+delete,ctrl+delete")
      .describe("Delete word forward in input"),
    input_delete_word_backward: z
      .string()
      .optional()
      .default("ctrl+w,ctrl+backspace,alt+backspace")
      .describe("Delete word backward in input"),
    history_previous: z.string().optional().default("up").describe("Previous history item"),
    history_next: z.string().optional().default("down").describe("Next history item"),
    session_child_first: z.string().optional().default("<leader>down").describe("Go to first child session"),
    session_child_cycle: z.string().optional().default("right").describe("Go to next child session"),
    session_child_cycle_reverse: z.string().optional().default("left").describe("Go to previous child session"),
    session_parent: z.string().optional().default("up").describe("Go to parent session"),
    terminal_suspend: z.string().optional().default("ctrl+z").describe("Suspend terminal"),
    terminal_title_toggle: z.string().optional().default("none").describe("Toggle terminal title"),
    display_thinking: z.string().optional().default("none").describe("Toggle thinking blocks visibility"),
  })
  .strict()
  .meta({
    ref: "KeybindsConfig",
  })

export const Server = z
  .object({
    port: PositiveInteger.max(TCP_PORT_MAX).optional().describe("Port to listen on"),
    hostname: z.string().optional().describe("Loopback hostname to listen on; network binds are disabled"),
    mdns: z.boolean().optional().describe("Deprecated; mDNS discovery is disabled"),
    mdnsDomain: z.string().optional().describe("Deprecated; mDNS discovery is disabled"),
    cors: z.array(z.string()).optional().describe("Additional loopback origins to allow for CORS"),
  })
  .strict()
  .meta({
    ref: "ServerConfig",
  })

export const Layout = z.enum(["auto", "stretch"]).meta({
  ref: "LayoutConfig",
})
export type Layout = z.infer<typeof Layout>

export const Provider = ModelsDev.Provider.partial()
  .extend({
    whitelist: z.array(z.string()).optional(),
    blacklist: z.array(z.string()).optional(),
    models: z
      .record(
        z.string(),
        ModelsDev.Model.partial().extend({
          variants: z
            .record(
              z.string(),
              z
                .object({
                  disabled: z.boolean().optional().describe("Disable this variant for the model"),
                })
                .catchall(z.any()),
            )
            .optional()
            .describe("Variant-specific configuration"),
        }),
      )
      .optional(),
    options: z
      .object({
        apiKey: z.string().optional(),
        baseURL: z.string().optional(),
        enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
        setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
        timeout: z
          .union([
            PositiveInteger.describe(
              `Timeout in milliseconds for requests to this provider. Default is ${PROVIDER_TIMEOUT_MS} (${PROVIDER_TIMEOUT_MINUTES} minutes). Set to false to disable timeout.`,
            ),
            z.literal(false).describe("Disable timeout for this provider entirely."),
          ])
          .optional(),
        chunkTimeout: PositiveInteger.optional().describe(
          "Timeout in milliseconds between streamed SSE chunks for this provider. If no chunk arrives within this window, the request is aborted.",
        ),
        toolProfile: z
          .enum(["core", "full"])
          .optional()
          .describe(
            'Tool surface for constrained local providers such as AX Engine. "core" keeps coding/file tools only; "full" exposes every enabled tool.',
          ),
      })
      .catchall(z.any())
      .optional(),
  })
  .strict()
  .meta({
    ref: "ProviderConfig",
  })
export type Provider = z.infer<typeof Provider>

export const Info = z
  .object({
    $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
    logLevel: Log.Level.optional().describe("Log level"),
    server: Server.optional().describe("Server configuration for ax-code serve and web commands"),
    command: z.record(z.string(), Command).optional().describe(`Command configuration, see ${REPO_URL}`),
    skills: Skills.optional().describe("Additional skill folder paths"),
    watcher: z
      .object({
        ignore: z.array(z.string()).optional(),
      })
      .optional(),
    plugin: z.string().array().optional(),
    snapshot: z
      .boolean()
      .optional()
      .describe(
        "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
      ),
    autoupdate: z
      .union([z.boolean(), z.literal("notify")])
      .optional()
      .describe(
        "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
      ),
    shell: z
      .string()
      .optional()
      .describe(
        "Default shell to use for terminal and bash tool (e.g. /bin/bash, /usr/bin/zsh). Overrides $SHELL environment variable.",
      ),
    language: z.literal("en").optional().describe("UI language (English only)"),
    disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
    enabled_providers: z
      .array(z.string())
      .optional()
      .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
    model: ModelId.describe("Model to use in the format of provider/model, eg openai/gpt-5").optional(),
    small_model: ModelId.describe(
      "Small model to use for tasks like title generation in the format of provider/model",
    ).optional(),
    default_agent: z
      .string()
      .optional()
      .describe(
        "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
      ),
    username: z.string().optional().describe("Custom username to display in conversations instead of system username"),
    mode: z
      .object({
        build: Agent.optional(),
        plan: Agent.optional(),
      })
      .catchall(Agent)
      .optional()
      .describe("@deprecated Use `agent` field instead."),
    agent: z
      .object({
        // primary
        plan: Agent.optional(),
        build: Agent.optional(),
        // subagent
        general: Agent.optional(),
        explore: Agent.optional(),
        // specialized
        title: Agent.optional(),
        summary: Agent.optional(),
        compaction: Agent.optional(),
      })
      .catchall(Agent)
      .optional()
      .describe(`Agent configuration, see ${REPO_URL}`),
    provider: z.record(z.string(), Provider).optional().describe("Custom provider configurations and model overrides"),
    mcp: z
      .record(
        z.string(),
        z.union([
          Mcp,
          z
            .object({
              enabled: z.boolean(),
            })
            .strict(),
        ]),
      )
      .optional()
      .describe("MCP (Model Context Protocol) server configurations"),
    formatter: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.object({
            disabled: z.boolean().optional(),
            command: z.array(z.string()).optional(),
            environment: z.record(z.string(), z.string()).optional(),
            extensions: z.array(z.string()).optional(),
          }),
        ),
      ])
      .optional(),
    lsp: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.union([
            z.object({
              disabled: z.literal(true),
            }),
            z.object({
              command: z.array(z.string()).optional(),
              extensions: z.array(z.string()).optional(),
              languageId: z.string().optional(),
              disabled: z.boolean().optional(),
              semantic: z.boolean().optional(),
              priority: SafeInteger.optional(),
              concurrency: PositiveInteger.optional(),
              capabilities: z
                .object({
                  hover: z.boolean().optional(),
                  definition: z.boolean().optional(),
                  references: z.boolean().optional(),
                  implementation: z.boolean().optional(),
                  documentSymbol: z.boolean().optional(),
                  workspaceSymbol: z.boolean().optional(),
                  callHierarchy: z.boolean().optional(),
                })
                .optional(),
              env: z.record(z.string(), z.string()).optional(),
              initialization: z.record(z.string(), z.any()).optional(),
            }),
          ]),
        ),
      ])
      .optional()
      .refine(
        (data) => {
          if (!data) return true
          if (typeof data === "boolean") return true
          const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

          return Object.entries(data).every(([id, config]) => {
            if (config.disabled) return true
            if (serverIds.has(id)) return true
            return Boolean(config.command && config.extensions)
          })
        },
        {
          error: "For custom LSP servers, both 'command' and 'extensions' are required.",
        },
      ),
    instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
    layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
    permission: Permission.optional(),
    autonomous: z.boolean().optional().describe("Enable autonomous mode (default: true)"),
    super_long: z
      .union([
        z.boolean(),
        z.object({
          enabled: z.boolean().optional().describe("Enable Super-Long supervised long-run mode"),
          duration_hours: z
            .number()
            .positive()
            .max(72)
            .optional()
            .describe("Runtime ceiling for a Super-Long run in hours (default and hard maximum: 72)"),
        }),
      ])
      .optional()
      .describe(
        "Enable Super-Long supervised long-run mode (default: on for models with a 64k+ context window, " +
          "thinking, and prompt caching — e.g. Qwen 3.7 Max/Plus; off otherwise)",
      ),
    isolation: Isolation.optional().describe("Execution isolation configuration"),
    tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead"),
    session: z
      .object({
        ttl_days: SafeInteger.min(1).optional().describe("Auto-prune sessions older than this many days (default: 30)"),
        auto_prune: z.boolean().optional().describe("Automatically prune expired sessions on startup (default: true)"),
        max_steps: SafeInteger.min(10)
          .optional()
          .describe("Maximum agentic steps per session turn before stopping (default: 500)"),
        max_continuations: NonNegativeInteger.optional().describe(
          "In autonomous mode, how many times to auto-continue after hitting step limit (default: 3, 0 to disable)",
        ),
        max_total_steps: SafeInteger.min(10)
          .optional()
          .describe(
            "Hard ceiling on cumulative steps across ALL auto-continuations, including active goals and Super-Long runs " +
              "(default: max_steps × (max_continuations + 1); Super-Long default: max_steps × 40)",
          ),
        max_todo_retries: NonNegativeInteger.optional().describe(
          "In autonomous mode, how many times to auto-continue when todos remain pending after the model stops (default: 10, 0 to disable)",
        ),
      })
      .optional()
      .describe("Session lifecycle management"),
    routing: z
      .object({
        disable: z
          .boolean()
          .optional()
          .describe("Disable automatic specialist agent routing based on message keywords. Default: false."),
        mode: z
          .enum(["off", "delegate", "switch"])
          .optional()
          .describe(
            "@deprecated Routing mode is no longer used. Field accepted for backwards compatibility but ignored.",
          ),
        auto_switch: z
          .boolean()
          .optional()
          .describe("@deprecated Use routing.disable instead. Field accepted for backwards compatibility but ignored."),
        llm: z
          .boolean()
          .optional()
          .describe(
            "Enable LLM-based message-complexity classification so simple queries use a small/fast model. Default: true.",
          ),
      })
      .optional()
      .describe("Specialist agent auto-routing and message-complexity routing settings"),
    compaction: z
      .object({
        auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
        prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
        reserved: NonNegativeInteger.optional().describe(
          "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
        ),
      })
      .optional(),
    browser: z
      .object({
        interceptOpen: z
          .boolean()
          .optional()
          .describe(
            "Intercept browser-open commands (open/xdg-open/start) targeting local HTML files or localhost URLs to prevent unexpected focus-steals during HTML development. Defaults to true.",
          ),
      })
      .optional()
      .describe("Browser integration settings"),
    attachment: z
      .object({
        image: z
          .object({
            auto_resize: z
              .boolean()
              .optional()
              .describe("Automatically resize images that exceed limits before sending to the model (default: true)"),
            max_width: PositiveInteger.optional().describe("Maximum image width in pixels (default: 2000)"),
            max_height: PositiveInteger.optional().describe("Maximum image height in pixels (default: 2000)"),
            max_base64_bytes: PositiveInteger.optional().describe(
              "Maximum image size in base64 bytes (default: 5242880 = 5MiB)",
            ),
          })
          .optional(),
      })
      .optional()
      .describe("File attachment settings"),
    experimental: z
      .object({
        disable_paste_summary: z.boolean().optional(),
        batch_tool: z.boolean().optional().describe("Enable the batch tool"),
        openTelemetry: z
          .boolean()
          .optional()
          .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
        primary_tools: z
          .array(z.string())
          .optional()
          .describe("Tools that should only be available to primary agents."),
        continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
        mcp_timeout: PositiveInteger.optional().describe(
          "Timeout in milliseconds for model context protocol (MCP) requests",
        ),
        autonomous_escalate_low_confidence: z
          .boolean()
          .optional()
          .describe(
            "When autonomous mode auto-answers a clarification question with low confidence, escalate to the user instead of guessing. Default: true.",
          ),
        autonomous_strict_permission: z
          .boolean()
          .optional()
          .describe(
            "When autonomous mode encounters a permission whose risk class is unknown, prompt instead of auto-approving. Default: true. Set false only to preserve legacy compatibility.",
          ),
        autonomous_caps: z
          .object({
            steps: PositiveInteger.optional(),
            files: PositiveInteger.optional(),
            lines: PositiveInteger.optional(),
            blockedPaths: z.array(z.string()).optional(),
            perTool: z
              .record(z.string(), SafeInteger)
              .optional()
              .describe(
                "Per-tool call-count caps. 0 or negative disables the cap for that tool. Tools not listed are unrestricted at the per-tool layer.",
              ),
          })
          .optional()
          .describe(
            "Override the default autonomous-mode blast-radius caps. Any field omitted falls back to the constant default.",
          ),
        planner_architect_model: z
          .string()
          .optional()
          .describe(
            "Provider/model id used for plan generation and replanning when set; defaults to the executor model.",
          ),
      })
      .optional(),
    quality: z
      .object({
        critic_enabled: z
          .boolean()
          .optional()
          .describe("Run the autonomous-mode diff critic at every phase boundary. Default: false."),
      })
      .optional(),
    modes: z
      .object({
        default: z
          .enum(["local", "cloud", "hybrid", "arena", "council"])
          .optional()
          .describe(
            "Default execution mode. When unset: hybrid if local AX Engine is available, else cloud. Arena/council are typically invoked via tools rather than as the global default.",
          ),
        hybrid: z
          .object({
            preferLocalWhenAvailable: z
              .boolean()
              .optional()
              .describe("Prefer local placement when AX Engine (or configured local) is available. Default: true."),
            escalateOnHighComplexity: z
              .boolean()
              .optional()
              .describe("Route high-complexity work to cloud when hybrid is active. Default: true."),
            localProviderID: z
              .string()
              .optional()
              .describe("Provider id treated as local for hybrid placement. Default: ax-engine."),
          })
          .optional()
          .describe("Hybrid local/cloud placement policy"),
        council: z
          .object({
            enabled: z
              .boolean()
              .optional()
              .describe("Allow the council multi-provider advisory tool. Default: true."),
            maxMembers: PositiveInteger.optional().describe(
              "Maximum council members per invocation (default: 3, hard max: 6).",
            ),
            timeoutMs: PositiveInteger.optional().describe(
              "Per-member timeout in ms for council fan-out (default: 60000).",
            ),
            debateRounds: NonNegativeInteger.optional().describe(
              "Optional multi-round anonymous debate rounds (default: 0; Phase 3+).",
            ),
          })
          .optional()
          .describe("Multi-provider council (advisory review / design) settings"),
        arena: z
          .object({
            enabled: z
              .boolean()
              .optional()
              .describe("Enable arena multi-contestant mode tools. Default: false until Phase 2."),
            maxContestants: PositiveInteger.optional().describe(
              "Maximum arena contestants (default: 3, hard max: 5).",
            ),
            strategy: z
              .enum(["verify_first", "diversity", "hybrid_score"])
              .optional()
              .describe(
                "Ranking strategy for arena candidates. verify_first is the recommended default (never pure popularity).",
              ),
          })
          .optional()
          .describe("Arena best-of-N implementation comparison settings"),
        budget: z
          .object({
            maxEstimatedUsd: z
              .number()
              .nonnegative()
              .optional()
              .describe("Maximum estimated USD for an ensemble fan-out (fail-closed when exceeded)."),
            estimatedUsdPerMember: z
              .number()
              .nonnegative()
              .optional()
              .describe(
                "Rough USD cost per council/arena member call used with maxEstimatedUsd to cap fan-out size.",
              ),
          })
          .optional()
          .describe("Ensemble cost budget controls"),
      })
      .optional()
      .describe(
        "Execution modes: local, cloud, hybrid placement, multi-provider council, and arena ensemble (ADR-049).",
      ),
  })
  .strict()
  .meta({
    ref: "Config",
  })

export type Info = z.output<typeof Info>
