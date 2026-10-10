import { expect, test, vi } from "vitest"
import {
  promptMentionsWebTarget,
  webMcpChromeNotice,
  webMcpHintDue,
  WEBMCP_HINT_LIMIT,
} from "../../../src/cli/tui/component/webmcp-enable-model"
import { toggleWebMcpBridges } from "../../../src/cli/tui/component/webmcp-toggle"

test("only missing and outdated Chrome produce a notice", () => {
  expect(webMcpChromeNotice(undefined)).toBeUndefined()
  expect(webMcpChromeNotice({ state: "ready", major: 150, executable: "/c" })).toBeUndefined()
  expect(webMcpChromeNotice({ state: "unreadable", executable: "/c", reason: "x" })).toBeUndefined()
  expect(webMcpChromeNotice({ state: "missing", minimum: 150 })).toEqual({
    key: "ui.webMcpChromeMissing",
    params: { min: "150" },
  })
  expect(webMcpChromeNotice({ state: "outdated", major: 140, minimum: 150 })).toEqual({
    key: "ui.webMcpChromeOutdated",
    params: { major: "140", min: "150" },
  })
})

test("prompts naming a URL or local server mention a web target", () => {
  for (const text of [
    "open https://example.com/login and check it",
    "why does localhost:3000 show a blank page",
    "curl http://127.0.0.1:8080/health fails",
    "see docs.example.dev/guide for the flow",
  ]) {
    expect(promptMentionsWebTarget(text), text).toBe(true)
  }
  for (const text of ["refactor the parser", "fix src/server.ts line 4", "/model", "!ls localhost", ""]) {
    expect(promptMentionsWebTarget(text), text).toBe(false)
  }
})

test("the hint is limited per run and across restarts and needs an off bridge", () => {
  const base = {
    text: "open http://localhost:3000",
    configured: true,
    connected: false,
    shownThisRun: false,
    shownBefore: 0,
  }
  expect(webMcpHintDue(base)).toBe(true)
  expect(webMcpHintDue({ ...base, configured: false })).toBe(false)
  expect(webMcpHintDue({ ...base, connected: true })).toBe(false)
  expect(webMcpHintDue({ ...base, shownThisRun: true })).toBe(false)
  expect(webMcpHintDue({ ...base, shownBefore: WEBMCP_HINT_LIMIT })).toBe(false)
  expect(webMcpHintDue({ ...base, shownBefore: "garbage" })).toBe(true)
  expect(webMcpHintDue({ ...base, text: "no page here" })).toBe(false)
})

function deps(over: Partial<Parameters<typeof toggleWebMcpBridges>[0]> = {}) {
  const toggle = vi.fn(async () => undefined)
  const warn = vi.fn()
  const chrome = vi.fn(async () => undefined as never)
  return {
    toggle,
    warn,
    chrome,
    input: {
      model: { servers: ["a", "b"], connected: [] as string[], attentions: [] as { name: string }[] },
      statusOf: () => "disabled",
      toggle,
      chrome,
      warn,
      ...over,
    } as Parameters<typeof toggleWebMcpBridges>[0],
  }
}

test("connecting probes Chrome once, warns, and still connects every unlocked bridge", async () => {
  const d = deps({
    statusOf: (name) => (name === "b" ? "blocked" : "disabled"),
    chrome: vi.fn(async () => ({ state: "missing", minimum: 150 }) as never),
  })
  await toggleWebMcpBridges(d.input)
  expect(d.warn).toHaveBeenCalledWith({ key: "ui.webMcpChromeMissing", params: { min: "150" } })
  expect(d.toggle.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["a"])
})

test("a failing probe never blocks the connect", async () => {
  const d = deps({ chrome: vi.fn(async () => Promise.reject(new Error("boom"))) })
  await toggleWebMcpBridges(d.input)
  expect(d.warn).not.toHaveBeenCalled()
  expect(d.toggle).toHaveBeenCalledTimes(2)
})

test("a connected bridge disconnects and retries attention without probing", async () => {
  const d = deps({ model: { servers: ["a", "b"], connected: ["a"], attentions: [{ name: "b" }] } })
  await toggleWebMcpBridges(d.input)
  expect(d.chrome).not.toHaveBeenCalled()
  expect(d.toggle.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["a", "b"])
})

test("a fully blocked set does nothing", async () => {
  const d = deps({ statusOf: () => "blocked" })
  await toggleWebMcpBridges(d.input)
  expect(d.chrome).not.toHaveBeenCalled()
  expect(d.toggle).not.toHaveBeenCalled()
})
