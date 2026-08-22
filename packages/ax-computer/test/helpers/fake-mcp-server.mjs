// Fake MCP stdio server for StdioMcpClient tests.
// Newline-delimited JSON-RPC 2.0 on stdin/stdout. Modes (argv[2]):
//   basic         full handshake; tools/list; tools/call "echo" and "fail"
//   silent        answers initialize, then never responds again
//   exit          writes to stderr and exits immediately
//   crash-on-call answers the handshake, exits on the first tools/call
import process from "node:process"

const mode = process.argv[2] ?? "basic"

if (mode === "exit") {
  process.stderr.write("fake-mcp-server: cannot boot\n")
  process.exit(1)
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
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "fake-mcp", version: "0.0.0" },
      },
    })
    return
  }
  if (mode === "silent") return
  if (message.method === "notifications/initialized") return
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: [{ name: "echo", description: "echo arguments back", inputSchema: { type: "object" } }] },
    })
    return
  }
  if (message.method === "tools/call") {
    if (mode === "crash-on-call") process.exit(1)
    const params = message.params ?? {}
    if (params.name === "fail") {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "boom" }], isError: true } })
      return
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: JSON.stringify(params.arguments ?? {}) }] },
    })
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
