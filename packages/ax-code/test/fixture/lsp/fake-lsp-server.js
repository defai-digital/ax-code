// Simple JSON-RPC 2.0 LSP-like fake server over stdio
// Implements a minimal LSP handshake and triggers a request upon notification

const net = require("net")

let nextId = 1
const initializeCapabilities = (() => {
  const raw = process.env.FAKE_LSP_CAPABILITIES_JSON
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
})()
const unsupportedMethods = new Set(
  (process.env.FAKE_LSP_UNSUPPORTED_METHODS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
)
const workspaceSymbolName = process.env.FAKE_LSP_WORKSPACE_SYMBOL ?? "DemoSymbol"
const initializeDelayMs = Math.max(0, Number(process.env.FAKE_LSP_INITIALIZE_DELAY_MS ?? "0") || 0)

function encode(message) {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")])
}

function decodeFrames(buffer) {
  const results = []
  let idx
  while ((idx = buffer.indexOf("\r\n\r\n")) !== -1) {
    const header = buffer.slice(0, idx).toString("utf8")
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    const len = m ? parseInt(m[1], 10) : 0
    const bodyStart = idx + 4
    const bodyEnd = bodyStart + len
    if (buffer.length < bodyEnd) break
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8")
    results.push(body)
    buffer = buffer.slice(bodyEnd)
  }
  return { messages: results, rest: buffer }
}

let readBuffer = Buffer.alloc(0)

process.stdin.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk])
  const { messages, rest } = decodeFrames(readBuffer)
  readBuffer = rest
  for (const m of messages) handle(m)
})

function send(msg) {
  process.stdout.write(encode(msg))
}

function sendRequest(method, params) {
  const id = nextId++
  send({ jsonrpc: "2.0", id, method, params })
  return id
}

function handle(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  if (data.method === "initialize") {
    const respond = () => send({ jsonrpc: "2.0", id: data.id, result: { capabilities: initializeCapabilities } })
    if (initializeDelayMs > 0) {
      setTimeout(respond, initializeDelayMs)
    } else {
      respond()
    }
    return
  }
  if (data.method === "initialized") {
    return
  }
  if (data.method === "workspace/didChangeConfiguration") {
    return
  }
  if (data.method === "test/trigger") {
    const method = data.params && data.params.method
    if (method) sendRequest(method, {})
    return
  }
  if (typeof data.id !== "undefined") {
    if (unsupportedMethods.has(data.method)) {
      send({
        jsonrpc: "2.0",
        id: data.id,
        error: {
          code: -32601,
          message: `Method not found: ${data.method}`,
        },
      })
      return
    }

    if (data.method === "workspace/symbol") {
      send({
        jsonrpc: "2.0",
        id: data.id,
        result: [
          {
            name: workspaceSymbolName,
            kind: 12,
            location: {
              uri: "file:///workspace/demo.ts",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
              },
            },
          },
        ],
      })
      return
    }
    // Respond OK to any request from client to keep transport flowing
    send({ jsonrpc: "2.0", id: data.id, result: null })
    return
  }
}
