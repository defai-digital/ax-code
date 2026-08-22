import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { McpClientError, StdioMcpClient, assertSpawnableCommand } from "../src/mcp/stdio-client"

const server = fileURLToPath(new URL("./helpers/fake-mcp-server.mjs", import.meta.url))

function start(mode: string, requestTimeoutMs?: number) {
  return StdioMcpClient.start({ command: process.execPath, args: [server, mode], requestTimeoutMs })
}

describe("StdioMcpClient", () => {
  test("handshake, tools/list and tools/call round-trip", async () => {
    const client = await start("basic")
    try {
      const tools = await client.listTools()
      expect(tools.map((tool) => tool.name)).toEqual(["echo"])

      const result = await client.callTool("echo", { hello: "world" })
      expect(result.isError).toBeFalsy()
      expect(result.content?.[0]?.text).toBe('{"hello":"world"}')

      const failure = await client.callTool("fail", {})
      expect(failure.isError).toBe(true)
    } finally {
      await client.close()
    }
  })

  test("requests time out and reject with a timeout error", async () => {
    const client = await start("silent", 500)
    try {
      await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "timeout" })
    } finally {
      await client.close()
    }
  })

  test("server exit rejects pending requests; close is idempotent", async () => {
    const client = await start("crash-on-call")
    await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "exited" })
    await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "exited" })
    await client.close()
    await client.close()
  })

  test("spawn failure rejects start() with spawn_failed", async () => {
    await expect(StdioMcpClient.start({ command: "ax-computer-definitely-not-a-real-command" })).rejects.toMatchObject({
      code: "spawn_failed",
    })
  })

  test("early exit surfaces the stderr tail", async () => {
    await expect(start("exit")).rejects.toThrowError(/cannot boot/)
  })

  test("McpClientError is an Error subclass", () => {
    expect(new McpClientError("timeout", "x")).toBeInstanceOf(Error)
  })
})

describe("StdioMcpClient spawn command validation", () => {
  test("assertSpawnableCommand accepts a plain PATH name and an absolute path", () => {
    expect(() => assertSpawnableCommand("cua-driver")).not.toThrow()
    expect(() => assertSpawnableCommand("/usr/local/bin/ax-computer-driver")).not.toThrow()
  })

  test("assertSpawnableCommand rejects empty and control-character commands", () => {
    expect(() => assertSpawnableCommand("")).toThrowError(/non-empty/)
    expect(() => assertSpawnableCommand("   ")).toThrowError(/non-empty/)
    expect(() => assertSpawnableCommand(undefined)).toThrowError(/non-empty/)
    expect(() => assertSpawnableCommand("cua\ndriver")).toThrowError(/control characters/)
    expect(() => assertSpawnableCommand("cua\rdriver")).toThrowError(/control characters/)
    expect(() => assertSpawnableCommand("cua\0driver")).toThrowError(/control characters/)
  })

  test("start() rejects an invalid command with spawn_failed before spawning", async () => {
    await expect(StdioMcpClient.start({ command: "" })).rejects.toMatchObject({ code: "spawn_failed" })
    await expect(StdioMcpClient.start({ command: "evil\ninjection" })).rejects.toMatchObject({
      code: "spawn_failed",
    })
  })
})

describe("StdioMcpClient protocol hardening", () => {
  test("a non-object tools/call result is rejected as a protocol error", async () => {
    const client = await start("bad-result")
    try {
      await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "protocol" })
    } finally {
      await client.close()
    }
  })

  test("a non-array content field is rejected as a protocol error", async () => {
    const client = await start("bad-content")
    try {
      await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "protocol" })
    } finally {
      await client.close()
    }
  })

  test("an unterminated stdout line beyond the limit drops the connection", async () => {
    // the fake server floods stdout with one 64KB unterminated line after the
    // handshake; a small limit trips the cap without moving real megabytes
    const client = await StdioMcpClient.start({
      command: process.execPath,
      args: [server, "huge-line"],
      stdoutLineLimit: 1024,
    })
    try {
      await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: "protocol" })
    } finally {
      await client.close()
    }
  })
})
