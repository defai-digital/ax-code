import { describe, expect, it } from "vitest"

import { parseServeCliOptions } from "./cli-options.js"

describe("parseServeCliOptions", () => {
  it("parses port and trims non-empty host values", () => {
    expect(
      parseServeCliOptions({
        argv: ["--port", "4123", "--host= 127.0.0.1 "],
        defaultPort: 3902,
      }),
    ).toMatchObject({
      port: 4123,
      host: "127.0.0.1",
    })
  })

  it("falls back to default port for invalid port values", () => {
    expect(
      parseServeCliOptions({
        argv: ["--port", "not-a-port"],
        defaultPort: 3902,
      }).port,
    ).toBe(3902)
  })

  it("preserves explicit ui password values", () => {
    expect(
      parseServeCliOptions({
        argv: ["--ui-password", "  keep spaces  "],
        env: { AX_CODE_DESKTOP_UI_PASSWORD: "from-env" },
        defaultPort: 3902,
      }).uiPassword,
    ).toBe("  keep spaces  ")
  })
})
