import type { McpCallToolResult, McpClient, McpToolDefinition } from "../src/mcp/stdio-client"

/** 1x1 transparent PNG */
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

/** scripted McpClient for provider mapping tests; records every call */
export class FakeMcpClient implements McpClient {
  readonly calls: { tool: string; args: Record<string, unknown> }[] = []
  closed = false

  constructor(private readonly handler: (tool: string, args: Record<string, unknown>) => McpCallToolResult) {}

  async listTools(): Promise<McpToolDefinition[]> {
    return []
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    this.calls.push({ tool, args })
    return this.handler(tool, args)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  lastCall(): { tool: string; args: Record<string, unknown> } {
    const call = this.calls[this.calls.length - 1]
    if (!call) throw new Error("FakeMcpClient: no calls recorded")
    return call
  }
}

// real get_app_state capture from a live TextEdit "Open" panel; each tree
// line is `\t`-indented by depth: <index> <role> [(flags)] [label] [Key: value]
const APP_STATE_TREE = [
  "App=com.apple.TextEdit (pid 46181)",
  'Window: "Open", App: TextEdit.',
  "0 standard window Open ID: open-panel, Secondary Actions: Raise",
  "\t1 split group",
  "\t\t2 scroll area Secondary Actions: Scroll Up, Scroll Down",
  "\t\t\t3 outline (showing 0-19 of 32 items) Description: sidebar",
  "\t\t\t\t4 row (selected) TextEdit",
  "\t\t\t\t\t5 cell (selected) Secondary Actions: Open",
  "\t\t27 scroll bar (settable, float) 0",
  "\t\t33 splitter (disabled, settable, float) Value: 197",
  "\t\t40 menu button Description: List Help: Show as Icons, List, or Columns, and hide/show the sidebar ID: View Options",
  "\t\t43 search text field (settable) ID: Search",
  "\t\t45 button New Document ID: NewDocumentButton",
].join("\n")

/** recorded OCU (`open-computer-use mcp`) response payloads */
export const ocu = {
  appStateTree: APP_STATE_TREE,

  appState: {
    content: [
      { type: "text", text: APP_STATE_TREE },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ],
  } satisfies McpCallToolResult,

  clickOk: {
    content: [{ type: "text", text: "clicked element 0 in TextEdit" }],
  } satisfies McpCallToolResult,

  clickError: {
    content: [{ type: "text", text: "element index 99 not found in the latest snapshot" }],
    isError: true,
  } satisfies McpCallToolResult,

  listApps: {
    content: [
      {
        type: "text",
        text: [
          "Finder — com.apple.finder [running]",
          "TextEdit — com.apple.TextEdit [running, frontmost]",
          "Safari — com.apple.Safari [last-used=2026-08-01, uses=12]",
        ].join("\n"),
      },
    ],
  } satisfies McpCallToolResult,
}

/** recorded cua-driver response payloads */
export const cua = {
  listApps: {
    content: [{ type: "text", text: "TextEdit (pid 4242, running)" }],
    structuredContent: {
      apps: [{ pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", active: true, running: true }],
    },
  } satisfies McpCallToolResult,

  listWindows: {
    content: [],
    structuredContent: {
      windows: [
        {
          window_id: 101,
          pid: 4242,
          app_name: "TextEdit",
          title: "Untitled",
          bounds: { x: 50, y: 50, width: 800, height: 600 },
        },
      ],
      current_space_id: 1,
    },
  } satisfies McpCallToolResult,

  windowState: {
    content: [
      { type: "text", text: '# TextEdit — Untitled\n[0] AXButton "Save"\n[1] AXTextArea "Editor"' },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ],
    structuredContent: {
      window_id: 101,
      pid: 4242,
      element_count: 2,
      screenshot_width: 640,
      screenshot_height: 480,
      tree_markdown: '[0] AXButton "Save"\n[1] AXTextArea "Editor"',
      elements: [
        {
          element_index: 0,
          element_token: "snap-1:0",
          role: "AXButton",
          label: "Save",
          frame: { x: 10, y: 20, w: 80, h: 24 },
          depth: 3,
        },
        {
          element_index: 1,
          role: "AXTextArea",
          label: "Editor",
          frame: { x: 0, y: 60, w: 800, h: 540 },
          depth: 2,
        },
      ],
      window_bounds: { x: 50, y: 50, width: 800, height: 600 },
    },
  } satisfies McpCallToolResult,

  desktopState: {
    content: [{ type: "image", data: PNG_BASE64, mimeType: "image/png" }],
    structuredContent: { screenshot_width: 2560, screenshot_height: 1440 },
  } satisfies McpCallToolResult,

  ok: {
    content: [{ type: "text", text: "done" }],
  } satisfies McpCallToolResult,

  backgroundRefusal: {
    content: [{ type: "text", text: "background delivery unavailable for this window" }],
    isError: true,
    structuredContent: { code: "background_unavailable" },
  } satisfies McpCallToolResult,

  // live capture shape (cua-driver 0.21.0): TextEdit with multiple windows
  // under one pid refuses pid-scoped background typing
  ambiguityRefusal: {
    content: [
      {
        type: "text",
        text: 'Background input refused (same_pid_keyboard_ambiguity): pid 4242 owns 1 other eligible top-level window(s); process-scoped key events cannot be proven to reach window 101 and could mutate a sibling window. Use an exact element action, the page tool for browser content, or delivery_mode:"foreground"',
      },
    ],
    isError: true,
    structuredContent: {
      code: "same_pid_keyboard_ambiguity",
      effect: "refused",
      pid: 4242,
      window_id: 101,
      reason: "pid 4242 owns sibling windows",
      escalation: { recommended: "foreground", reason: "pid 4242 owns sibling windows" },
    },
  } satisfies McpCallToolResult,

  // same refusal without the structured escalation block: only the text signal
  ambiguityTextRefusal: {
    content: [
      {
        type: "text",
        text: 'Background input refused (same_pid_keyboard_ambiguity): ... or delivery_mode:"foreground"',
      },
    ],
    isError: true,
    structuredContent: { code: "same_pid_keyboard_ambiguity", effect: "refused" },
  } satisfies McpCallToolResult,

  // refusal with no escalation route — must stay a refusal, never retried
  wrongTargetRefusal: {
    content: [{ type: "text", text: "element belongs to a different window than the target" }],
    isError: true,
    structuredContent: { code: "wrong_target", effect: "refused" },
  } satisfies McpCallToolResult,
}
