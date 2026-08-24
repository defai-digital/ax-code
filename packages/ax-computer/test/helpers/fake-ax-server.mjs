// Fake canonical AX Computer MCP stdio server for protocol/external-provider
// tests. Newline-delimited JSON-RPC 2.0 on stdin/stdout. Modes (argv[2]):
//   basic         advertises protocol v1; serves the five canonical tools with valid payloads
//   incompatible  advertises protocol version 99 only (no overlap with the client range)
//   no-protocol   initialize result carries no axComputer field at all
//   bad-payload   valid handshake, but ax_observe returns a malformed observation
//   refuse-desktop like basic, but desktop-scoped ax_observe is a structured
//                 refusal (structuredContent.code: "unsupported_scope")
import process from "node:process"
import { createHash } from "node:crypto"

const mode = process.argv[2] ?? "basic"

/** 1x1 transparent PNG */
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const CAPABILITIES = {
  actions: [
    "click",
    "type",
    "keypress",
    "scroll",
    "drag",
    "set_value",
    "activate_window",
    "launch_app",
    "move",
    "wait",
  ],
  backgroundDelivery: true,
  elementTargeting: true,
  windowActivation: true,
}

/** element ids the fake observation issues; anything else is a refusal */
const KNOWN_ELEMENTS = new Set(["el-0", "el-1", "el-2"])

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

// ---- passive observe state ----
// passive frames hash the fake's visible content (typed text); a revision is
// allocated only when that content changes, so an immediate re-poll is
// deterministically unchanged
let typed = ""
let passiveRevision = 0
/** revision token -> frame hash, so superseded-but-known revisions are not gaps */
const passiveFrames = new Map()
let passiveLatest

function passiveObservation(scope, options) {
  const frameHash = `sha256:${createHash("sha256").update(JSON.stringify({ scope, typed })).digest("hex")}`
  if (passiveLatest?.frameHash !== frameHash) {
    passiveRevision += 1
    passiveLatest = { revision: `r${passiveRevision}`, frameHash }
    passiveFrames.set(passiveLatest.revision, frameHash)
  }
  const base = {
    platform: "test",
    provider: "external",
    timestamp: Date.now(),
    elements: [],
    revision: passiveLatest.revision,
    frameHash: passiveLatest.frameHash,
  }
  // screenshot dedup: the client already advertises this frame hash
  const screenshot = options.have?.includes(frameHash)
    ? undefined
    : { data: PNG_BASE64, mimeType: "image/png", width: 1, height: 1 }
  if (options.sinceRevision !== null && options.sinceRevision !== undefined) {
    // unknown or evicted revision: latest full frame + gap, never silent unchanged
    if (!passiveFrames.has(options.sinceRevision)) return { ...base, unchanged: false, gap: true, screenshot }
    if (options.sinceRevision === passiveLatest.revision) return { ...base, unchanged: true }
  }
  return { ...base, unchanged: false, screenshot }
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
        // passive mode: sinceRevision present (null bootstraps, a token resumes)
        if (args.sinceRevision !== undefined) {
          ok(passiveObservation(args.scope, args))
          return
        }
        ok(observation(args.scope))
        return
      case "ax_act": {
        // in-memory refusal: element targets the fake observation never issued
        const refusalFor = (action) => {
          if (action.type === "wait" && action.condition?.type !== "screen_stable") {
            const target = action.condition?.target
            if (target?.kind !== "element") return "unsupported_target"
            return KNOWN_ELEMENTS.has(target.id) ? undefined : "unknown_element"
          }
          if (["click", "set_value", "move"].includes(action.type) && action.target?.kind === "element") {
            return KNOWN_ELEMENTS.has(action.target.id) ? undefined : "unknown_element"
          }
          return undefined
        }
        // batch form: ordered, non-atomic; default stopOnError aborts the rest
        if (Array.isArray(args.actions)) {
          const stopOnError = args.stopOnError !== false
          const results = []
          for (const [index, action] of args.actions.entries()) {
            const refusal = refusalFor(action)
            results.push({ index, ok: refusal === undefined, refusal })
            // typing visibly changes the fake's content, so passive polls must move
            if (refusal === undefined && action.type === "type") typed += action.text
            if (refusal !== undefined && stopOnError) break
          }
          const failed = results.find((step) => !step.ok)
          ok({
            ok: failed === undefined,
            provider: "external",
            action: args.actions[0]?.type,
            refusal: failed?.refusal,
            results,
          })
          return
        }
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
        const refusal = refusalFor(action)
        if (refusal) {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              content: [{ type: "text", text: `${action.type} refused: ${refusal}` }],
              isError: true,
              structuredContent: { code: refusal },
            },
          })
          return
        }
        // typing visibly changes the fake's content, so passive polls must move
        if (action.type === "type") typed += action.text
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
