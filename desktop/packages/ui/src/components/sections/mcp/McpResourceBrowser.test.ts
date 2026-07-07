import { describe, expect, test } from "vitest"
import type { McpReadResourceResult, McpResource } from "@ax-code/sdk/v2"

import { resourcePreview, resourcesForServer } from "./McpResourceBrowser"

describe("McpResourceBrowser helpers", () => {
  test("filters resources to the selected server and sorts by name then URI", () => {
    const resources: Record<string, McpResource> = {
      "other:alpha": { client: "other", name: "alpha", uri: "mcp://other/alpha" },
      "docs:zeta": { client: "docs", name: "zeta", uri: "mcp://docs/zeta" },
      "docs:alpha-2": { client: "docs", name: "alpha", uri: "mcp://docs/alpha-2" },
      "docs:alpha-1": { client: "docs", name: "alpha", uri: "mcp://docs/alpha-1" },
    }

    expect(resourcesForServer(resources, "docs").map((resource) => resource.uri)).toEqual([
      "mcp://docs/alpha-1",
      "mcp://docs/alpha-2",
      "mcp://docs/zeta",
    ])
  })

  test("combines text resource contents and labels binary-only previews", () => {
    const text = resourcePreview(
      {
        contents: [
          { uri: "mcp://docs/a", text: "first" },
          { uri: "mcp://docs/b", text: "second" },
        ],
      } as McpReadResourceResult,
      (mime) => `Binary ${mime}`,
    )
    expect(text).toEqual({ text: "first\n\nsecond", truncated: false, binaryOnly: false })

    const binary = resourcePreview(
      {
        contents: [{ uri: "mcp://docs/image", mimeType: "image/png", blob: "AAAA" }],
      } as McpReadResourceResult,
      (mime) => `Binary ${mime}`,
    )
    expect(binary).toEqual({ text: "Binary image/png", truncated: false, binaryOnly: true })
  })
})
