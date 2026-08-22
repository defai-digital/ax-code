import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { ComputerUseError } from "../src/errors"
import type { McpCallToolResult } from "../src/mcp/stdio-client"
import { parseA11yTree } from "../src/providers/ocu-protocol"
import { FakeMcpClient, PNG_BASE64, ocu } from "./fixtures"
import { UpstreamOcuReferenceProvider } from "./helpers/upstream-ocu"

const server = fileURLToPath(new URL("./helpers/fake-mcp-server.mjs", import.meta.url))

function makeProvider(handler?: (tool: string) => McpCallToolResult) {
  const client = new FakeMcpClient((tool) =>
    handler ? handler(tool) : tool === "get_app_state" ? ocu.appState : ocu.clickOk,
  )
  return { client, provider: new UpstreamOcuReferenceProvider({ client }) }
}

// shared dialect logic, exercised through the test-only upstream reference arm
describe("OcuProtocolProvider", () => {
  test("observe({ app }) calls get_app_state and maps content blocks", async () => {
    const { client, provider } = makeProvider(() => ocu.appState)
    const observation = await provider.observe({ app: "TextEdit" })

    expect(client.lastCall()).toEqual({ tool: "get_app_state", args: { app: "TextEdit" } })
    expect(observation.provider).toBe("ocu")
    expect(observation.app).toEqual({ name: "TextEdit" })
    expect(observation.screenshot).toEqual({ data: PNG_BASE64, mimeType: "image/png", width: 1, height: 1 })
    expect(observation.a11yText).toContain("standard window Open")
    // the tree text is parsed into elements (indices valid for this snapshot)
    expect(observation.elements).toHaveLength(11)
    expect(observation.elements[0]).toMatchObject({ id: "0", role: "standard window", name: "open-panel" })
    expect(observation.raw).toBe(ocu.appState)
  })

  test("observe rejects non-app scopes", async () => {
    const { provider } = makeProvider()
    await expect(provider.observe({ desktop: true })).rejects.toMatchObject({ code: "unsupported_scope" })
    await expect(provider.observe({ windowId: "1" })).rejects.toMatchObject({ code: "unsupported_scope" })
  })

  test("act before any observe throws no_active_observation", async () => {
    const { provider } = makeProvider()
    await expect(provider.act({ type: "type", text: "hi" })).rejects.toMatchObject({ code: "no_active_observation" })
  })

  test("click maps element and point targets, count and button", async () => {
    const { client, provider } = makeProvider()
    await provider.observe({ app: "TextEdit" })

    await provider.act({ type: "click", target: { kind: "element", id: "0" } })
    expect(client.lastCall()).toEqual({ tool: "click", args: { app: "TextEdit", element_index: "0" } })

    await provider.act({ type: "click", target: { kind: "point", x: 10, y: 20 }, count: 2 })
    expect(client.lastCall()).toEqual({ tool: "click", args: { app: "TextEdit", x: 10, y: 20, click_count: 2 } })

    await provider.act({ type: "click", target: { kind: "point", x: 10, y: 20 }, button: "right" })
    expect(client.lastCall()).toEqual({ tool: "click", args: { app: "TextEdit", x: 10, y: 20, mouse_button: "right" } })
  })

  test("type and keypress map to type_text / press_key (xdotool syntax)", async () => {
    const { client, provider } = makeProvider()
    await provider.observe({ app: "TextEdit" })

    await provider.act({ type: "type", text: "hello" })
    expect(client.lastCall()).toEqual({ tool: "type_text", args: { app: "TextEdit", text: "hello" } })

    await provider.act({ type: "keypress", keys: ["ctrl", "c"] })
    expect(client.lastCall()).toEqual({ tool: "press_key", args: { app: "TextEdit", key: "ctrl+c" } })
  })

  test("keypress maps canonical key names to xdotool keysyms", async () => {
    const { client, provider } = makeProvider()
    await provider.observe({ app: "TextEdit" })

    await provider.act({ type: "keypress", keys: ["cmd", "n"] })
    expect(client.lastCall()).toEqual({ tool: "press_key", args: { app: "TextEdit", key: "super+n" } })

    await provider.act({ type: "keypress", keys: ["escape"] })
    expect(client.lastCall()).toEqual({ tool: "press_key", args: { app: "TextEdit", key: "Escape" } })

    await provider.act({ type: "keypress", keys: ["cmd", "shift", "f5"] })
    expect(client.lastCall()).toEqual({ tool: "press_key", args: { app: "TextEdit", key: "super+shift+F5" } })
  })

  test("scroll maps amount to fractional pages and falls back to the scroll area", async () => {
    const { client, provider } = makeProvider()
    await provider.observe({ app: "TextEdit" })

    // no explicit target: the tree's scroll area (index 2) is used because
    // OCU's scroll schema requires element_index
    await provider.act({ type: "scroll", direction: "down", amount: 0.5 })
    expect(client.lastCall()).toEqual({
      tool: "scroll",
      args: { app: "TextEdit", direction: "down", pages: 0.5, element_index: "2" },
    })

    await provider.act({ type: "scroll", direction: "up", target: { kind: "element", id: "1" } })
    expect(client.lastCall()).toEqual({
      tool: "scroll",
      args: { app: "TextEdit", direction: "up", pages: 1, element_index: "1" },
    })
  })

  test("scroll refuses cleanly when the last observation has no scrollable element", async () => {
    const noScroll: McpCallToolResult = {
      content: [{ type: "text", text: "App=com.example.App (pid 1)\n0 button OK" }],
    }
    const { client, provider } = makeProvider(() => noScroll)
    await provider.observe({ app: "TextEdit" })
    const callsBefore = client.calls.length

    const result = await provider.act({ type: "scroll", direction: "down" })
    expect(result).toEqual({
      ok: false,
      provider: "ocu",
      action: "scroll",
      refusal: "no scrollable element in last observation",
    })
    // the tool must not be called without the required element_index
    expect(client.calls.length).toBe(callsBefore)
  })

  test("scroll rejects point targets", async () => {
    const { provider } = makeProvider()
    await provider.observe({ app: "TextEdit" })
    await expect(
      provider.act({ type: "scroll", direction: "down", target: { kind: "point", x: 1, y: 2 } }),
    ).rejects.toMatchObject({ code: "unsupported_target" })
  })

  test("drag and set_value map to pixel / element forms", async () => {
    const { client, provider } = makeProvider()
    await provider.observe({ app: "TextEdit" })

    await provider.act({ type: "drag", from: { kind: "point", x: 1, y: 2 }, to: { kind: "point", x: 3, y: 4 } })
    expect(client.lastCall()).toEqual({
      tool: "drag",
      args: { app: "TextEdit", from_x: 1, from_y: 2, to_x: 3, to_y: 4 },
    })

    await provider.act({ type: "set_value", target: { kind: "element", id: "1" }, value: "42" })
    expect(client.lastCall()).toEqual({ tool: "set_value", args: { app: "TextEdit", element_index: "1", value: "42" } })
  })

  test("launch_app uses get_app_state; activate_window is unsupported", async () => {
    const { client, provider } = makeProvider(() => ocu.appState)
    const result = await provider.act({ type: "launch_app", app: "TextEdit" })
    expect(client.lastCall()).toEqual({ tool: "get_app_state", args: { app: "TextEdit" } })
    expect(result).toMatchObject({ ok: true, provider: "ocu", action: "launch_app" })
    // launch marks the app as current
    await provider.act({ type: "type", text: "hi" })
    expect(client.lastCall()).toEqual({ tool: "type_text", args: { app: "TextEdit", text: "hi" } })

    await expect(provider.act({ type: "activate_window", windowId: "1" })).rejects.toMatchObject({
      code: "unsupported_action",
    })
    await expect(provider.act({ type: "activate_window", windowId: "1" })).rejects.toBeInstanceOf(ComputerUseError)
  })

  test("isError results map to ok:false with the refusal text", async () => {
    const { provider } = makeProvider((tool) => (tool === "get_app_state" ? ocu.appState : ocu.clickError))
    await provider.observe({ app: "TextEdit" })
    const result = await provider.act({ type: "click", target: { kind: "element", id: "99" } })
    expect(result).toEqual({
      ok: false,
      provider: "ocu",
      action: "click",
      refusal: "element index 99 not found in the latest snapshot",
    })
  })

  test("listApps parses the rendered catalog lines", async () => {
    const { provider } = makeProvider(() => ocu.listApps)
    expect(await provider.listApps()).toEqual([
      { name: "Finder", bundleId: "com.apple.finder" },
      { name: "TextEdit", bundleId: "com.apple.TextEdit" },
      { name: "Safari", bundleId: "com.apple.Safari" },
    ])
  })

  test("capabilities reflect app-scoped OCU", () => {
    const { provider } = makeProvider()
    const caps = provider.capabilities()
    expect(caps.windowActivation).toBe(false)
    expect(caps.elementTargeting).toBe(true)
    expect(caps.actions).toContain("click")
    expect(caps.actions).not.toContain("activate_window")
  })

  test("concurrent first calls share a single spawned server process", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-computer-spawn-"))
    const countFile = path.join(dir, "spawns.txt")
    process.env.AX_FAKE_MCP_COUNT_FILE = countFile
    try {
      const provider = new UpstreamOcuReferenceProvider({ command: process.execPath, args: [server, "slow-init"] })
      await Promise.all([provider.listApps(), provider.listApps()])
      await provider.dispose()
      const spawns = fs.readFileSync(countFile, "utf8").trim().split("\n")
      expect(spawns).toHaveLength(1)
    } finally {
      delete process.env.AX_FAKE_MCP_COUNT_FILE
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("parseA11yTree", () => {
  test("parses the captured TextEdit Open-panel tree", () => {
    const elements = parseA11yTree(ocu.appStateTree)
    expect(elements).toHaveLength(11)

    // index, role words, label vs. annotation-derived name
    expect(elements[0]).toMatchObject({ id: "0", role: "standard window", name: "open-panel" })
    expect(elements[1]).toMatchObject({ id: "1", role: "split group", name: undefined })
    expect(elements[2]).toMatchObject({ id: "2", role: "scroll area", name: undefined })
    // parenthesized non-flag content is ignored; Description wins as name
    expect(elements[3]).toMatchObject({ id: "3", role: "outline", name: "sidebar" })
    // trailing free text after flags becomes the name
    expect(elements[4]).toMatchObject({ id: "4", role: "row", name: "TextEdit" })
    expect(elements[5]).toMatchObject({ id: "5", role: "cell", name: undefined })
    expect(elements[6]).toMatchObject({ id: "27", role: "scroll bar", name: "0" })
    // disabled flag -> enabled: false; Value annotation -> value
    expect(elements[7]).toMatchObject({ id: "33", role: "splitter", enabled: false, value: "197" })
    // Description beats ID; Help text containing commas is not split
    expect(elements[8]).toMatchObject({ id: "40", role: "menu button", name: "List" })
    expect(elements[9]).toMatchObject({ id: "43", role: "search text field", name: "Search" })
    expect(elements[10]).toMatchObject({ id: "45", role: "button", name: "NewDocumentButton" })
  })

  test("maps the focused flag and skips non-element lines", () => {
    const elements = parseA11yTree("App=com.example (pid 1)\n7 text field (focused) ID: Query\nnot an element line")
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({ id: "7", role: "text field", name: "Query", focused: true })
  })

  test("keeps unknown roles unsplit rather than guessing", () => {
    const elements = parseA11yTree("9 frobnicator panel (settable)")
    expect(elements[0]).toMatchObject({ id: "9", role: "frobnicator panel", name: undefined })
  })
})
