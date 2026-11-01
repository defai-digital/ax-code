import { describe, expect, test, vi } from "vitest"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { convertMcpTool } from "../../src/mcp/tool-conversion"

const ORIGIN = "https://app.test"
const PAGE = `${ORIGIN}/orders`

const readProfile = () => WebMcpProfile.config({ allowedOrigins: [], read: true }, true).webmcp
const fullProfile = () => WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp

/** Nodes parsed from the same structured shape the pinned bridge returns. */
function nodesOf(children: Record<string, unknown>[]): ReadonlyMap<string, WebMcpProfile.SnapshotNode> {
  const parsed = WebMcpProfile.parseStructuredSnapshot({
    structuredContent: {
      snapshot: { id: "1_0", role: "RootWebArea", name: "App", children },
    },
  })
  if (!parsed) throw new Error("fixture snapshot did not parse")
  return parsed
}

describe("WebMCP sign-in detection (ADR-277)", () => {
  test("signInFieldPresent matches credential textboxes across locales", () => {
    for (const name of [
      "Password",
      "\u5BC6\u78BC",
      "\u30D1\u30B9\u30EF\u30FC\u30C9",
      "Mot de passe",
      "One-time code",
    ]) {
      expect(WebMcpProfile.signInFieldPresent(nodesOf([{ id: "1_1", role: "textbox", name }]))).toBe(true)
    }
  })

  test("signInFieldPresent ignores buttons, links and ordinary textboxes", () => {
    const cases: Record<string, unknown>[] = [
      { id: "1_1", role: "button", name: "Password manager" },
      { id: "1_2", role: "textbox", name: "Search" },
      { id: "1_3", role: "link", name: "Forgot password" },
    ]
    for (const node of cases) expect(WebMcpProfile.signInFieldPresent(nodesOf([node]))).toBe(false)
  })

  test("signInLanding matches sign-in paths and fails closed otherwise", () => {
    for (const url of [
      "https://idp.test/login?next=%2F",
      "https://app.test/oauth2/authorize",
      "https://app.test/sign-in/",
      "http://localhost:3000/auth",
    ]) {
      expect(WebMcpProfile.signInLanding(url)).toBe(true)
    }
    for (const url of ["https://app.test/blog/login-tips", "https://app.test/", "not a url", undefined]) {
      expect(WebMcpProfile.signInLanding(url)).toBe(false)
    }
  })

  test("annotateSignIn appends exactly one note at the end and varies by interact", () => {
    const interact = { content: [{ type: "text", text: "existing" }] }
    WebMcpProfile.annotateSignIn(interact, "field", true)
    expect(interact.content).toHaveLength(2)
    expect(interact.content.at(-1)?.text).toMatch(/^\[AX Code\]/)
    expect(interact.content.at(-1)?.text).toContain("wait_for for the signed-in text")

    const read = { content: [{ type: "text", text: "existing" }] }
    WebMcpProfile.annotateSignIn(read, "field", false)
    expect(read.content).toHaveLength(2)
    expect(read.content.at(-1)?.text).toContain("take_snapshot again")
    expect(read.content.at(-1)?.text).not.toContain("wait_for for the signed-in text")

    const landing = { content: [{ type: "text", text: "existing" }] }
    WebMcpProfile.annotateSignIn(landing, "landing", true)
    expect(landing.content).toHaveLength(2)
    expect(landing.content.at(-1)?.text).toContain("landing URL looks like a sign-in route")
  })

  test("annotateSignIn leaves a non-record result alone", () => {
    expect(() => WebMcpProfile.annotateSignIn(undefined, "field", true)).not.toThrow()
    expect(() => WebMcpProfile.annotateSignIn("text", "landing", false)).not.toThrow()
  })

  test("promptBlock carries the hand-off for read and interact, not page", () => {
    const sentence = "If a snapshot shows a credential field or the bridge notes a sign-in page"
    expect(WebMcpProfile.promptBlock("read").join("\n")).toContain(sentence)
    expect(WebMcpProfile.promptBlock("interact").join("\n")).toContain(sentence)
    expect(WebMcpProfile.promptBlock("page").join("\n")).not.toContain(sentence)
  })
})

type GrantState = { read: Set<string>; interact: Map<string, number> }

function policy(toolName: string, profile: WebMcpProfile.Configuration, grants: GrantState): WebMcpProfile.Policy {
  return {
    server: "bridge",
    toolName,
    profile,
    readGrants: () => grants.read,
    interactGrants: () => grants.interact,
    consumeInteractBudget: (origin) => {
      const remaining = grants.interact.get(origin)
      if (remaining === undefined || remaining <= 0) return false
      grants.interact.set(origin, remaining - 1)
      return true
    },
  }
}

/** A fake bridge that feeds a snapshot with the supplied child nodes. */
function bridge(children: Record<string, unknown>[]) {
  const state = { url: PAGE, text: '## Latest page snapshot\nuid=1_0 RootWebArea "App"' }
  const client = {
    callTool: vi.fn(async (request: { name: string }): Promise<Record<string, unknown>> => {
      if (request.name === "list_pages") {
        return { content: [], structuredContent: { pages: [{ id: 1, url: state.url, selected: true }] } }
      }
      if (request.name === "take_snapshot" || request.name === "wait_for") {
        return {
          content: [{ type: "text", text: state.text }],
          structuredContent: {
            snapshot: { id: "1_0", role: "RootWebArea", name: "App", children },
          },
        }
      }
      return { content: [] }
    }),
  }
  return { client, state }
}

const options = () => ({ toolCallId: "call", messages: [] }) as never

async function snapshotTool(profile: WebMcpProfile.Configuration, client: unknown, grants: GrantState) {
  return convertMcpTool(
    { name: "take_snapshot", inputSchema: { type: "object" } } as never,
    client as never,
    5000,
    policy("take_snapshot", profile, grants),
  )
}

describe("WebMCP sign-in hand-off over dispatch (ADR-277)", () => {
  test("a snapshot with a Password textbox returns the sign-in note last", async () => {
    const profile = readProfile()
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map() }
    const { client } = bridge([{ id: "1_1", role: "textbox", name: "Password" }])
    const snapshot = await snapshotTool(profile, client, grants)
    const result = (await snapshot.execute!({ pageId: 1 }, options())) as {
      content: { type?: string; text?: string }[]
    }
    expect(result.content.at(-1)?.text).toContain("may be a sign-in step")
    // The note comes after the untrusted label that boundReadResult prepends.
    expect(result.content[0]?.text).toContain("[Untrusted web content")
  })

  test("a snapshot with only a Search textbox does not add the note", async () => {
    const profile = readProfile()
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map() }
    const { client } = bridge([{ id: "1_1", role: "textbox", name: "Search" }])
    const snapshot = await snapshotTool(profile, client, grants)
    const result = (await snapshot.execute!({ pageId: 1 }, options())) as {
      content: { type?: string; text?: string }[]
    }
    expect(result.content.some((part) => part.text?.includes("may be a sign-in step"))).toBe(false)
  })

  test("an interact-tier snapshot offers wait_for in the sign-in note", async () => {
    const profile = fullProfile()
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const { client } = bridge([{ id: "1_1", role: "textbox", name: "Password" }])
    const snapshot = await snapshotTool(profile, client, grants)
    const result = (await snapshot.execute!({ pageId: 1 }, options())) as {
      content: { type?: string; text?: string }[]
    }
    expect(result.content.at(-1)?.text).toContain("wait_for for the signed-in text")
  })

  test("a wait_for whose snapshot shows a Password textbox carries the interact note last", async () => {
    const profile = fullProfile()
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const { client } = bridge([{ id: "1_1", role: "textbox", name: "Password" }])
    const wait = await convertMcpTool(
      { name: "wait_for", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("wait_for", profile, grants),
    )
    const result = (await wait.execute!({ pageId: 1, text: ["Sign in"] }, options())) as {
      content: { type?: string; text?: string }[]
    }
    expect(result.content.filter((part) => part.text?.includes("may be a sign-in step"))).toHaveLength(1)
    expect(result.content.at(-1)?.text).toContain("wait_for for the signed-in text")
  })

  test("a cut snapshot stays inside the 32 KiB read budget with every trailing note attached", async () => {
    const profile = fullProfile()
    const grants: GrantState = { read: new Set([ORIGIN]), interact: new Map([[ORIGIN, 20]]) }
    const { client, state } = bridge([{ id: "1_1", role: "textbox", name: "Password" }])
    // Oversized text that also reports an open dialog, so the truncation,
    // sign-in and blocking-dialog notes are all appended after the cut.
    const lines = Array.from({ length: 1500 }, (_, i) => `uid=1_${i + 2} text "${"x".repeat(20)}"`)
    state.text = [
      "## Open dialog\nalert: hi",
      '## Latest page snapshot\nuid=1_0 RootWebArea "App"\n  uid=1_1 textbox "Password"',
      ...lines,
    ].join("\n")
    const snapshot = await snapshotTool(profile, client, grants)
    const result = (await snapshot.execute!({ pageId: 1 }, options())) as {
      content: { type?: string; text?: string }[]
    }
    const texts = result.content.map((part) => part.text ?? "")
    expect(texts.some((text) => text.includes("Snapshot truncated to the 32 KiB read budget"))).toBe(true)
    expect(texts.some((text) => text.includes("may be a sign-in step"))).toBe(true)
    expect(texts.some((text) => text.includes("blocked by a JavaScript dialog"))).toBe(true)
    const total = texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0)
    expect(total).toBeLessThanOrEqual(32 * 1024)
  })
})

type Content = { content: { type?: string; text?: string }[] }
const landingNotes = (result: Content) =>
  result.content.filter((part) => part.text?.includes("looks like a sign-in route"))

describe("WebMCP sign-in landing over dispatch (ADR-277)", () => {
  const grants = (): GrantState => ({ read: new Set(), interact: new Map() })

  test("a new_page that lands on a sign-in route carries the landing note last, once", async () => {
    const profile = fullProfile()
    const before = { content: [], structuredContent: { pages: [{ id: 1, url: "about:blank", selected: true }] } }
    const opened = {
      content: [
        { type: "text", text: "## Pages\n1: about:blank\n2: Sign in (https://idp.test/login?next=%2F) [selected]" },
      ],
      structuredContent: {
        pages: [
          { id: 1, url: "about:blank" },
          { id: 2, url: "https://idp.test/login?next=%2F", selected: true },
        ],
      },
    }
    const client = {
      callTool: vi.fn(async (request: { name: string }) => (request.name === "new_page" ? opened : before)),
    }
    const tool = await convertMcpTool(
      { name: "new_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("new_page", profile, grants()),
    )
    const result = (await tool.execute!({ url: "https://idp.test/login?next=%2F" }, options())) as Content
    expect(landingNotes(result)).toHaveLength(1)
    expect(result.content.at(-1)?.text).toContain("looks like a sign-in route")
    // The page the call created is still marked, landing note or not.
    expect(WebMcpProfile.isAgentPage(profile, 2)).toBe(true)
  })

  test("a navigate_page that lands on a sign-in route carries the landing note for its own page", async () => {
    const profile = fullProfile()
    const login = `${ORIGIN}/login`
    const pages = { content: [], structuredContent: { pages: [{ id: 1, url: login, selected: true }] } }
    const navigated = {
      content: [{ type: "text", text: `Successfully navigated to ${login}` }],
      structuredContent: {
        message: `Successfully navigated to ${login}`,
        pages: [{ id: 1, url: login, selected: true }],
      },
    }
    const client = {
      callTool: vi.fn(async (request: { name: string }) => (request.name === "navigate_page" ? navigated : pages)),
    }
    const tool = await convertMcpTool(
      { name: "navigate_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("navigate_page", profile, grants()),
    )
    const result = (await tool.execute!({ pageId: 1, url: login }, options())) as Content
    expect(landingNotes(result)).toHaveLength(1)
    expect(result.content.at(-1)?.text).toContain("looks like a sign-in route")
  })

  test("a landing off a sign-in route carries no landing note", async () => {
    const profile = fullProfile()
    const before = { content: [], structuredContent: { pages: [{ id: 1, url: "about:blank", selected: true }] } }
    const opened = {
      content: [{ type: "text", text: "## Pages\n1: about:blank\n2: Orders (https://app.test/orders) [selected]" }],
      structuredContent: {
        pages: [
          { id: 1, url: "about:blank" },
          { id: 2, url: PAGE, selected: true },
        ],
      },
    }
    const client = {
      callTool: vi.fn(async (request: { name: string }) => (request.name === "new_page" ? opened : before)),
    }
    const tool = await convertMcpTool(
      { name: "new_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("new_page", profile, grants()),
    )
    const result = (await tool.execute!({ url: PAGE }, options())) as Content
    expect(landingNotes(result)).toHaveLength(0)
  })
})
