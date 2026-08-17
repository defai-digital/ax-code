import { describe, expect, test } from "vitest"
import { urlAllowlistServerRoute } from "../../../src/cli/cmd/tui/util/server-url"

describe("urlAllowlistServerRoute", () => {
  test("resolves root-relative routes on the configured server origin", () => {
    expect(urlAllowlistServerRoute("http://127.0.0.1:4096/workspace", "/provider/models?refresh=1").href).toBe(
      "http://127.0.0.1:4096/provider/models?refresh=1",
    )
  })

  test.each(["https://attacker.invalid/models", "//attacker.invalid/models", "provider/models"])(
    "rejects route override %s",
    (route) => {
      expect(() => urlAllowlistServerRoute("http://127.0.0.1:4096", route)).toThrow(
        "Server routes must be root-relative paths",
      )
    },
  )
})
