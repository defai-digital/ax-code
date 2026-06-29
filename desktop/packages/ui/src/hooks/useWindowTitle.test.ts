import { describe, expect, test } from "vitest"

import { resolveDesktopWindowInstanceLabel } from "./useWindowTitle"

describe("resolveDesktopWindowInstanceLabel", () => {
  test("keeps a remote Electron window labeled before the local origin is injected", () => {
    expect(
      resolveDesktopWindowInstanceLabel({
        currentHref: "https://remote.example.com/projects/alpha",
        localOrigin: null,
        hosts: [{ label: "Remote A", url: "https://remote.example.com/" }],
      }),
    ).toBe("Remote A")
  })

  test("omits the instance label for the known local desktop origin", () => {
    expect(
      resolveDesktopWindowInstanceLabel({
        currentHref: "http://localhost:3910/projects/alpha",
        localOrigin: "http://localhost:3910",
        hosts: [{ label: "Remote A", url: "https://remote.example.com/" }],
      }),
    ).toBeNull()
  })

  test("falls back to a generic instance label for unknown remote hosts", () => {
    expect(
      resolveDesktopWindowInstanceLabel({
        currentHref: "https://unknown.example.com/",
        localOrigin: "http://localhost:3910",
        hosts: [{ label: "Remote A", url: "https://remote.example.com/" }],
      }),
    ).toBe("Instance")
  })
})
