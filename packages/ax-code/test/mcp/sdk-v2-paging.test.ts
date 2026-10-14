import { expect, test } from "vitest"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { Server } from "@modelcontextprotocol/server"

// Locks the v2 SDK paging behaviour the MCP catalog relies on: the raw
// prompts/list request returns exactly one page, while the typed listPrompts()
// walks every page and throws past its cap when a server repeats a cursor.
async function connectRepeatingServer() {
  let calls = 0
  const server = new Server({ name: "repeat", version: "1.0.0" }, { capabilities: { prompts: {} } })
  server.setRequestHandler("prompts/list", async () => {
    calls++
    return { prompts: [{ name: `p${calls}` }], nextCursor: "stuck" }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "test", version: "1.0.0" }, { listMaxPages: 5 })
  await client.connect(clientTransport)
  return { client, server, calls: () => calls }
}

test("a raw prompts/list request reads one page and returns its cursor", async () => {
  const { client, server, calls } = await connectRepeatingServer()
  try {
    const page = await client.request({ method: "prompts/list", params: {} })
    expect(page.prompts.map((prompt) => prompt.name)).toEqual(["p1"])
    expect(page.nextCursor).toBe("stuck")
    expect(calls()).toBe(1)
  } finally {
    await client.close()
    await server.close()
  }
})

test("the typed listPrompts aggregates pages and throws when a server repeats a cursor", async () => {
  const { client, server, calls } = await connectRepeatingServer()
  try {
    await expect(client.listPrompts()).rejects.toThrow()
    expect(calls()).toBeGreaterThan(1)
  } finally {
    await client.close()
    await server.close()
  }
})
