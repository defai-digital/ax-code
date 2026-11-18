import { expect, test, vi } from "vitest"
import * as Listing from "../../src/mcp/webmcp-listing"

vi.mock("../../src/mcp/webmcp-profile", () => {
  throw new Error("Page-tool contracts must not load live bridge policy")
})
vi.mock("../../src/mcp/webmcp-launch", () => {
  throw new Error("Page-tool contracts must not load bridge launch services")
})
vi.mock("../../src/mcp/webmcp-config", () => {
  throw new Error("Listing state only needs the configuration type")
})

test("page-tool contracts and approval binding load without live policy, launch services or config schemas", () => {
  const profile = { allowedOrigins: [] }
  const tools = Listing.parseToolListing({
    structuredContent: {
      webmcpTools: [{ name: "search", inputSchema: { type: "object" }, annotations: { readOnly: true } }],
    },
  })
  expect(tools).toHaveLength(1)
  if (!tools) throw new Error("Expected a structured listing")
  // A hand-opened LAN HTTP page can be read under its grant (ADR-277).
  expect(Listing.recordListing(Listing.stateFor(profile), 1, tools, "http://192.168.1.2/search")).toEqual({ ok: true })
  const approval = Listing.captureApproval(profile, 1, "search")
  expect(approval).toMatchObject({ origin: "http://192.168.1.2", hash: Listing.descriptorHash(tools[0]!) })
  expect(Listing.verifyBinding(profile, 1, "search", tools, "http://192.168.1.2/results", approval)).toEqual({
    ok: true,
  })
  expect(Listing.verifyBinding(profile, 1, "search", tools, "https://example.test", approval)).toMatchObject({
    ok: false,
    error: expect.stringContaining("origin changed since approval"),
  })
})
