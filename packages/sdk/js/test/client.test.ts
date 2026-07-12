import { describe, expect, test } from "vitest"
import { createAxCodeClient } from "../src/client"
import { createAxCodeClient as createAxCodeClientV2 } from "../src/v2/client"
import type { AppErrorEnvelope } from "../src/gen/types.gen"

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
  test("rejects remote AX Code base URLs in v1 and v2 clients", () => {
    expect(() => createAxCodeClient({ baseUrl: "https://ax-code.example.com" })).toThrow("local-only")
    expect(() => createAxCodeClientV2({ baseUrl: "https://ax-code.example.com" })).toThrow("local-only")
  })

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

  test("exposes structured error envelopes to SDK callers", async () => {
    const envelope: AppErrorEnvelope = {
      name: "UnknownError",
      message: "Internal server error",
      status: 500,
      logRef: "err_sdkvisible",
      retryable: false,
    }
    const fetch = async () =>
      new Response(JSON.stringify(envelope), {
        status: envelope.status,
        headers: { "content-type": "application/json" },
      })

    const v1 = createAxCodeClient({
      baseUrl: "http://localhost",
      fetch,
    })
    const v2 = createAxCodeClientV2({
      baseUrl: "http://localhost",
      fetch,
    })

    const v1Result = await v1.session.get({ sessionID: "session_missing" })
    const v2Result = await v2.session.get({ sessionID: "session_missing" })

    expect(v1Result.error).toMatchObject(envelope)
    expect(v2Result.error).toMatchObject(envelope)
  })

  test("sends and receives session product metadata", async () => {
    const requests: Request[] = []
    const fetch = async (request: Request) => {
      requests.push(request)
      return new Response(
        JSON.stringify({
          id: "session_1",
          title: "SDK metadata",
          metadata: {
            app: { pinned: true, label: "Pinned" },
            queue: { queueItemId: "task_1", source: "manual" },
          },
        }),
        {
          headers: { "content-type": "application/json" },
        },
      )
    }
    const client = createAxCodeClient({
      baseUrl: "http://localhost",
      fetch,
    })

    const result = await client.session.update({
      sessionID: "session_1",
      metadata: {
        app: { pinned: true, label: "Pinned" },
        queue: { queueItemId: "task_1", source: "manual" },
      },
    })

    expect(result.data?.metadata).toEqual({
      app: { pinned: true, label: "Pinned" },
      queue: { queueItemId: "task_1", source: "manual" },
    })
    expect(await requests[0].json()).toEqual({
      metadata: {
        app: { pinned: true, label: "Pinned" },
        queue: { queueItemId: "task_1", source: "manual" },
      },
    })
  })
})
