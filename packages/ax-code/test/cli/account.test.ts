import { describe, expect, test, vi } from "vitest"
import * as prompts from "@clack/prompts"
import stripAnsi from "strip-ansi"

import { Account } from "../../src/account"

// Login opens the device URL; never launch a real browser from a test.
vi.mock("open", () => ({ default: vi.fn(async () => undefined) }))
import { formatAccountLabel, formatOrgLine, LoginCommand } from "../../src/cli/cmd/account"

describe("console account display", () => {
  test("includes the account url in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, false))).toBe(
      "one@example.com https://one.example.com",
    )
  })

  test("includes the active marker in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, true))).toBe(
      "one@example.com https://one.example.com (active)",
    )
  })

  test("includes the account url in org rows", () => {
    expect(
      stripAnsi(
        formatOrgLine({ email: "one@example.com", url: "https://one.example.com" }, { id: "org-1", name: "One" }, true),
      ),
    ).toBe("  ● One  one@example.com  https://one.example.com  org-1")
  })
})

describe("console login", () => {
  test("stops the spinner with an error when polling fails in transport", async () => {
    const spinner = { start: vi.fn(), stop: vi.fn(), error: vi.fn() }
    vi.spyOn(prompts, "spinner").mockReturnValue(spinner as never)
    vi.spyOn(prompts, "intro").mockImplementation(() => {})
    vi.spyOn(prompts.log, "info").mockImplementation(() => {})
    vi.spyOn(Account, "login").mockResolvedValue({
      url: "https://console.example.com/device",
      user: "ABCD-1234",
      interval: 0,
      expiry: 60,
    } as never)
    vi.spyOn(Account, "durationToMillis").mockImplementation((value) => Number(value) * 1000)
    vi.spyOn(Account, "poll").mockRejectedValue(new Error("HTTP request failed"))

    try {
      await LoginCommand.handler({ url: "https://console.example.com", $0: "ax-code", _: [] } as never)
      expect(spinner.error).toHaveBeenCalledWith(expect.stringContaining("HTTP request failed"))
    } finally {
      vi.restoreAllMocks()
    }
  })
})
