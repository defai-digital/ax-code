import { afterEach, describe, expect, test, vi } from "vitest"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { SessionID } from "../../src/session/schema"
import { WebMcpAutoApproval } from "../../src/mcp/webmcp-auto-approval"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function autoEnv(mode = "workspace-write", auto = true) {
  vi.stubEnv("AX_CODE_AUTONOMOUS", auto ? "1" : "0")
  vi.stubEnv("AX_CODE_ISOLATION_MODE", mode)
  vi.stubEnv("AX_CODE_PERMISSION_IDLE_ONCE_MS", "10000")
}

function request(permission = "webmcp", metadata: Record<string, unknown> = { tool: "list_pages", server: "bridge" }) {
  return {
    sessionID: SessionID.make("ses_webmcp_auto"),
    permission,
    patterns: ["bridge_list_pages"],
    always: [],
    metadata,
    ruleset: [] as Permission.Ruleset,
  }
}

function bind(
  input: ReturnType<typeof request>,
  valid: () => Promise<boolean> = async () => true,
  toolName = "list_pages",
) {
  const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
  WebMcpAutoApproval.bindBridge(input.metadata, { server: "bridge", profile, toolName }, input, valid)
}

async function rejectPending(input: ReturnType<typeof request>, options?: { signal: AbortSignal }) {
  const asked: Permission.Request[] = []
  const stop = Bus.subscribe(Permission.Event.Asked, (event) => {
    asked.push(event.properties)
    void Permission.reply({ requestID: event.properties.id, reply: "reject" })
  })
  try {
    await expect(Permission.ask(input, options)).rejects.toThrow("rejected")
    expect(asked).toHaveLength(1)
    return asked[0]!
  } finally {
    stop()
  }
}

describe("runtime-bound WebMCP approval in Auto mode", () => {
  test.each(["workspace-write", "read-only", "full-access"])(
    "%s admits both permission layers without a pending event",
    async (mode) => {
      autoEnv(mode)
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const asked = vi.fn()
          const stop = Bus.subscribe(Permission.Event.Asked, asked)
          try {
            for (const permission of ["bridge_list_pages", "webmcp"]) {
              const input = request(permission)
              bind(input)
              await Permission.ask(input)
            }
            expect(asked).not.toHaveBeenCalled()
            expect(await Permission.list()).toEqual([])
          } finally {
            stop()
          }
        },
      })
    },
  )

  test.each(["new_page", "navigate_page", "list_webmcp_tools", "read", "interact"])(
    "%s uses runtime authority without creating a saved approval",
    async (operation) => {
      autoEnv()
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = request("webmcp", {
            server: "bridge",
            ...(operation === "read" ? { readGrant: true } : operation === "interact" ? { interactGrant: true } : {}),
          })
          bind(
            input,
            async () => true,
            operation === "read" ? "take_snapshot" : operation === "interact" ? "click" : operation,
          )
          await Permission.ask(input)
          expect(await Permission.list()).toEqual([])
        },
      })
    },
  )

  test.each([
    ["workspace-write", false],
    ["read-only", false],
    ["full-access", false],
  ] as const)("mode %s with Auto=%s retains existing prompts", async (mode, auto) => {
    autoEnv(mode, auto)
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = request()
        bind(input)
        await rejectPending(input)
      },
    })
  })

  test.each(["close_page", "execute_webmcp_tool", "fill", "fill_form", "press_key", "handle_dialog", "click"])(
    "%s cannot be auto-approved using page read-only annotations",
    async (tool) => {
      autoEnv()
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = request("webmcp", {
            tool,
            ...(WebMcpProfile.isInteractTool(tool) ? { interactAction: true } : {}),
            annotations: { readOnly: true, consequential: false },
          })
          bind(input, async () => true, tool)
          expect((await rejectPending(input)).autoOnceAt).toBeUndefined()
        },
      })
    },
  )

  test.each([{ originGrant: true }, { interactAction: true }, { requireInteractive: true }])(
    "an explicit protected operation %j retains a prompt",
    async (extra) => {
      autoEnv()
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = request("webmcp", { tool: "navigate_page", ...extra })
          bind(input, async () => true, "navigate_page")
          await rejectPending(input)
        },
      })
    },
  )

  test.each(["fill", "fill_form", "press_key", "handle_dialog", "click", "close_page", "execute_webmcp_tool"])(
    "full-access Auto admits repeated runtime-bound %s at both permission layers",
    async (tool) => {
      autoEnv("full-access")
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const asked = vi.fn()
          const stop = Bus.subscribe(Permission.Event.Asked, asked)
          try {
            for (let repeat = 0; repeat < 2; repeat++) {
              for (const permission of [`bridge_${tool}`, "webmcp"]) {
                const input = request(permission, {
                  server: "bridge",
                  tool,
                  ...(WebMcpProfile.isInteractTool(tool) ? { interactAction: true } : {}),
                })
                input.patterns = [`bridge_${tool}`]
                bind(input, async () => true, tool)
                await Permission.ask(input)
              }
            }
            expect(asked).not.toHaveBeenCalled()
            expect(await Permission.list()).toEqual([])
          } finally {
            stop()
          }
        },
      })
    },
  )

  test.each([
    ["read-only", true],
    ["workspace-write", true],
    ["full-access", false],
  ] as const)("protected operations retain prompts in %s with Auto=%s", async (mode, auto) => {
    autoEnv(mode, auto)
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const tool of [
          "fill",
          "fill_form",
          "press_key",
          "handle_dialog",
          "click",
          "close_page",
          "execute_webmcp_tool",
        ]) {
          const input = request("webmcp", {
            server: "bridge",
            tool,
            ...(WebMcpProfile.isInteractTool(tool) ? { interactAction: true } : {}),
          })
          bind(input, async () => true, tool)
          const pending = await rejectPending(input)
          expect(pending.autoOnceAt).toBeUndefined()
        }
      },
    })
  })

  test.each(["read-only", "workspace-write", "full-access"])(
    "%s cannot grant authority to unsupported tools or explicit interactive markers",
    async (mode) => {
      autoEnv(mode)
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          for (const tool of ["evaluate_script", "upload_file", "type_text"]) {
            const input = request("webmcp", { server: "bridge", tool, interactAction: true })
            bind(input, async () => true, tool)
            await rejectPending(input)
          }
          for (const extra of [{ requireInteractive: true }, { originGrant: true }]) {
            const input = request("webmcp", { server: "bridge", tool: "fill", interactAction: true, ...extra })
            bind(input, async () => true, "fill")
            await rejectPending(input)
          }
        },
      })
    },
  )

  test.each(["forged", "identity", "disconnect", "supervised", "sandbox", "deny", "abort", "ceiling"])(
    "full-access action authority cannot bypass %s",
    async (change) => {
      autoEnv("full-access")
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = request("webmcp", { server: "bridge", tool: "fill", interactAction: true })
          const controller = new AbortController()
          bind(
            input,
            async () => {
              if (change === "disconnect") return false
              if (change === "supervised") vi.stubEnv("AX_CODE_AUTONOMOUS", "0")
              if (change === "sandbox") vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
              if (change === "deny") {
                await Config.update({ permission: { webmcp: "deny" } })
                await Config.get()
              }
              if (change === "abort") controller.abort(new Error("Canceled action"))
              if (change === "ceiling") {
                const current = Config.peek()!
                vi.spyOn(Config, "peek").mockReturnValue({ ...current, webmcp: { allowInteract: false } })
              }
              return true
            },
            "fill",
          )
          if (change === "forged") await rejectPending({ ...input, metadata: { ...input.metadata } })
          else if (change === "identity") await rejectPending({ ...input, patterns: ["bridge_click"] })
          else if (change === "deny") await expect(Permission.ask(input)).rejects.toBeInstanceOf(Permission.DeniedError)
          else if (change === "abort")
            await expect(Permission.ask(input, { signal: controller.signal })).rejects.toThrow("Canceled action")
          else await rejectPending(input)
        },
      })
    },
  )

  test.each([
    ["execute_webmcp_tool", { readGrant: true }],
    ["execute_webmcp_tool", { interactGrant: true }],
    ["navigate_page", { interactAction: true }],
    ["fill", { readGrant: true }],
    ["click", { interactGrant: true, interactAction: true }],
  ] as const)("mismatched markers cannot downgrade %s authority", async (tool, extra) => {
    autoEnv("full-access")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = request("webmcp", { server: "bridge", tool, ...extra })
        bind(input, async () => true, tool)
        await rejectPending(input)
      },
    })
  })

  test("rejecting a rebound metadata object retires its earlier runtime authority", async () => {
    autoEnv("full-access")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = request()
        bind(input)
        input.metadata.originGrant = true
        const profile = WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp
        WebMcpAutoApproval.bindBridge(
          input.metadata,
          { server: "bridge", profile, toolName: "list_pages" },
          input,
          async () => true,
          { tool: "list_pages" },
        )
        await rejectPending(input)
      },
    })
  })

  test("serialized metadata and changed permission or pattern identities cannot reuse runtime authority", async () => {
    autoEnv()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = request()
        bind(input)
        await rejectPending({ ...input, metadata: { ...input.metadata } })
        await rejectPending({ ...input, permission: "hook" })
        await rejectPending({ ...input, patterns: ["bridge_execute_webmcp_tool"] })
      },
    })
  })

  test("disconnect or a changed connection fails closed", async () => {
    autoEnv()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = request()
        bind(input, async () => false)
        await rejectPending(input)
      },
    })
  })

  test.each(["ruleset", "config"])("an explicit %s deny wins before connection validation", async (source) => {
    autoEnv()
    await using tmp = await tmpdir({
      git: true,
      ...(source === "config" ? { config: { permission: { webmcp: "deny" } } } : {}),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = request()
        if (source === "ruleset") input.ruleset = [{ permission: "webmcp", pattern: "*", action: "deny" }]
        const valid = vi.fn(async () => true)
        bind(input, valid)
        await expect(Permission.ask(input)).rejects.toBeInstanceOf(Permission.DeniedError)
        expect(valid).not.toHaveBeenCalled()
        expect(await Permission.list()).toEqual([])
      },
    })
  })

  test.each(["mode", "deny", "abort"])(
    "a %s change during connection validation prevents admission",
    async (change) => {
      autoEnv()
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const input = request()
          const controller = new AbortController()
          bind(input, async () => {
            if (change === "mode") vi.stubEnv("AX_CODE_AUTONOMOUS", "0")
            if (change === "deny") {
              await Config.update({ permission: { webmcp: "deny" } })
              await Config.get()
            }
            if (change === "abort") controller.abort(new Error("Stopped during browser validation"))
            return true
          })
          if (change === "mode") await rejectPending(input)
          else if (change === "deny") await expect(Permission.ask(input)).rejects.toBeInstanceOf(Permission.DeniedError)
          else
            await expect(Permission.ask(input, { signal: controller.signal })).rejects.toThrow(
              "Stopped during browser validation",
            )
        },
      })
    },
  )

  test.each([{ allow: false }, { allowRead: false }, { allowInteract: false }])(
    "managed ceiling %j prevents automatic admission",
    async (policy) => {
      autoEnv()
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Config.get()
          const current = Config.peek()!
          vi.spyOn(Config, "peek").mockImplementation(() => ({ ...current, webmcp: policy }))
          const input = request("webmcp", {
            server: "bridge",
            ...(policy.allowRead === false
              ? { readGrant: true }
              : policy.allowInteract === false
                ? { interactGrant: true }
                : {}),
          })
          bind(
            input,
            async () => true,
            policy.allowRead === false ? "take_snapshot" : policy.allowInteract === false ? "click" : "list_pages",
          )
          await rejectPending(input)
        },
      })
    },
  )
})
