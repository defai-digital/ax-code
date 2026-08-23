// Fake canonical AX Computer MCP stdio server for protocol/external-provider
// tests. Newline-delimited JSON-RPC 2.0 on stdin/stdout. Modes (argv[2]):
//   basic         advertises protocol v1; serves the five canonical tools with valid payloads
//   incompatible  advertises protocol version 99 only (no overlap with the client range)
//   no-protocol   initialize result carries no axComputer field at all
//   bad-payload   valid handshake, but ax_observe returns a malformed observation
//   refuse-desktop like basic, but desktop-scoped ax_observe is a structured
//                 refusal (structuredContent.code: "unsupported_scope")
import process from "node:process"

const mode = process.argv[2] ?? "basic"

/** 1x1 transparent PNG */
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const CAPABILITIES = {
  actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "activate_window", "launch_app"],
  backgroundDelivery: true,
  elementTargeting: true,
  windowActivation: true,
}

const APPS = [{ name: "TextEdit", pid: 4242, bundleId: "com.apple.TextEdit" }]

const WINDOWS = [
  {
    id: "101",
    title: "Untitled",
    bounds: { x: 50, y: 50, width: 800, height: 600 },
    app: { name: "TextEdit", pid: 4242 },
  },
]

function observation(scope) {
  const base = {
    platform: "test",
    provider: "external",
    timestamp: Date.now(),
    screenshot: { data: PNG_BASE64, mimeType: "image/png", width: 1, height: 1 },
    elements: [],
  }
  if (scope && scope.desktop) return base
  return {
    ...base,
    app: { name: "TextEdit", pid: 4242 },
    window: WINDOWS[0],
    elements: [
      { id: "el-0", role: "AXGroup", name: "Container" },
      { id: "el-1", role: "AXButton", name: "Save", bounds: { x: 10, y: 20, width: 80, height: 24 } },
      { id: "el-2", role: "AXTextArea", name: "Editor" },
    ],
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n")
}

function handle(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (!message.method) return
  if (message.method === "initialize") {
    const result = {
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: "fake-ax-server", version: "0.0.0" },
    }
    if (mode === "basic" || mode === "bad-payload" || mode === "refuse-desktop")
      result.axComputer = { version: 1, minVersion: 1 }
    if (mode === "incompatible") result.axComputer = { version: 99 }
    send({ jsonrpc: "2.0", id: message.id, result })
    return
  }
  if (message.method === "notifications/initialized") return
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: ["ax_capabilities", "ax_list_apps", "ax_list_windows", "ax_observe", "ax_act"].map((name) => ({
          name,
          inputSchema: { type: "object" },
        })),
      },
    })
    return
  }
  if (message.method === "tools/call") {
    const params = message.params ?? {}
    const args = params.arguments ?? {}
    const ok = (structuredContent) => send({ jsonrpc: "2.0", id: message.id, result: { structuredContent } })
    switch (params.name) {
      case "ax_capabilities":
        ok(CAPABILITIES)
        return
      case "ax_list_apps":
        ok({ apps: APPS })
        return
      case "ax_list_windows":
        ok({ windows: WINDOWS })
        return
      case "ax_observe":
        if (mode === "bad-payload") {
          ok({ platform: 42, elements: "not-an-array" })
          return
        }
        // mirrors the closed server's app-scoped backend: desktop observations
        // are a structured refusal carrying the domain code verbatim
        if (mode === "refuse-desktop" && args.scope?.desktop) {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              content: [{ type: "text", text: "desktop scope is not supported by this backend; use an app scope" }],
              isError: true,
              structuredContent: { code: "unsupported_scope", provider: "fake-ax" },
            },
          })
          return
        }
        ok(observation(args.scope))
        return
      case "ax_act": {
        const action = args.action ?? {}
        if (action.type === "launch_app" && action.app === "RefuseMe") {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              content: [{ type: "text", text: "cannot launch RefuseMe" }],
              isError: true,
              structuredContent: { code: "launch_refused" },
            },
          })
          return
        }
        ok({ ok: true, provider: "external", action: action.type, detail: `${action.type} done` })
        return
      }
      default:
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: `unknown tool ${params.name}` }], isError: true },
        })
    }
  }
}

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf("\n")
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) handle(line)
  }
})
process.stdin.resume()
