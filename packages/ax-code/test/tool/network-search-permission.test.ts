import { describe, expect, test } from "vitest"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool/tool"
import { CodeSearchTool } from "../../src/tool/codesearch"
import { WebSearchTool } from "../../src/tool/websearch"
import { MessageID, SessionID } from "../../src/session/schema"

const stopAfterPermission = new Error("stop after permission")

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_network_search_permission"),
  messageID: MessageID.make("msg_network_search_permission"),
  callID: "call_network_search_permission",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("network search tool permissions", () => {
  test("websearch persistent permission is scoped to the query", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const tool = await WebSearchTool.init()
    const query = "private repo error signature"

    await expect(
      tool.execute(
        { query },
        {
          ...baseCtx,
          ask: async (request) => {
            requests.push(request)
            throw stopAfterPermission
          },
        },
      ),
    ).rejects.toBe(stopAfterPermission)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      permission: "websearch",
      patterns: [query],
      always: [query],
      metadata: { query },
    })
  })

  test("codesearch persistent permission is scoped to the query", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const tool = await CodeSearchTool.init()
    const query = "internal sdk partial prerendering example"

    await expect(
      tool.execute(
        { query, tokensNum: 5000 },
        {
          ...baseCtx,
          ask: async (request) => {
            requests.push(request)
            throw stopAfterPermission
          },
        },
      ),
    ).rejects.toBe(stopAfterPermission)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      permission: "codesearch",
      patterns: [query],
      always: [query],
      metadata: { query, tokensNum: 5000 },
    })
  })
})
