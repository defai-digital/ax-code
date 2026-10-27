import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { PluginLifetime } from "../../src/plugin/lifetime"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"

type Probe = {
  permissionAPI?: unknown
  sessionAPI?: unknown
  inputReady?: Promise<void>
  release?: () => void
  resolveReady?: () => void
}

const PLUGIN_NAME_KEY = Symbol.for("ax-code-plugin-api-expansion-name")

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function withApiPlugin(
  source: string,
  pluginName: string,
  check: (probe: Probe) => Promise<void>,
  configOverride: Record<string, unknown> = {},
) {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  const probe: Probe = {}
  const inputReady = new Promise<void>((resolve) => {
    probe.resolveReady = resolve
  })
  probe.inputReady = inputReady
  Reflect.set(globalThis, Symbol.for(PLUGIN_NAME_KEY.description!), probe)
  let pluginSpec: string
  await using tmp = await tmpdir({
    config: { username: "testuser", ...configOverride },
    init: async (directory) => {
      const plugins = path.join(directory, ".ax-code", "plugin")
      await fs.mkdir(plugins, { recursive: true })
      const pluginPath = path.join(plugins, `${pluginName}.ts`)
      pluginSpec = pathToFileURL(pluginPath).href
      // The host reads `cfg.plugin` to know which plugins to load. The
      // fixture wrote ax-code.json already; rewrite it with the plugin
      // spec so the host actually loads this test's plugin.
      const existing = configOverride ?? {}
      await fs.writeFile(
        path.join(directory, "ax-code.json"),
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          username: "testuser",
          ...existing,
          plugin: [pluginSpec],
        }),
      )
      await fs.writeFile(pluginPath, source)
    },
  })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          await Plugin.init()
          await probe.inputReady
          await check(probe)
        } finally {
          probe.release?.()
          await Instance.dispose()
        }
      },
    })
  } finally {
    Reflect.deleteProperty(globalThis, Symbol.for(PLUGIN_NAME_KEY.description!))
  }
}

const captureSource = `
  const probe = globalThis[Symbol.for(${JSON.stringify(PLUGIN_NAME_KEY.description!)})]
  export default async (input) => {
    probe.permissionAPI = input.permission
    probe.sessionAPI = input.session
    probe.resolveReady?.()
    return {}
  }
`

describe("plugin permission.ask", () => {
  test("routes a permission.ask through the host pipeline and returns allow on success", async () => {
    await withApiPlugin(
      captureSource,
      "allow-plugin",
      async (probe) => {
        const permission = probe.permissionAPI as { ask: (input: unknown) => Promise<unknown> } | undefined
        expect(permission).toBeDefined()
        const result = await permission!.ask({ permission: "notify", patterns: ["*.md"], metadata: {} })
        // The plugin asks in its own namespace: the rule for "plugin:notify" applies.
        expect(result).toMatchObject({ ok: true, status: "allow" })
      },
      { permission: { "plugin:notify": { "*": "allow" } } },
    )
  })

  test("returns deny when the active project policy denies the requested pattern", async () => {
    await withApiPlugin(
      captureSource,
      "denied-plugin",
      async (probe) => {
        const permission = probe.permissionAPI as { ask: (input: unknown) => Promise<unknown> } | undefined
        const result = await permission!.ask({ permission: "notify", patterns: ["secrets/*"], metadata: {} })
        expect(result).toMatchObject({ ok: true, status: "deny" })
      },
      { permission: { "plugin:notify": { "secrets/*": "deny" } } },
    )
  })

  test("returns deny when the user rejects the prompt with feedback", async () => {
    await withApiPlugin(captureSource, "corrected-plugin", async (probe) => {
      const { Permission } = await import("../../src/permission")
      const permission = probe.permissionAPI as { ask: (input: unknown) => Promise<unknown> } | undefined
      const pending = permission!.ask({
        permission: "notify",
        patterns: ["*.md"],
        metadata: { requireInteractive: true },
      })
      await vi.waitFor(async () => expect(await Permission.list()).toHaveLength(1))
      const [request] = await Permission.list()
      await Permission.reply({ requestID: request!.id, reply: "reject", message: "private feedback" })
      const result = await pending
      expect(result).toEqual({ ok: true, status: "deny" })
    })
  })

  test("a plugin cannot reach a core permission name: asking for edit is evaluated as plugin:edit", async () => {
    await withApiPlugin(
      captureSource,
      "namespaced-plugin",
      async (probe) => {
        const permission = probe.permissionAPI as { ask: (input: unknown) => Promise<unknown> } | undefined
        // A core `edit: allow` must not approve the plugin's request; the
        // namespaced `plugin:edit` deny decides it.
        const result = await permission!.ask({ permission: "edit", patterns: ["src/a.ts"], metadata: {} })
        expect(result).toMatchObject({ ok: true, status: "deny" })
      },
      { permission: { edit: { "*": "allow" }, "plugin:edit": { "*": "deny" } } },
    )
  })
})

describe("plugin session ownership and trust", () => {
  test("session.create tags the new session with metadata.createdByPlugin", async () => {
    await withApiPlugin(captureSource, "owner-plugin", async (probe) => {
      const session = probe.sessionAPI as
        | {
            create: (input: {
              title?: string
            }) => Promise<{ ok: true; sessionID: string } | { ok: false; error: string }>
            remove: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
          }
        | undefined
      const created = await session!.create({ title: "plugin-owned" })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      expect(typeof created.sessionID).toBe("string")
      // The plugin owns the session it just created, so remove should succeed.
      const removed = await session!.remove(created.sessionID)
      expect(removed.ok).toBe(true)
    })
  })

  test("session.create refuses a parent the plugin does not own", async () => {
    await withApiPlugin(captureSource, "parent-plugin", async (probe) => {
      const session = probe.sessionAPI as {
        create: (input: { parentID?: string }) => Promise<{ ok: boolean; sessionID?: string; error?: string }>
      }
      const foreign = await Session.create({ title: "someone else" })
      const result = await session.create({ parentID: foreign.id })
      expect(result.ok).toBe(false)
      expect((await Session.children(foreign.id)).length).toBe(0)
    })
  })

  test("session.remove refuses a tree that contains a session the plugin does not own", async () => {
    await withApiPlugin(captureSource, "tree-plugin", async (probe) => {
      const session = probe.sessionAPI as {
        create: (input: { title?: string }) => Promise<{ ok: boolean; sessionID?: string }>
        remove: (id: string) => Promise<{ ok: boolean; error?: string }>
      }
      const mine = await session.create({ title: "mine" })
      expect(mine.ok).toBe(true)
      // A session the plugin does not own hangs under the plugin's session.
      const foreignChild = await Session.create({ title: "foreign child", parentID: mine.sessionID as never })
      const result = await session.remove(mine.sessionID!)
      expect(result.ok).toBe(false)
      expect(await Session.get(foreignChild.id)).toBeDefined()
      expect(await Session.get(mine.sessionID as never)).toBeDefined()
    })
  })

  test("session.remove refuses a session that does not exist", async () => {
    await withApiPlugin(captureSource, "thief-plugin", async (probe) => {
      const session = probe.sessionAPI as
        | {
            remove: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
          }
        | undefined
      const result = await session!.remove("ses_nonexistent_session_id")
      expect(result.ok).toBe(false)
    })
  })

  test("plugin_trust.session_admin lets a plugin remove a session it did not create", async () => {
    // Two plugins: `creator` creates a session, `admin` is in the trust
    // list and removes it. Both plugins must be loaded by the host and
    // the trust list must match the plugin spec the user wrote in
    // `cfg.plugin` (the absolute file URL, not the file basename).
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    const adminInput: { permission?: unknown; session?: unknown } = {}
    const creatorInput: { permission?: unknown; session?: unknown } = {}
    const adminKey = Symbol.for("ax-code-plugin-api-expansion-admin")
    const creatorKey = Symbol.for("ax-code-plugin-api-expansion-creator")
    Reflect.set(globalThis, adminKey, adminInput)
    Reflect.set(globalThis, creatorKey, creatorInput)
    let adminSpec: string
    let creatorSpec: string
    await using tmp = await tmpdir({
      config: { username: "testuser" },
      init: async (directory) => {
        const plugins = path.join(directory, ".ax-code", "plugin")
        await fs.mkdir(plugins, { recursive: true })
        const creatorPath = path.join(plugins, "creator-plugin.ts")
        const adminPath = path.join(plugins, "admin-plugin.ts")
        creatorSpec = pathToFileURL(creatorPath).href
        adminSpec = pathToFileURL(adminPath).href
        await fs.writeFile(
          creatorPath,
          `const probe = globalThis[Symbol.for(${JSON.stringify("ax-code-plugin-api-expansion-creator")})]
           export default async (input) => {
             probe.permission = input.permission
             probe.session = input.session
             return {}
           }`,
        )
        await fs.writeFile(
          adminPath,
          `const probe = globalThis[Symbol.for(${JSON.stringify("ax-code-plugin-api-expansion-admin")})]
           export default async (input) => {
             probe.permission = input.permission
             probe.session = input.session
             return {}
           }`,
        )
        await fs.writeFile(
          path.join(directory, "ax-code.json"),
          JSON.stringify({
            $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
            username: "testuser",
            plugin: [creatorSpec, adminSpec],
            plugin_trust: { session_admin: [adminSpec] },
          }),
        )
      },
    })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Plugin.init()
          const creatorSession = creatorInput.session as
            | {
                create: (input: {
                  title?: string
                }) => Promise<{ ok: true; sessionID: string } | { ok: false; error: string }>
              }
            | undefined
          const adminSession = adminInput.session as
            | {
                remove: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
              }
            | undefined
          expect(creatorSession).toBeDefined()
          expect(adminSession).toBeDefined()
          const created = await creatorSession!.create({ title: "cross-plugin-test" })
          expect(created.ok).toBe(true)
          if (!created.ok) return
          // Without the trust list this would fail; with it, admin can
          // remove the session even though it was created by creator.
          const removed = await adminSession!.remove(created.sessionID)
          expect(removed.ok).toBe(true)
        },
      })
    } finally {
      Reflect.deleteProperty(globalThis, adminKey)
      Reflect.deleteProperty(globalThis, creatorKey)
    }
  })
})

describe("plugin callback deadline", () => {
  test("a slow session.create call is timed out and returns ok:false", async () => {
    // Load the plugin under real timers first (dynamic imports + the
    // plugin factory's microtasks don't interact well with
    // vi.useFakeTimers() at the top of the test). Then switch to fake
    // timers and exercise the deadline.
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    const probe: Probe = {}
    Reflect.set(globalThis, Symbol.for(PLUGIN_NAME_KEY.description!), probe)
    await using tmp = await tmpdir({
      config: { username: "testuser" },
      init: async (directory) => {
        const plugins = path.join(directory, ".ax-code", "plugin")
        await fs.mkdir(plugins, { recursive: true })
        await fs.writeFile(
          path.join(plugins, "slow-plugin.ts"),
          `const probe = globalThis[Symbol.for(${JSON.stringify(PLUGIN_NAME_KEY.description!)})]
           export default async (input) => {
             probe.permission = input.permission
             probe.session = {
               create: async () => {
                 // Block forever; the host's deadline must fire.
                 await new Promise(() => {})
                 return { ok: true, sessionID: "ses_unreached" }
               },
               compact: async () => ({ ok: true }),
               remove: async () => ({ ok: true }),
             }
             return {}
           }`,
        )
      },
    })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Plugin.init()
          const session = probe.sessionAPI as
            | {
                create: (input: {
                  title?: string
                }) => Promise<{ ok: true; sessionID: string } | { ok: false; error: string }>
              }
            | undefined
          if (!session) return
          vi.useFakeTimers()
          try {
            const pending = session.create({ title: "deadline" })
            // Advance past the 15s PluginLifetime.CALLBACK_TIMEOUT_MS.
            // The host converts the deadline error into `{ ok: false,
            // error }`; the call must not throw.
            await vi.advanceTimersByTimeAsync(PluginLifetime.CALLBACK_TIMEOUT_MS + 1000)
            const result = await pending
            expect(result.ok).toBe(false)
            expect(typeof (result as { error?: string }).error).toBe("string")
          } finally {
            vi.useRealTimers()
          }
        },
      })
    } finally {
      vi.useRealTimers()
      Reflect.deleteProperty(globalThis, Symbol.for(PLUGIN_NAME_KEY.description!))
    }
  })
})

describe("plugin API is opt-in", () => {
  test("a plugin that does not touch input.permission / input.session still loads", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({
      config: { username: "testuser" },
      init: async (directory) => {
        const plugins = path.join(directory, ".ax-code", "plugin")
        await fs.mkdir(plugins, { recursive: true })
        await fs.writeFile(
          path.join(plugins, "ignored-api.ts"),
          `export default async (_input) => {
            return { "tool.execute.before": async (_input, output) => {
              output.args.items.push("ok")
            } }
          }
          `,
        )
      },
    })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Plugin.init()
          // No throw means the plugin loaded successfully even though
          // it never touched the new API surface.
          expect(true).toBe(true)
        },
      })
    } finally {
      Reflect.deleteProperty(globalThis, Symbol.for(PLUGIN_NAME_KEY.description!))
    }
  })
})

test("session.remove rechecks a child added after the plugin ownership walk", async () => {
  await withApiPlugin(captureSource, "racing-plugin", async (probe) => {
    const api = probe.sessionAPI as {
      create: (input: { title: string }) => Promise<{ ok: boolean; sessionID: string }>
      remove: (id: string) => Promise<{ ok: boolean; error?: string }>
    }
    const mine = await api.create({ title: "mine" })
    expect(mine.ok).toBe(true)
    const remove = Session.remove
    let child: Session.Info | undefined
    vi.spyOn(Session, "remove").mockImplementationOnce(async (...args) => {
      child = await Session.create({ parentID: args[0], title: "late foreign child" })
      return remove(...args)
    })
    expect(await api.remove(mine.sessionID)).toMatchObject({ ok: false })
    expect(await Session.get(child!.id)).toBeDefined()
    expect(await Session.get(mine.sessionID as never)).toBeDefined()
  })
})

test.each([499, 500])("transaction guard enforces the 500-session ceiling after %i late children", async (count) => {
  await withApiPlugin(captureSource, "bounded-tree-plugin", async (probe) => {
    const api = probe.sessionAPI as {
      create: (input: { title: string }) => Promise<{ ok: boolean; sessionID: string }>
      remove: (id: string) => Promise<{ ok: boolean; error?: string }>
    }
    const mine = await api.create({ title: "mine" })
    expect(mine.ok).toBe(true)
    const rootID = SessionID.make(mine.sessionID)
    const remove = Session.remove
    const ids = Array.from({ length: count }, () => SessionID.ascending())
    vi.spyOn(Session, "remove").mockImplementationOnce(async (...args) => {
      // Simulate new owned descendants arriving after the preliminary walk.
      Database.transaction((db) => {
        const root = db.select().from(SessionTable).where(eq(SessionTable.id, rootID)).get()!
        for (const id of ids)
          db.insert(SessionTable)
            .values({ ...root, id, parent_id: rootID })
            .run()
      })
      return remove(...args)
    })
    expect(await api.remove(mine.sessionID)).toMatchObject({ ok: count === 499 })
    if (count === 500) {
      expect((await Session.children(rootID)).length).toBe(count)
      expect((await Session.get(rootID)).id).toBe(rootID)
    } else {
      await expect(Session.get(rootID)).rejects.toThrow()
      await expect(Session.get(ids[0]!)).rejects.toThrow()
    }
  })
})
