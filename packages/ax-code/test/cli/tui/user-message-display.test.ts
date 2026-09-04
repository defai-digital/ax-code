import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { For, Match, Show, Switch } from "solid-js"
import type { Part, UserMessage as UserMessageInfo } from "@ax-code/sdk/v2"
import { UserMessage } from "../../../src/cli/cmd/tui/routes/session/transcript"
import { PromptInput } from "../../../src/session/prompt-input"
import { resolveUserMessageParts } from "../../../src/session/prompt-message-parts"
import { MessageID } from "../../../src/session/schema"

// The namespace-safe test transformer emits classic JSX, while production
// uses the Solid compiler. Capture those elements without initializing a TTY.
beforeEach(() => {
  vi.stubGlobal("React", {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
      type,
      props: { ...props, children: children.length === 1 ? children[0] : children },
    }),
    Fragment: Symbol("Fragment"),
  })
})
afterEach(() => vi.unstubAllGlobals())
vi.mock("@tui/routes/session/context", () => ({
  useSessionRouteContext: () => ({
    width: 100,
    userMetadataPreference: () => "auto",
    showTimestamps: () => false,
  }),
}))
vi.mock("@tui/context/local", () => ({ useLocal: () => ({ agent: { color: () => "accent" } }) }))
vi.mock("@tui/context/sync", () => ({ useSync: () => ({ data: { agent: [] } }) }))
vi.mock("@tui/context/theme", () => ({
  useTheme: () => ({ theme: { text: "text", accent: "accent" } }),
  selectedForeground: () => "text",
  tint: () => "text",
}))
vi.mock("@tui/routes/session/tool-renderers", () => ({ toolRendererComponent: () => undefined }))
vi.mock("@tui/routes/session/render-adapter", () => ({ SessionCodeRenderer: () => undefined }))

// Inspect the component's JSX tree without a terminal renderer. Resolve only
// the control-flow nodes used by UserMessage, so hidden rows stay hidden.
function visibleText(value: unknown): string {
  if (value === undefined || value === null || typeof value === "boolean") return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(visibleText).join("")
  const node = value as { type: unknown; props: Record<string, unknown> }
  if (node.type === Show || node.type === Match) {
    if (!node.props.when) return visibleText(node.props.fallback)
    const children = node.props.children
    return visibleText(typeof children === "function" ? children(() => node.props.when) : children)
  }
  if (node.type === For) {
    const each = node.props.each as unknown[]
    const children = node.props.children as (item: unknown, index: () => number) => unknown
    return each.map((item, index) => visibleText(children(item, () => index))).join("")
  }
  if (node.type === Switch) {
    const children = node.props.children as { props: { when?: unknown } }[]
    return visibleText(children.find((child) => child.props.when))
  }
  return visibleText(node.props.title) + visibleText(node.props.children)
}

const message: UserMessageInfo = {
  id: "msg_user_display",
  sessionID: "ses_user_display",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "test", modelID: "test" },
}

function textPart(text: string, synthetic = false): Part {
  return { type: "text", id: `prt_${text}`, sessionID: message.sessionID, messageID: message.id, text, synthetic }
}

function render(parts: Part[]) {
  return visibleText(UserMessage({ message, parts, index: 0, onMouseUp: () => {} }))
}

describe("user message display", () => {
  test("shows attachment-only user messages accepted by the prompt contract", async () => {
    const input = PromptInput.parse({
      sessionID: message.sessionID,
      noReply: true,
      parts: [
        {
          type: "file",
          mime: "image/png",
          filename: "diagram.png",
          url: "data:image/png;base64,dGVzdA==",
        },
      ],
    })
    const parts = await resolveUserMessageParts({
      sessionID: input.sessionID,
      messageID: MessageID.make(message.id),
      agentName: message.agent,
      agentPermission: [],
      parts: input.parts,
    })
    const result = render(parts)

    expect(result).toContain("you")
    expect(result).toContain("diagram.png")
  })

  test("shows all user text parts in order while hiding synthetic instructions", () => {
    const result = render([
      textPart("First instruction"),
      textPart("Hidden instruction", true),
      textPart("Second instruction"),
    ])

    expect(result).toContain("First instruction")
    expect(result).toContain("Second instruction")
    expect(result.indexOf("First instruction")).toBeLessThan(result.indexOf("Second instruction"))
    expect(result).not.toContain("Hidden instruction")
  })

  test("does not create a normal row for synthetic-only instructions", () => {
    expect(render([textPart("Hidden instruction", true)])).not.toContain("you")
  })

  test("keeps compaction-only markers visible without creating a user row", () => {
    const result = render([
      { type: "compaction", id: "prt_compaction", sessionID: message.sessionID, messageID: message.id, auto: false },
    ])

    expect(result).toContain("Manual compaction")
    expect(result).not.toContain("you")
  })
})
