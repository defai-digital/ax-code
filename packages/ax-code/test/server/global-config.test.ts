import fs from "fs/promises"
import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
})

describe("/global/config redaction", () => {
  test("hides provider and MCP secrets", async () => {
    const previousConfigPath = Global.Path.config
    await using tmp = await tmpdir()

    try {
      ;(Global.Path as { config: string }).config = tmp.path
      Config.global.reset()

      await fs.mkdir(tmp.path, { recursive: true })
      await Filesystem.write(
        path.join(tmp.path, "ax-code.json"),
        JSON.stringify({
          provider: {
            openai: {
              options: {
                apiKey: "openai-secret",
                baseURL: "https://api.openai.com",
              },
            },
          },
          mcp: {
            remote: {
              type: "remote",
              url: "https://mcp.example",
              headers: {
                Authorization: "Bearer mcp-secret",
              },
              oauth: {
                clientId: "client-id",
                clientSecret: "oauth-secret",
              },
            },
          },
        }),
      )

      const response = await Server.Default().request("/global/config")
      expect(response.status).toBe(200)

      const payload = (await response.json()) as {
        provider?: Record<
          string,
          {
            options?: {
              apiKey?: string
              baseURL?: string
            }
          }
        >
        mcp?: Record<
          string,
          {
            type?: string
            headers?: Record<string, string | undefined>
            oauth?: { clientSecret?: string }
          }
        >
      }

      expect(payload.provider?.openai?.options?.apiKey).toBe("[redacted]")
      expect(payload.provider?.openai?.options?.baseURL).toBe("https://api.openai.com")
      expect(payload.mcp?.remote?.headers?.Authorization).toBe("[redacted]")
      expect(payload.mcp?.remote?.oauth?.clientSecret).toBe("[redacted]")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })
})
