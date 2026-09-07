import { afterEach, expect, test } from "vitest"
import { ToolDiscovery } from "../../src/session/tool-discovery"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())
const catalog = [
  {
    name: "docs_search",
    description: "Search documentation",
    schema: { type: "object", properties: { query: { type: "string" } } },
  },
  { name: "tickets_list", description: "List support tickets", schema: { type: "object" } },
]

test("discovers schemas in one call and retains a bounded per-session selection", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      const a = SessionID.make("ses_discovery_a")
      const b = SessionID.make("ses_discovery_b")
      expect([...ToolDiscovery.visible(a, catalog)]).toEqual([])
      const found = ToolDiscovery.search(a, catalog, { query: "documentation" })
      expect(found.tools).toEqual([catalog[0]])
      expect([...ToolDiscovery.visible(a, catalog)]).toEqual(["docs_search"])
      expect([...ToolDiscovery.visible(b, catalog)]).toEqual([])
      expect(ToolDiscovery.search(a, catalog, { query: "unknownword" }).tools).toEqual([])
    },
  })
})

test("revoked tools are removed and changed schemas come from the current catalog", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      const id = SessionID.make("ses_discovery")
      ToolDiscovery.search(id, catalog, { query: "docs_search" })
      expect([...ToolDiscovery.visible(id, [catalog[1]])]).toEqual([])
      expect([...ToolDiscovery.visible(id, catalog)]).toEqual([])
      const changed = [{ ...catalog[0], schema: { type: "object", required: ["newField"] } }]
      expect(ToolDiscovery.search(id, changed, { query: "docs" }).tools[0].schema).toEqual(changed[0].schema)
      expect(() => ToolDiscovery.search(id, catalog, { query: " ", limit: 0 })).toThrow()
    },
  })
})

test("large schemas are selected without emitting an unbounded discovery result", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      const id = SessionID.make("ses_large")
      const big = [{ name: "large", description: "large tool", schema: { description: "x".repeat(100_000) } }]
      const found = ToolDiscovery.search(id, big, { query: "large" })
      expect(found.tools[0].schemaOmitted).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(found))).toBeLessThan(2_000)
      expect([...ToolDiscovery.visible(id, big)]).toEqual(["large"])
    },
  })
})
