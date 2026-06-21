import fs from "fs/promises"
import path from "path"
import { afterEach, describe, expect, test } from "vitest"
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
                accessToken: "oauth-token",
                clientSecret: "client-secret",
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
              accessToken?: string
              clientSecret?: string
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
      expect(payload.provider?.openai?.options?.accessToken).toBe("[redacted]")
      expect(payload.provider?.openai?.options?.clientSecret).toBe("[redacted]")
      expect(payload.provider?.openai?.options?.baseURL).toBe("https://api.openai.com")
      expect(payload.mcp?.remote?.headers?.Authorization).toBe("[redacted]")
      expect(payload.mcp?.remote?.oauth?.clientSecret).toBe("[redacted]")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("patch response stays redacted and redacted sentinels do not overwrite secrets", async () => {
    const previousConfigPath = Global.Path.config
    await using tmp = await tmpdir()

    try {
      ;(Global.Path as { config: string }).config = tmp.path
      Config.global.reset()

      await fs.mkdir(tmp.path, { recursive: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await Filesystem.write(
        configPath,
        JSON.stringify({
          provider: {
            openai: {
              options: {
                apiKey: "openai-secret",
                accessToken: "oauth-token",
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
            local: {
              type: "local",
              command: ["node", "server.js"],
              environment: {
                TOKEN: "local-secret",
              },
            },
          },
        }),
      )

      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: {
            openai: {
              options: {
                apiKey: "[redacted]",
                accessToken: "[redacted]",
                baseURL: "https://proxy.example",
              },
            },
          },
          mcp: {
            remote: {
              type: "remote",
              url: "https://mcp.example",
              headers: {
                Authorization: "[redacted]",
              },
              oauth: {
                clientId: "client-id",
                clientSecret: "[redacted]",
              },
            },
            local: {
              type: "local",
              command: ["node", "server.js"],
              environment: {
                TOKEN: "[redacted]",
              },
            },
          },
        }),
      })
      expect(response.status).toBe(200)

      const payload = (await response.json()) as {
        provider?: Record<string, { options?: { apiKey?: string; accessToken?: string; baseURL?: string } }>
        mcp?: Record<string, { headers?: Record<string, string>; oauth?: { clientSecret?: string } }>
      }
      expect(payload.provider?.openai?.options?.apiKey).toBe("[redacted]")
      expect(payload.provider?.openai?.options?.accessToken).toBe("[redacted]")
      expect(payload.provider?.openai?.options?.baseURL).toBe("https://proxy.example")
      expect(payload.mcp?.remote?.headers?.Authorization).toBe("[redacted]")
      expect(payload.mcp?.remote?.oauth?.clientSecret).toBe("[redacted]")

      const stored = JSON.parse(await Filesystem.readText(configPath)) as {
        provider?: Record<string, { options?: { apiKey?: string; accessToken?: string; baseURL?: string } }>
        mcp?: Record<
          string,
          { headers?: Record<string, string>; oauth?: { clientSecret?: string }; environment?: Record<string, string> }
        >
      }
      expect(stored.provider?.openai?.options?.apiKey).toBe("openai-secret")
      expect(stored.provider?.openai?.options?.accessToken).toBe("oauth-token")
      expect(stored.provider?.openai?.options?.baseURL).toBe("https://proxy.example")
      expect(stored.mcp?.remote?.headers?.Authorization).toBe("Bearer mcp-secret")
      expect(stored.mcp?.remote?.oauth?.clientSecret).toBe("oauth-secret")
      expect(stored.mcp?.local?.environment?.TOKEN).toBe("local-secret")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("project config patch ignores redacted sentinels", async () => {
    await using tmp = await tmpdir({ git: true })
    const configPath = path.join(tmp.path, "ax-code.json")
    await Filesystem.write(
      configPath,
      JSON.stringify({
        provider: {
          openai: {
            options: {
              apiKey: "project-secret",
              accessToken: "project-token",
              baseURL: "https://api.openai.com",
            },
          },
        },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/config?directory=${encodeURIComponent(tmp.path)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: {
              openai: {
                options: {
                  apiKey: "[redacted]",
                  accessToken: "[redacted]",
                  baseURL: "https://proxy.example",
                },
              },
            },
          }),
        })
        expect(response.status).toBe(200)
        const payload = (await response.json()) as {
          provider?: Record<string, { options?: { apiKey?: string; accessToken?: string; baseURL?: string } }>
        }
        expect(payload.provider?.openai?.options?.apiKey).toBe("[redacted]")
        expect(payload.provider?.openai?.options?.accessToken).toBe("[redacted]")
        expect(payload.provider?.openai?.options?.baseURL).toBe("https://proxy.example")
      },
    })

    const stored = JSON.parse(await Filesystem.readText(configPath)) as {
      provider?: Record<string, { options?: { apiKey?: string; accessToken?: string; baseURL?: string } }>
    }
    expect(stored.provider?.openai?.options?.apiKey).toBe("project-secret")
    expect(stored.provider?.openai?.options?.accessToken).toBe("project-token")
    expect(stored.provider?.openai?.options?.baseURL).toBe("https://proxy.example")
  })
})
