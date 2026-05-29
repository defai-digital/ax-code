import { describe, expect, test } from "bun:test"
import { createAxCodeClient } from "../src/client"
import { createAxCodeClient as createAxCodeClientV2 } from "../src/v2/client"

async function captureDirectoryHeaders(directory: string) {
  let request: Request | undefined
  const client = createAxCodeClient({
    baseUrl: "http://localhost",
    directory,
    fetch: async (req) => {
      request = req
      return new Response(JSON.stringify({ providers: [] }), {
        headers: { "content-type": "application/json" },
      })
    },
  })

  await client.config.providers()

  return {
    axCode: request?.headers.get("x-ax-code-directory"),
    opencode: request?.headers.get("x-opencode-directory"),
  }
}

async function captureV2Headers(options: { directory: string; workspaceID?: string }) {
  let request: Request | undefined
  const client = createAxCodeClientV2({
    baseUrl: "http://localhost",
    directory: options.directory,
    experimental_workspaceID: options.workspaceID,
    fetch: async (req) => {
      request = req
      return new Response(JSON.stringify({ providers: [] }), {
        headers: { "content-type": "application/json" },
      })
    },
  })

  await client.config.providers()

  return {
    axCodeDirectory: request?.headers.get("x-ax-code-directory"),
    opencodeDirectory: request?.headers.get("x-opencode-directory"),
    axCodeWorkspace: request?.headers.get("x-ax-code-workspace"),
    opencodeWorkspace: request?.headers.get("x-opencode-workspace"),
  }
}

describe("createAxCodeClient", () => {
  test("keeps ASCII directory headers unencoded", async () => {
    const headers = await captureDirectoryHeaders("/Users/john/a+b/My Projects/app")

    expect(headers).toEqual({
      axCode: "/Users/john/a+b/My Projects/app",
      opencode: "/Users/john/a+b/My Projects/app",
    })
  })

  test("encodes non-ASCII directory headers", async () => {
    const headers = await captureDirectoryHeaders("/tmp/測試")

    expect(headers).toEqual({
      axCode: "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
      opencode: "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
    })
  })

  test("applies directory and workspace headers to the v2 client", async () => {
    const headers = await captureV2Headers({
      directory: "/tmp/測試",
      workspaceID: "workspace-123",
    })

    expect(headers).toEqual({
      axCodeDirectory: "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
      opencodeDirectory: "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
      axCodeWorkspace: "workspace-123",
      opencodeWorkspace: "workspace-123",
    })
  })
})
