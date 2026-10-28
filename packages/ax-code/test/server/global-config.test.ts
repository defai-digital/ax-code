import fs from "fs/promises"
import path from "path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  vi.unstubAllEnvs()
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

  test("hides per-model provider headers/options and image-generation keys", async () => {
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
            myapi: {
              options: { baseURL: "https://api.myapi.dev" },
              models: {
                "gpt-x": {
                  headers: { Authorization: "Bearer sk-model-secret" },
                  options: { apiKey: "sk-model-option-secret", temperature: 0.2 },
                },
              },
            },
          },
          image_generation: {
            provider: "openai",
            options: { apiKey: "sk-image-secret", baseURL: "https://img.example" },
          },
        }),
      )

      const response = await Server.Default().request("/global/config")
      expect(response.status).toBe(200)

      const payload = (await response.json()) as {
        provider?: Record<
          string,
          { models?: Record<string, { headers?: Record<string, string>; options?: Record<string, unknown> }> }
        >
        image_generation?: { options?: Record<string, unknown> }
      }

      // A per-model auth header and options bag the provider-level redaction
      // never reaches must be masked exactly like the provider options.
      expect(payload.provider?.myapi?.models?.["gpt-x"]?.headers?.Authorization).toBe("[redacted]")
      expect(payload.provider?.myapi?.models?.["gpt-x"]?.options?.apiKey).toBe("[redacted]")
      expect(payload.provider?.myapi?.models?.["gpt-x"]?.options?.temperature).toBe(0.2)
      expect(payload.image_generation?.options?.apiKey).toBe("[redacted]")
      expect(payload.image_generation?.options?.baseURL).toBe("https://img.example")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("patch does not persist redacted model headers/options or image-generation keys", async () => {
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
            myapi: {
              models: {
                "gpt-x": {
                  headers: { Authorization: "Bearer sk-model-secret" },
                  options: { apiKey: "sk-model-option-secret" },
                },
              },
            },
          },
          image_generation: { provider: "openai", options: { apiKey: "sk-image-secret" } },
        }),
      )

      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: {
            myapi: {
              models: {
                "gpt-x": { headers: { Authorization: "[redacted]" }, options: { apiKey: "[redacted]" } },
              },
            },
          },
          image_generation: { provider: "openai", options: { apiKey: "[redacted]" } },
        }),
      })
      expect(response.status).toBe(200)

      const payload = (await response.json()) as {
        provider?: Record<string, { models?: Record<string, { headers?: Record<string, string> }> }>
        image_generation?: { options?: Record<string, unknown> }
      }
      expect(payload.provider?.myapi?.models?.["gpt-x"]?.headers?.Authorization).toBe("[redacted]")
      expect(payload.image_generation?.options?.apiKey).toBe("[redacted]")

      const stored = JSON.parse(await Filesystem.readText(configPath)) as {
        provider?: Record<
          string,
          { models?: Record<string, { headers?: Record<string, string>; options?: Record<string, unknown> }> }
        >
        image_generation?: { options?: Record<string, unknown> }
      }
      expect(stored.provider?.myapi?.models?.["gpt-x"]?.headers?.Authorization).toBe("Bearer sk-model-secret")
      expect(stored.provider?.myapi?.models?.["gpt-x"]?.options?.apiKey).toBe("sk-model-option-secret")
      expect(stored.image_generation?.options?.apiKey).toBe("sk-image-secret")
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

  test("patch strips nested redacted sentinels instead of persisting them", async () => {
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
            "custom-gateway": {
              options: {
                baseURL: "https://gateway.example/v1",
                headers: { Authorization: "Bearer gw-secret" },
                fetchOptions: { headers: { "x-api-key": "nested-secret" } },
              },
            },
          },
        }),
      )

      // A client echoes the GET body back: nested secret values arrive as
      // the [redacted] sentinel and must be dropped, not written to disk.
      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: {
            "custom-gateway": {
              options: {
                baseURL: "https://gateway.example/v1",
                headers: { Authorization: "[redacted]" },
                fetchOptions: { headers: { "x-api-key": "[redacted]" } },
              },
            },
          },
        }),
      })
      expect(response.status).toBe(200)

      const payload = (await response.json()) as {
        provider?: Record<string, { options?: Record<string, unknown> }>
      }
      const responseOptions = payload.provider?.["custom-gateway"]?.options as {
        headers?: Record<string, string>
        fetchOptions?: { headers?: Record<string, string> }
      }
      // The response stays redacted at every depth.
      expect(responseOptions?.headers?.Authorization).toBe("[redacted]")
      expect(responseOptions?.fetchOptions?.headers?.["x-api-key"]).toBe("[redacted]")

      const stored = JSON.parse(await Filesystem.readText(configPath)) as {
        provider?: Record<string, { options?: Record<string, unknown> }>
      }
      const storedOptions = stored.provider?.["custom-gateway"]?.options as {
        baseURL?: string
        headers?: Record<string, string>
        fetchOptions?: { headers?: Record<string, string> }
      }
      // The stored file keeps the original secrets: echoed sentinels were
      // stripped from the patch instead of persisting "[redacted]" values.
      expect(storedOptions?.baseURL).toBe("https://gateway.example/v1")
      expect(storedOptions?.headers?.Authorization).toBe("Bearer gw-secret")
      expect(storedOptions?.fetchOptions?.headers?.["x-api-key"]).toBe("nested-secret")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("secrets nested past the redaction depth bound stay hidden and survive an echo", async () => {
    const previousConfigPath = Global.Path.config
    await using tmp = await tmpdir()

    try {
      ;(Global.Path as { config: string }).config = tmp.path
      Config.global.reset()

      // A secret 20 levels below options: deeper than any bounded walk reaches.
      const nest = (leaf: unknown) => {
        let node: unknown = leaf
        for (let i = 0; i < 20; i++) node = { level: node }
        return node
      }
      await fs.mkdir(tmp.path, { recursive: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      await Filesystem.write(
        configPath,
        JSON.stringify({
          provider: { "custom-gateway": { options: { deep: nest({ apiKey: "deep-secret" }) } } },
        }),
      )

      const read = await Server.Default().request("/global/config")
      expect(read.status).toBe(200)
      const body = await read.text()
      expect(body).not.toContain("deep-secret")

      // Echo the GET body back unchanged: the masked subtree must not
      // overwrite the stored one.
      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body,
      })
      expect(response.status).toBe(200)
      expect(await response.text()).not.toContain("deep-secret")
      expect(await Filesystem.readText(configPath)).toContain("deep-secret")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("patch of a redacted array keeps the stored element secrets", async () => {
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
            "custom-gateway": {
              options: {
                baseURL: "https://gateway.example/v1",
                endpoints: [{ url: "https://a.example/v1", apiKey: "endpoint-secret" }],
              },
            },
          },
        }),
      )

      // The echoed GET body carries the sentinel inside an array element.
      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: {
            "custom-gateway": {
              options: {
                baseURL: "https://gateway.example/v1",
                endpoints: [{ url: "https://a.example/v1", apiKey: "[redacted]" }],
              },
            },
          },
        }),
      })
      expect(response.status).toBe(200)

      const stored = JSON.parse(await Filesystem.readText(configPath)) as {
        provider?: Record<string, { options?: Record<string, unknown> }>
      }
      const endpoints = (stored.provider?.["custom-gateway"]?.options as { endpoints?: unknown[] } | undefined)
        ?.endpoints
      // `mergeDeep` replaces arrays wholesale, so dropping the sentinel inside
      // an element would erase the stored credential rather than preserve it
      // the way an omitted object key does.
      expect(endpoints).toEqual([{ url: "https://a.example/v1", apiKey: "endpoint-secret" }])
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("patch refuses an edited array that still holds redacted secrets", async () => {
    const previousConfigPath = Global.Path.config
    await using tmp = await tmpdir()

    try {
      ;(Global.Path as { config: string }).config = tmp.path
      Config.global.reset()

      await fs.mkdir(tmp.path, { recursive: true })
      const configPath = path.join(tmp.path, "ax-code.json")
      const original = JSON.stringify({
        provider: {
          "custom-gateway": {
            options: { endpoints: [{ url: "https://a.example/v1", apiKey: "endpoint-secret" }] },
          },
        },
      })
      await Filesystem.write(configPath, original)

      // The url changed but the element still echoes the sentinel: the stored
      // array cannot take the edit, so a 200 that changes nothing would lie.
      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: {
            "custom-gateway": {
              options: { endpoints: [{ url: "https://b.example/v1", apiKey: "[redacted]" }] },
            },
          },
        }),
      })
      expect(response.status).toBe(400)
      expect(JSON.parse(await Filesystem.readText(configPath)).provider).toEqual(JSON.parse(original).provider)
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("partial enablement patch keeps provider and mcp sections", async () => {
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
            "ax-trust-defai-digital": {
              management: "custom-api",
              name: "ax-trust.defai.digital",
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: "https://ax-trust.defai.digital/v1" },
            },
          },
          mcp: {
            remote: {
              type: "remote",
              url: "https://mcp.example",
              headers: {
                Authorization: "Bearer mcp-secret",
              },
            },
          },
        }),
      )

      // The TUI/Desktop provider disable flow patches only disabled_providers.
      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled_providers: ["deepseek"] }),
      })
      expect(response.status).toBe(200)

      const stored = JSON.parse(await Filesystem.readText(configPath)) as {
        disabled_providers?: string[]
        provider?: Record<string, { management?: string; options?: { baseURL?: string } }>
        mcp?: Record<string, { headers?: Record<string, string> }>
      }
      expect(stored.disabled_providers).toEqual(["deepseek"])
      expect(stored.provider?.["ax-trust-defai-digital"]?.management).toBe("custom-api")
      expect(stored.provider?.["ax-trust-defai-digital"]?.options?.baseURL).toBe("https://ax-trust.defai.digital/v1")
      expect(stored.mcp?.remote?.headers?.Authorization).toBe("Bearer mcp-secret")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("partial provider and mcp entry patch keeps the entry's unsent nested sections", async () => {
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
            local: {
              name: "Local",
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: "http://127.0.0.1:1234/v1" },
              models: { "qwen-coder": { name: "Qwen Coder" } },
            },
          },
          mcp: {
            remote: {
              type: "remote",
              url: "https://mcp.example",
              headers: { Authorization: "Bearer mcp-secret" },
              oauth: { clientId: "client-id" },
            },
            tools: { type: "local", command: ["tools-mcp"], environment: { TOKEN: "env-secret" } },
          },
        }),
      )

      // The TUI endpoint dialog patches only the provider's baseURL; the
      // entries below send only a field each.
      const response = await Server.Default().request("/global/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: { local: { options: { baseURL: "http://127.0.0.1:5678/v1" } } },
          mcp: {
            remote: { type: "remote", url: "https://mcp.example" },
            tools: { type: "local", command: ["tools-mcp"] },
          },
        }),
      })
      expect(response.status).toBe(200)

      const stored = JSON.parse(await Filesystem.readText(configPath)) as {
        provider?: Record<string, { options?: { baseURL?: string }; models?: Record<string, unknown> }>
        mcp?: Record<
          string,
          { headers?: Record<string, string>; oauth?: { clientId?: string }; environment?: Record<string, string> }
        >
      }
      expect(stored.provider?.local?.options?.baseURL).toBe("http://127.0.0.1:5678/v1")
      expect(stored.provider?.local?.models).toEqual({ "qwen-coder": { name: "Qwen Coder" } })
      expect(stored.mcp?.remote?.headers?.Authorization).toBe("Bearer mcp-secret")
      expect(stored.mcp?.remote?.oauth?.clientId).toBe("client-id")
      expect(stored.mcp?.tools?.environment?.TOKEN).toBe("env-secret")
    } finally {
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("config PATCH refuses a changed MCP URL that still carries redacted credentials", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")

    await using tmp = await tmpdir({ git: true })
    const configPath = path.join(tmp.path, "ax-code.json")
    const url = "https://fixture-user:fixture-pass@remote.test/mcp"
    await Filesystem.write(configPath, JSON.stringify({ mcp: { remote: { type: "remote", url } } }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const query = `directory=${encodeURIComponent(tmp.path)}`
        const write = await Server.Default().request(`/config?${query}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mcp: { remote: { type: "remote", url: "https://[redacted]@other.test/mcp" } } }),
        })
        // Keeping the old URL would report success for an edit that never
        // happened; re-attaching the credentials would send them to a new host.
        expect(write.status).toBe(400)
      },
    })

    const stored = JSON.parse(await Filesystem.readText(configPath)) as { mcp: Record<string, { url: string }> }
    expect(stored.mcp.remote.url).toBe(url)
  })

  test("config GET redacts credentials in a remote MCP URL and PATCH keeps the stored URL", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")

    await using tmp = await tmpdir({ git: true })
    const configPath = path.join(tmp.path, "ax-code.json")
    const url = "https://fixture-user:fixture-pass@remote.test/mcp?x=1"
    await Filesystem.write(configPath, JSON.stringify({ mcp: { remote: { type: "remote", url } } }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const query = `directory=${encodeURIComponent(tmp.path)}`
        const read = await Server.Default().request(`/config?${query}`)
        expect(read.status).toBe(200)
        const body = (await read.json()) as { mcp?: Record<string, { url?: string }> }
        expect(body.mcp?.remote?.url).toBe("https://[redacted]@remote.test/mcp?x=1")
        expect(JSON.stringify(body)).not.toContain("fixture-pass")

        const write = await Server.Default().request(`/config?${query}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mcp: body.mcp }),
        })
        expect(write.status).toBe(200)
      },
    })

    const stored = JSON.parse(await Filesystem.readText(configPath)) as { mcp: Record<string, { url: string }> }
    expect(stored.mcp.remote.url).toBe(url)
  })

  test("project config patch ignores redacted sentinels", async () => {
    // This test verifies preservation of existing project-level credentials,
    // which are available only after the checkout has been explicitly trusted.
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")

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
