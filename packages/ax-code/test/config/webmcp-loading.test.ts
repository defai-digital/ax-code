import { afterEach, expect, test, vi } from "vitest"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

vi.mock("../../src/mcp/webmcp-profile", () => {
  throw new Error("Reading configuration must not load WebMCP page policy")
})

afterEach(() => Instance.disposeAll())

test("configuration injects its disabled WebMCP launch entry without live page policy", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Config.get()).mcp?.webmcp).toMatchObject({
        type: "local",
        enabled: false,
        command: expect.arrayContaining(["chrome-devtools-mcp@1.10.1", "--isolated"]),
        webmcp: { allowedOrigins: [], read: true, interact: true },
      })
    },
  })
})
