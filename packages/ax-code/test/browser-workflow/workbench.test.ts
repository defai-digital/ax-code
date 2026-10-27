import { describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { BrowserWorkbench } from "../../src/browser-workflow/workbench"
import { BrowserWorkflow } from "../../src/browser-workflow/service"
import { BrowserWorkflowStore } from "../../src/browser-workflow/store"
import { BrowserInventory } from "../../src/browser-workflow/inventory"
import { BrowserAuthoring } from "../../src/browser-workflow/authoring"
import { BrowserSelection } from "../../src/browser-workflow/selection"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import type { SessionID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"
import { parseJsonStrict } from "../../src/util/json-value"
import { tmpdir } from "../fixture/fixture"

const descriptor = {
  name: "lookup",
  description: "Look up an item",
  inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
}
const assertion = { locator: { role: "status" as const, name: "Ready" }, property: "count" as const, equals: 1 }
const target = { server: "fixture", pageId: 1, origin: "http://localhost:3000" }
const structured = (structuredContent: unknown) => ({ content: [], structuredContent })
function fixture() {
  const state = {
    url: `${target.origin}/`,
    identity: {},
    ready: true,
    console: "baseline",
    deny: "",
    descriptors: [structuredClone(descriptor)],
    snapshotMissing: false,
    pageMissing: false,
  }
  const ask = vi.fn(async () => {})
  const browser = vi.fn(async (_server: string, name: string) => {
    if (state.deny === name) throw new Error("Permission denied")
    if (name === "list_pages") return structured({ pages: state.pageMissing ? [] : [{ id: 1, url: state.url }] })
    if (name === "list_webmcp_tools") return structured({ webmcpTools: state.descriptors })
    if (name === "take_snapshot")
      return structured(
        state.snapshotMissing
          ? {}
          : {
              snapshot: {
                id: "0",
                role: "RootWebArea",
                name: "Fixture",
                children: [{ id: "1", role: "status", name: state.ready ? "Ready" : "Broken" }],
              },
            },
      )
    if (name === "execute_webmcp_tool")
      return structured({ message: JSON.stringify({ status: "Completed", output: JSON.stringify({ count: 2 }) }) })
    return {
      content: [{ type: "text", text: name === "list_console_messages" ? state.console : "GET /data 200 fetch" }],
    }
  })
  const host: BrowserWorkbench.Host = {
    context: {
      sessionID: "ses_workbench" as SessionID,
      abort: new AbortController().signal,
      ask,
    } as unknown as Tool.Context,
    browser,
    connection: async () => ({
      identity: state.identity,
      profile: { allowedOrigins: [], read: true },
      tools: [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_SCOPE_TOOLS],
    }),
    selectionModel: "fixture/model",
    select: vi.fn(async () => JSON.stringify({ name: "lookup", arguments: { q: "AX" } })),
  }
  const call = async (args: unknown): Promise<Record<string, any>> => {
    const result = await BrowserWorkbench.execute(BrowserWorkbench.Parameters.parse(args), host)
    if ("manifest" in result) return result
    return parseJsonStrict(result.output) as Record<string, any>
  }
  return { state, host, call, browser, ask }
}

describe("browser workbench", () => {
  test("expired baselines release session capacity and cannot be reused", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { call, host } = fixture()
        const started = Date.now()
        const clock = vi.spyOn(Date, "now").mockReturnValue(started)
        try {
          let first = ""
          for (let index = 0; index < 128; index++) {
            host.context.sessionID = `ses_capacity_${index}` as SessionID
            const captured = await call({ action: "inventory", ...target })
            if (!index) first = captured.inventoryId
          }
          host.context.sessionID = "ses_capacity_128" as SessionID
          await expect(call({ action: "inventory", ...target })).rejects.toThrow("session limit")
          clock.mockReturnValue(started + 31 * 60000)
          expect((await call({ action: "inventory", ...target })).inventoryId).toBeDefined()
          host.context.sessionID = "ses_capacity_0" as SessionID
          await expect(call({ action: "inventory", ...target, baselineId: first })).rejects.toThrow("expired")
        } finally {
          clock.mockRestore()
        }
      },
    })
  })
  test("selection refuses stale catalogs and CLI evaluators before a model call", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { call, state, host } = fixture()
        const inventory = await call({ action: "inventory", ...target })
        const args = {
          action: "selection_eval",
          inventoryId: inventory.inventoryId,
          cases: [{ task: "Find AX", expected: { name: "lookup", arguments: { q: "AX" } } }],
        }
        state.descriptors = []
        await expect(call(args)).rejects.toThrow("inventory changed")
        expect(host.select).not.toHaveBeenCalled()
        host.selectionUnavailable = "CLI evaluator unavailable"
        await expect(call(args)).rejects.toThrow("CLI evaluator unavailable")
        expect(host.select).not.toHaveBeenCalled()
      },
    })
  })
  test("promotion cannot silently target another route", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { call } = fixture()
        const observation = await call({ action: "observe", ...target, assertions: [assertion] })
        await expect(
          call({
            action: "promote",
            observationId: observation.observationId,
            manifest: {
              version: 1,
              name: "Wrong route",
              path: "/unrelated",
              server: "node app.mjs {port}",
              steps: [{ action: "assert", assertion }],
            },
          }),
        ).rejects.toThrow("observed page path")
      },
    })
  })
  test("captures native inventory, reports exact schema drift and labels source mapping candidates", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "app.ts"),
      `document.modelContext.registerTool({name:'lookup', inputSchema:${JSON.stringify(descriptor.inputSchema)}, execute: () => null})`,
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { state, call, ask } = fixture()
        const first = await call({ action: "inventory", ...target, sourceFiles: ["app.ts"] })
        expect(first.sources.mappings[0].confidence).toBe("name_and_schema_candidate")
        expect(ask).toHaveBeenCalledWith(expect.objectContaining({ permission: "read", patterns: ["app.ts"] }))
        state.descriptors[0]!.inputSchema.properties.q.type = "number"
        const next = await call({ action: "inventory", ...target, baselineId: first.inventoryId })
        expect(next.changes).toEqual([{ name: "lookup", kind: "changed", fields: ["/inputSchema/properties/q/type"] }])
      },
    })
  })
  test.each(["reconnect", "location", "page", "session"])("rejects %s baseline reuse", async (change) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { state, call, host } = fixture()
        const before = await call({ action: "observe", ...target, assertions: [assertion] })
        if (change === "reconnect") state.identity = {}
        if (change === "location") state.url += "changed"
        if (change === "page") state.pageMissing = true
        if (change === "session") host.context.sessionID = "ses_other" as SessionID
        await expect(call({ action: "diagnose", observationId: before.observationId })).rejects.toThrow()
      },
    })
  })
  test("diagnosis compares immutable assertions and bounded deltas without claiming a root cause", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "app.ts"), "export const lookup = () => 1\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { state, call } = fixture()
        const before = await call({ action: "observe", ...target, assertions: [assertion], sourceFiles: ["app.ts"] })
        expect(before.status).toBe("pass")
        state.ready = false
        state.console += "\nTypeError at app.ts:1"
        const after = await call({ action: "diagnose", observationId: before.observationId })
        expect(after.status).toBe("fail")
        expect(after.before.assertions[0].status).toBe("pass")
        expect(after.consoleDelta).toEqual(["TypeError at app.ts:1"])
        expect(after.sourceCandidates).toEqual([{ file: "app.ts", confidence: "error_text_candidate" }])
        expect(after.continuity).toContain("same-URL reload")
      },
    })
  })
  test.each(["take_snapshot", "list_console_messages", "list_network_requests", "list_webmcp_tools"])(
    "a denied %s cannot yield success",
    async (name) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { state, call, browser } = fixture()
          state.deny = name
          await expect(call({ action: "observe", ...target, assertions: [assertion] })).rejects.toThrow(
            "Permission denied",
          )
          expect(browser.mock.calls.filter(([, tool]) => tool === name)).toHaveLength(1)
        },
      })
    },
  )
  test("missing snapshot is unavailable, never a passing zero-count assertion", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { state, call } = fixture()
        state.snapshotMissing = true
        await expect(call({ action: "observe", ...target, assertions: [{ ...assertion, equals: 0 }] })).rejects.toThrow(
          "snapshot unavailable",
        )
      },
    })
  })
  test("snapshot recipes do not execute page tools, navigate or persist captured data in definitions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { state, call, browser } = fixture()
        const args = {
          action: "recipe",
          server: target.server,
          pageId: 1,
          definition: { version: 1, name: "Preview check", origin: target.origin, assertions: [assertion] },
        }
        expect((await call(args)).status).toBe("pass")
        state.ready = false
        const result = await call(args)
        expect(result.status).toBe("fail")
        expect(result.route).toBe("snapshot-only")
        expect(JSON.stringify(result.definition)).not.toContain("snapshotHash")
        expect(browser.mock.calls.map(([, name]) => name)).not.toContain("execute_webmcp_tool")
        expect(browser.mock.calls.map(([, name]) => name)).not.toContain("new_page")
      },
    })
  })
  test("native recipe pins the actual descriptor, keeps dispatch approval and labels application effects", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { state, call, browser } = fixture()
        const args = {
          action: "recipe",
          server: target.server,
          pageId: 1,
          definition: {
            version: 1,
            name: "Lookup",
            origin: target.origin,
            queries: [
              {
                name: "lookup",
                descriptorHash: WebMcpProfile.descriptorHash(descriptor),
                input: { q: "AX" },
                resultPath: ["count"],
                equals: 2,
              },
            ],
          },
        }
        const result = await call(args)
        expect(result.status).toBe("pass")
        expect(result.effects).toContain("effects unverified")
        state.deny = "execute_webmcp_tool"
        await expect(call(args)).rejects.toThrow("Permission denied")
        state.deny = ""
        state.descriptors[0]!.description = "Changed operation"
        browser.mockClear()
        await expect(call(args)).rejects.toThrow("contract changed")
        expect(browser.mock.calls.map(([, name]) => name)).not.toContain("execute_webmcp_tool")
      },
    })
  })
  test("promotion freezes a real localhost manifest without admitting observation receipts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { host, call } = fixture()
        const observed = await call({ action: "observe", ...target, assertions: [assertion] })
        const manifest = {
          version: 1,
          name: "Local regression",
          server: "node app.mjs {port}",
          steps: [{ action: "assert", assertion }],
        }
        const fullHost = { ...host, registry: {} as Tool.Dispatcher, requireBridge: () => {} }
        const result = await BrowserWorkflow.execute(
          BrowserWorkflow.Parameters.parse({ action: "promote", observationId: observed.observationId, manifest }),
          fullHost,
        )
        const frozen = parseJsonStrict(result.output) as { hash: string }
        expect(BrowserWorkflowStore.receipts(host.context.sessionID, frozen.hash)).toEqual([])
        expect(await BrowserWorkflowStore.qualify(host.context.sessionID, frozen.hash)).toBe(false)
      },
    })
  })
  test("capability status explains fallback and does not invent frame coverage", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { state, call } = fixture()
        state.descriptors = []
        const result = await call({ action: "status", ...target })
        expect(result.route).toBe("snapshot-fallback-available")
        expect(result.unavailable).toContain("frame attribution")
      },
    })
  })
})

describe("source mapping and authoring", () => {
  test("ambiguous and dynamic registrations remain unresolved candidates", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(
      path.join(tmp.path, "app.ts"),
      "context.registerTool({name:'lookup'}); context.registerTool({name:'lookup'}); context.registerTool({name:computed})",
    )
    const result = await BrowserInventory.sources(tmp.path, ["app.ts"], [descriptor], async () => {})
    expect(result.mappings[0]!.confidence).toBe("ambiguous")
    expect(result.dynamic).toHaveLength(1)
  })
  test("malformed source is reported and HTML comments do not become registrations", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "bad.ts"), "context.registerTool({name:'lookup', !!!})")
    await fs.writeFile(
      path.join(tmp.path, "page.html"),
      '<!-- <form toolname="lookup"> --><form toolname="search"></form>',
    )
    const result = await BrowserInventory.sources(tmp.path, ["bad.ts", "page.html"], [descriptor], async () => {})
    expect(result.mappings[0]!.confidence).toBe("unresolved")
    expect(result.unresolved).toHaveLength(2)
  })
  test("signed numeric schema literals and upper-case extensions still map", async () => {
    await using tmp = await tmpdir()
    const signed = {
      ...descriptor,
      inputSchema: { type: "object", properties: { lat: { type: "number", minimum: -90, maximum: +90 } } },
    }
    await fs.writeFile(
      path.join(tmp.path, "geo.ts"),
      "context.registerTool({name:'lookup', inputSchema:{type:'object', properties:{lat:{type:'number', minimum:-90, maximum:+90}}}})",
    )
    await fs.writeFile(path.join(tmp.path, "Page.HTML"), '<form toolname="search"></form>')
    const result = await BrowserInventory.sources(
      tmp.path,
      ["geo.ts", "Page.HTML"],
      [signed, { ...descriptor, name: "search" }],
      async () => {},
    )
    expect(result.mappings[0]!.confidence).toBe("name_and_schema_candidate")
    expect(result.mappings[1]!.confidence).toBe("name_only_candidate")
    expect(result.mappings[1]!.candidates[0]!.kind).toBe("declarative")
  })
  test.each([
    "../secret.ts",
    "/tmp/private.ts",
    "node_modules/pkg/index.ts",
    "https://example.test/a.ts",
    "a/../../b.ts",
  ])("rejects unsafe source %s", (file) => {
    expect(() => BrowserInventory.SourceFiles.parse([file])).toThrow()
  })
  test("refuses external symlinks and oversized sources", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    await fs.writeFile(path.join(other.path, "secret.ts"), "export const secret = 1")
    await fs.symlink(path.join(other.path, "secret.ts"), path.join(tmp.path, "link.ts"))
    await expect(BrowserInventory.sources(tmp.path, ["link.ts"], [], async () => {})).rejects.toThrow(
      "leaves the repository",
    )
    await fs.writeFile(path.join(tmp.path, "big.ts"), "x".repeat(1024 * 1024 + 1))
    await expect(BrowserInventory.sources(tmp.path, ["big.ts"], [], async () => {})).rejects.toThrow("too large")
  })
  test("template export check accepts names ending in $", () => {
    expect(BrowserWorkflow.declaresNamedExport("export function jq$(x) {}", "jq$")).toBe(true)
    expect(BrowserWorkflow.declaresNamedExport("export const a$b = 1", "a$b")).toBe(true)
    expect(BrowserWorkflow.declaresNamedExport("export function jq$x() {}", "jq$")).toBe(false)
    expect(BrowserWorkflow.declaresNamedExport("export function lookupAll() {}", "lookup")).toBe(false)
  })
  test("declarative authoring escapes attributes and keeps explicit human submission", () => {
    const input = BrowserAuthoring.Parameters.parse({
      action: "author",
      name: "lookup",
      description: 'Search "items" <safely>',
      module: "./app.js",
      exportName: "lookup",
      schema: descriptor.inputSchema,
      format: "declarative",
    })
    const output = BrowserAuthoring.generate(input)
    expect(output.html).toContain("&quot;items&quot; &lt;safely&gt;")
    expect(output.html).not.toContain("toolautosubmit")
    expect(output.javascript).toContain("event.respondWith(task)")
    expect(output.javascript).toContain("lookup(input)")
    expect(output.javascript).not.toContain("eval(")
  })
  test("imperative authoring supports explicit lifecycle and execution cancellation", () => {
    const output = BrowserAuthoring.generate(
      BrowserAuthoring.Parameters.parse({
        action: "author",
        name: "lookup",
        description: "Look up application records",
        module: "./app.js",
        exportName: "lookup",
        schema: descriptor.inputSchema,
        format: "imperative",
        effect: "read",
        acceptsSignal: true,
      }),
    )
    expect(output.javascript).toContain("{ signal: lifecycleSignal }")
    expect(output.javascript).toContain("lookup(input, { signal: executionSignal })")
    expect(output.javascript).toContain("readOnlyHint: true")
    expect(BrowserAuthoring.hasExport("// export function lookup() {}", "lookup")).toBe(false)
    expect(BrowserAuthoring.hasExport("export const lookup = () => 1", "lookup")).toBe(true)
    expect(BrowserAuthoring.hasExport("export function lookup() { !!!", "lookup")).toBe(false)
  })
  test.each([
    { type: "string", minimum: 2 },
    { type: "integer", maxLength: 3 },
    { type: "string", maxLength: -1 },
    { type: "string", maxLength: 1.5 },
    { type: "number", minimum: 3, maximum: 2 },
    { type: "string", enum: ["long"], maxLength: 2 },
  ])("rejects constraints a generated form cannot preserve: %j", (field) => {
    expect(() =>
      BrowserAuthoring.generate(
        BrowserAuthoring.Parameters.parse({
          action: "author",
          name: "lookup",
          description: "Look up application records",
          module: "./app.js",
          exportName: "lookup",
          format: "declarative",
          schema: { type: "object", properties: { q: field } },
        }),
      ),
    ).toThrow("cannot be represented faithfully")
  })
  test("complex declarative schemas cannot silently lose validation", () => {
    expect(() =>
      BrowserAuthoring.generate(
        BrowserAuthoring.Parameters.parse({
          action: "author",
          name: "lookup",
          description: "Look up application records",
          module: "./app.js",
          exportName: "lookup",
          format: "declarative",
          schema: { type: "object", properties: { q: { type: "string", pattern: "^A" } } },
        }),
      ),
    ).toThrow("primitive fields")
  })
})

describe("model tool selection evaluation", () => {
  test("gold is hidden, choice and arguments are separate, failures stay in the denominator", async () => {
    const input = BrowserSelection.Parameters.parse({
      action: "selection_eval",
      inventoryId: "00000000-0000-4000-8000-000000000000",
      cases: [
        { task: "Find AX", expected: { name: "lookup", arguments: { q: "AX" } } },
        { task: "Delete everything", expected: { name: null, arguments: {} } },
        { task: "Find another item", expected: { name: "lookup", arguments: { q: "gold-only-secret-marker" } } },
      ],
    })
    const select = vi
      .fn()
      .mockResolvedValueOnce('{"name":"lookup","arguments":{"q":"wrong"}}')
      .mockResolvedValueOnce('{"name":null,"arguments":{}}')
      .mockRejectedValueOnce(new Error("provider unavailable"))
    const report = await BrowserSelection.evaluate(
      input,
      [descriptor],
      "provider/model",
      select,
      new AbortController().signal,
    )
    expect(report).toMatchObject({
      total: 3,
      choiceCorrect: 2,
      argumentsCorrect: 1,
      jointlyCorrect: 1,
      unknown: 1,
      executesTools: false,
    })
    for (const [prompt] of select.mock.calls) {
      expect(prompt).not.toContain("expected")
      expect(prompt).not.toContain("gold-only-secret-marker")
    }
  })
  test("cancellation prevents model calls and unknown tool choices do not pass", async () => {
    const input = BrowserSelection.Parameters.parse({
      action: "selection_eval",
      inventoryId: "00000000-0000-4000-8000-000000000000",
      cases: [{ task: "Find AX", expected: { name: "lookup", arguments: { q: "AX" } } }],
    })
    const select = vi.fn(async () => '{"name":"invented","arguments":{"q":"AX"}}')
    expect(
      (await BrowserSelection.evaluate(input, [descriptor], "model", select, new AbortController().signal)).unknown,
    ).toBe(1)
    select.mockClear()
    expect((await BrowserSelection.evaluate(input, [descriptor], "model", select, AbortSignal.abort())).unknown).toBe(1)
    expect(select).not.toHaveBeenCalled()
  })
})
