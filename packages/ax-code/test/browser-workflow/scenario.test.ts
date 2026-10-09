import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { BrowserScenario } from "../../src/browser-workflow/scenario"
import { BrowserRunner } from "../../src/browser-workflow/runner"
import { BrowserWorkflowStore } from "../../src/browser-workflow/store"
import { exportPlaywright, registrationTemplate } from "../../src/browser-workflow/export"
import { linkSources } from "../../src/browser-workflow/diagnostics"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { ImplementArena } from "../../src/mode/implement-arena"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { SessionID } from "../../src/session/schema"

const identity = { revision: "a".repeat(40), tree: "b".repeat(64) }
const manifest = () =>
  BrowserScenario.Manifest.parse({
    version: 1,
    name: "Search",
    server: "node server.mjs {port}",
    steps: [
      { action: "fill", locator: { role: "textbox", name: "Search" }, value: "AX" },
      { action: "assert", assertion: { locator: { role: "status", name: "Found AX" }, property: "count", equals: 1 } },
    ],
  })
const result = (structuredContent: unknown) => ({ content: [], structuredContent })
function fakePort(
  options: {
    broken?: boolean
    ambiguous?: boolean
    deny?: boolean
    cleanup?: boolean
    mutated?: boolean
    missingDiagnostics?: boolean
  } = {},
) {
  const calls: string[] = []
  let opened = false
  let isolatedContext: string | undefined
  let identities = 0
  return {
    calls,
    start: async () => "http://127.0.0.1:9123",
    stop: async () => {
      calls.push("stop")
      if (options.cleanup) throw new Error("cleanup failure")
    },
    identity: async () => ({ ...identity, tree: options.mutated && identities++ > 0 ? "c".repeat(64) : identity.tree }),
    call: async (name: string, args?: Record<string, unknown>) => {
      calls.push(name)
      if (options.deny && name === "fill") throw new Error("permission denied")
      if (options.missingDiagnostics && name === "list_console_messages") throw new Error("read denied")
      if (name === "new_page") {
        opened = true
        isolatedContext = WebMcpProfile.workflowContextArguments(
          WebMcpProfile.Configuration.parse({ allowedOrigins: [] }),
          args ?? {},
        ).isolatedContext
      }
      if (name === "close_page") opened = false
      if (name === "list_pages")
        return result({ pages: opened ? [{ id: 1, url: "http://127.0.0.1:9123/", isolatedContext }] : [] })
      if (name === "take_snapshot")
        return result({
          snapshot: {
            id: "0",
            role: "RootWebArea",
            name: "Fixture",
            children: [
              { id: "1", role: "textbox", name: "Search", value: "AX" },
              ...(options.ambiguous ? [{ id: "2", role: "textbox", name: "Search" }] : []),
              { id: "3", role: "status", name: options.broken ? "Wrong result" : "Found AX" },
            ],
          },
        })
      return { content: [{ type: "text", text: "ok" }] }
    },
  }
}

describe("frozen browser scenarios", () => {
  test("canonical freeze is immutable and rejects unbounded/credential/unsupported scenarios", () => {
    const input = manifest()
    const frozen = BrowserScenario.freeze(input, identity)
    input.name = "changed"
    expect(frozen.manifest.name).toBe("Search")
    expect(BrowserScenario.freeze(manifest(), identity).hash).toBe(frozen.hash)
    expect(BrowserScenario.freeze({ ...manifest(), name: "changed" }, identity).hash).not.toBe(frozen.hash)
    expect(() =>
      BrowserScenario.Manifest.parse({ ...manifest(), steps: [{ action: "evaluate", script: "alert(1)" }] }),
    ).toThrow()
    expect(() =>
      BrowserScenario.Manifest.parse({
        ...manifest(),
        steps: [{ action: "fill", locator: { role: "textbox", name: "Password" }, value: "test" }],
      }),
    ).toThrow()
    expect(() => BrowserScenario.Manifest.parse({ ...manifest(), path: "//external.test" })).toThrow()
    expect(() =>
      BrowserScenario.Manifest.parse({ ...manifest(), steps: Array(33).fill(manifest().steps[1]) }),
    ).toThrow()
  })
  test("runtime distinguishes failed assertions, unknown calls and real passes", async () => {
    const frozen = BrowserScenario.freeze(manifest(), identity)
    for (const [options, status] of [
      [{}, "pass"],
      [{ broken: true }, "fail"],
      [{ ambiguous: true }, "unknown"],
      [{ deny: true }, "unknown"],
      [{ cleanup: true }, "unknown"],
      [{ mutated: true }, "unknown"],
      [{ missingDiagnostics: true }, "unknown"],
    ] as const) {
      const port = fakePort(options)
      const receipt = await BrowserRunner.run(frozen, port, new AbortController().signal)
      expect(receipt.status, JSON.stringify(options)).toBe(status)
      expect(port.calls).toContain("stop")
      expect(port.calls).toContain("close_page")
      if ("ambiguous" in options) expect(port.calls).not.toContain("fill")
    }
  })
  test("bounded async assertions poll reads without replaying actions and retain final evidence", async () => {
    const input = manifest()
    const assertion = input.steps[1]!
    if (assertion.action !== "assert") throw new Error("Assertion fixture required")
    assertion.timeoutMs = 1000
    const frozen = BrowserScenario.freeze(input, identity)
    const port = fakePort()
    const base = port.call
    let snapshots = 0
    port.call = async (name, args) => {
      const value = await base(name, args)
      if (name === "take_snapshot" && ++snapshots <= 4)
        return result({
          snapshot: {
            id: "0",
            role: "RootWebArea",
            name: "Fixture",
            children: [
              { id: "1", role: "textbox", name: "Search", value: "AX" },
              { id: "3", role: "status", name: "Loading" },
            ],
          },
        })
      return value
    }
    const receipt = await BrowserRunner.run(frozen, port, new AbortController().signal)
    expect(receipt.status).toBe("pass")
    expect(snapshots).toBe(5)
    expect(port.calls.filter((name) => name === "fill")).toHaveLength(1)
    expect(receipt.steps[1]!.snapshotHash).toBeDefined()
    assertion.timeoutMs = 1
    expect(
      (
        await BrowserRunner.run(
          BrowserScenario.freeze(input, identity),
          fakePort({ broken: true }),
          new AbortController().signal,
        )
      ).status,
    ).toBe("fail")
    expect(() => BrowserScenario.Manifest.parse({ ...input, steps: [{ ...assertion, timeoutMs: 10001 }] })).toThrow()
    expect(exportPlaywright(frozen)).toContain("}, 1000);")
  })
  test("canceling an assertion poll cannot produce a passing receipt", async () => {
    const input = manifest()
    const assertion = input.steps[1]!
    if (assertion.action !== "assert") throw new Error("Assertion fixture required")
    assertion.timeoutMs = 1000
    const controller = new AbortController()
    const port = fakePort({ broken: true })
    const base = port.call
    let snapshots = 0
    port.call = async (name, args) => {
      const value = await base(name, args)
      if (name === "take_snapshot" && ++snapshots === 4) controller.abort()
      return value
    }
    expect((await BrowserRunner.run(BrowserScenario.freeze(input, identity), port, controller.signal)).status).toBe(
      "unknown",
    )
    expect(port.calls.filter((name) => name === "fill")).toHaveLength(1)
    expect(port.calls).toContain("close_page")
  })
  test("abort cleans up and never passes", async () => {
    const controller = new AbortController()
    controller.abort()
    const port = fakePort()
    expect(
      (await BrowserRunner.run(BrowserScenario.freeze(manifest(), identity), port, controller.signal)).status,
    ).toBe("unknown")
    expect(port.calls).toEqual(["stop"])
  })
  test("runtime store rejects edited artifacts, scopes sessions and requires a failing control plus two fresh passes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "ses_browser_test" as SessionID
        const frozen = BrowserScenario.freeze(manifest(), identity)
        BrowserWorkflowStore.put(id, frozen)
        const copy = BrowserWorkflowStore.get(id, frozen.hash)
        copy.manifest.name = "forged"
        expect(() => BrowserWorkflowStore.put(id, copy)).toThrow("hash mismatch")
        expect(() => BrowserWorkflowStore.get("ses_other" as SessionID, frozen.hash)).toThrow()
        expect(() => BrowserWorkflowStore.control(id, frozen.hash, identity)).toThrow("failing assertion")
        const failure = await BrowserRunner.run(frozen, fakePort({ broken: true }), new AbortController().signal)
        BrowserWorkflowStore.record(id, failure)
        expect(BrowserWorkflowStore.control(id, frozen.hash, identity).hash).toBe(frozen.hash)
        const one = await BrowserRunner.run(frozen, fakePort(), new AbortController().signal)
        const two = await BrowserRunner.run(frozen, fakePort(), new AbortController().signal)
        expect(BrowserWorkflowStore.qualifies([one], frozen, identity)).toBe(false)
        expect(BrowserWorkflowStore.qualifies([one, one], frozen, identity)).toBe(false)
        expect(BrowserWorkflowStore.qualifies([one, two], frozen, identity)).toBe(true)
        expect(BrowserWorkflowStore.qualifies([one, two], frozen, { ...identity, tree: "changed" })).toBe(false)
        const candidate = {
          id: "candidate",
          providerID: "test",
          modelID: "test",
          completed: true,
          verification: "pass" as const,
          changedFiles: 1,
          browserScenarioHash: frozen.hash,
        }
        expect(ImplementArena.toArenaCandidate(candidate).verification).toBe("fail")
        expect(ImplementArena.toArenaCandidate({ ...candidate, browserQualified: true }).verification).toBe("pass")
      },
    })
  })
  test("export preserves assertions and pins native page-tool contracts", () => {
    const frozen = BrowserScenario.freeze(manifest(), identity)
    const output = exportPlaywright(frozen)
    expect(output).toContain(frozen.hash)
    expect(output).toContain('page.getByRole("textbox", { name: "Search", exact: true })')
    expect(output).toContain(
      'assert.equal(await page.getByRole("status", { name: "Found AX", exact: true }).count(), 1',
    )
    expect(output).not.toContain("evaluate(")
    expect(
      exportPlaywright(
        BrowserScenario.freeze(
          {
            ...manifest(),
            steps: [{ action: "contract", name: "test", descriptorHash: "a".repeat(64), input: {}, equals: true }],
          },
          identity,
        ),
      ),
    ).toContain("WebMCP.invokeTool")
    expect(
      registrationTemplate({ name: "search", module: "./search.js", exportName: "search", schema: { type: "object" } }),
    ).toContain("execute: (input) => search(input)")
  })
  test("source diagnostics are local, bounded and advisory", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "app.js"), "export const search = () => 1\n")
    await fs.symlink("/etc/hosts", path.join(tmp.path, "outside"))
    const allowed: string[] = []
    const links = await linkSources(
      tmp.path,
      [
        { file: "app.js", line: 1, column: 0 },
        { file: "outside", line: 1, column: 0 },
        { file: "app.js", line: 9999, column: 0 },
      ],
      async (file) => {
        allowed.push(file)
      },
    )
    expect(links.map((link) => link.confidence)).toEqual(["explicit", "unresolved", "unresolved"])
    expect(allowed).not.toContain("outside")
    expect(links[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })
  test("contract checks reject descriptor drift, distinguish page rejection from permission refusal, and compare structured output", async () => {
    const descriptor = {
      name: "search",
      description: "Search fixture",
      inputSchema: { type: "object" },
      annotations: undefined,
    }
    const run = async (
      kind: "success" | "drift" | "page_error" | "permission" | "unavailable",
      expectError = false,
    ) => {
      const frozen = BrowserScenario.freeze(
        {
          ...manifest(),
          steps: [
            {
              action: "contract",
              name: "search",
              descriptorHash: WebMcpProfile.descriptorHash(descriptor),
              input: {},
              expectError,
              resultPath: ["found"],
              equals: true,
            },
          ],
        },
        identity,
      )
      const port = fakePort()
      const original = port.call
      port.call = async (name, args) => {
        if (name === "list_webmcp_tools" && kind === "unavailable") return result({})
        if (name === "list_webmcp_tools")
          return result({
            webmcpTools: [{ ...descriptor, description: kind === "drift" ? "Changed" : descriptor.description }],
          })
        if (name === "execute_webmcp_tool") {
          if (kind === "page_error") throw new WebMcpProfile.PageInvocationError("Page rejected input")
          if (kind === "permission") throw new Error("Permission refused")
          return result({ message: JSON.stringify({ status: "Completed", output: JSON.stringify({ found: true }) }) })
        }
        return original(name, args)
      }
      return (await BrowserRunner.run(frozen, port, new AbortController().signal)).status
    }
    expect(await run("success")).toBe("pass")
    expect(await run("success", true)).toBe("fail")
    expect(await run("unavailable")).toBe("unknown")
    expect(await run("drift")).toBe("fail")
    expect(await run("page_error", true)).toBe("pass")
    expect(await run("page_error")).toBe("fail")
    expect(await run("permission", true)).toBe("unknown")
  })
  test("source maps resolve local files and reject remote sources", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "app.js"), "console.log(1)\n//# sourceMappingURL=app.js.map\n")
    await fs.writeFile(path.join(tmp.path, "app.ts"), "console.log(1)\n")
    const sourceMap = (source: string) =>
      JSON.stringify({ version: 3, file: "app.js", sources: [source], names: [], mappings: "AAAA" })
    await fs.writeFile(path.join(tmp.path, "app.js.map"), sourceMap("app.ts"))
    const references = [{ file: "app.js", line: 1, column: 0, map: "app.js.map" }]
    expect((await linkSources(tmp.path, references, async () => {}))[0]).toMatchObject({
      file: "app.ts",
      line: 1,
      confidence: "local_map",
    })
    await fs.writeFile(path.join(tmp.path, "app.js.map"), sourceMap("https://external.test/private.ts"))
    expect((await linkSources(tmp.path, references, async () => {}))[0]!.confidence).toBe("unresolved")
  })
  test("forged, modified and replayed receipts are rejected", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "ses_authentic_receipt" as SessionID
        const frozen = BrowserScenario.freeze(manifest(), identity)
        BrowserWorkflowStore.put(id, frozen)
        const receipt = await BrowserRunner.run(frozen, fakePort(), new AbortController().signal)
        expect(() => BrowserWorkflowStore.record(id, structuredClone(receipt))).toThrow("not issued intact")
        BrowserWorkflowStore.record(id, receipt)
        expect(() => BrowserWorkflowStore.record(id, receipt)).toThrow("already recorded")
        receipt.origin = "https://forged.test"
        expect(() => BrowserWorkflowStore.record(id, receipt)).toThrow("not issued intact")
        expect(await BrowserWorkflowStore.qualify(id, frozen.hash)).toBe(false)
        for (let index = 0; index < 150; index++)
          expect(BrowserWorkflowStore.receipts(`ses_unknown_${index}` as SessionID, frozen.hash)).toEqual([])
        expect(BrowserWorkflowStore.get(id, frozen.hash).hash).toBe(frozen.hash)
      },
    })
  })
  test("truncated and empty snapshot data cannot satisfy assertions", async () => {
    for (const tree of [{}, { id: "0", role: "status", name: "a".repeat(513) }]) {
      const port = fakePort()
      const original = port.call
      port.call = async (name, args) => (name === "take_snapshot" ? result({ snapshot: tree }) : original(name, args))
      expect(
        (await BrowserRunner.run(BrowserScenario.freeze(manifest(), identity), port, new AbortController().signal))
          .status,
      ).toBe("unknown")
    }
  })
  test("runtime-only isolated contexts are not accepted from model JSON and are bounded per connection", () => {
    const profile = WebMcpProfile.Configuration.parse({ allowedOrigins: [] })
    expect(() =>
      WebMcpProfile.validateCall(profile, "new_page", { url: "http://127.0.0.1:1", isolatedContext: "forged" }),
    ).toThrow()
    const call = { url: "http://127.0.0.1:1" }
    WebMcpProfile.bindWorkflowContext(call, "01234567-89ab-cdef-0123-456789abcdef")
    const parsed = WebMcpProfile.validateCall(profile, "new_page", call)
    for (let index = 0; index < 32; index++)
      expect(WebMcpProfile.workflowContextArguments(profile, parsed).isolatedContext).toBe(
        "ax-workflow-01234567-89ab-cdef-0123-456789abcdef",
      )
    expect(() => WebMcpProfile.workflowContextArguments(profile, parsed)).toThrow("context limit")
    expect(WebMcpProfile.workflowContextArguments(profile, { ...call })).toEqual({})
  })
  test("cleanup never closes a concurrently opened page outside the workflow context", async () => {
    const port = fakePort()
    const original = port.call
    let attempted = false
    port.call = async (name, args) => {
      if (name === "new_page") {
        attempted = true
        throw new Error("Navigation outcome unknown")
      }
      if (name === "list_pages" && attempted)
        return result({ pages: [{ id: 99, url: "http://127.0.0.1:9123/", isolatedContext: "someone-else" }] })
      return original(name, args)
    }
    expect(
      (await BrowserRunner.run(BrowserScenario.freeze(manifest(), identity), port, new AbortController().signal))
        .status,
    ).toBe("unknown")
    expect(port.calls).not.toContain("close_page")
    expect(port.calls).toContain("stop")
  })
})
