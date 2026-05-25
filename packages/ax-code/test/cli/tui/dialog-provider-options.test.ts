import { describe, expect, test } from "bun:test"
import {
  providerDialogConnected,
  providerDialogProviders,
} from "../../../src/cli/cmd/tui/component/dialog-provider-options"

function provider(id: string, name = id) {
  return { id, name } as any
}

describe("provider dialog options", () => {
  test("uses available providers when the provider list bootstrap succeeds", () => {
    expect(
      providerDialogProviders({
        available: [provider("openai", "OpenAI")],
        configured: [provider("xai", "xAI")],
      }).map((item) => item.id),
    ).toEqual(["openai"])
  })

  test("falls back to configured providers when provider list bootstrap is empty", () => {
    expect(
      providerDialogProviders({
        available: [],
        configured: [provider("xai", "xAI"), provider("zai-coding-plan", "Z.AI Coding Plan")],
      }).map((item) => item.id),
    ).toEqual(["zai-coding-plan", "xai"])
  })

  test("keeps hidden providers out of the connect dialog fallback", () => {
    expect(
      providerDialogProviders({
        available: [],
        configured: [provider("google", "Google"), provider("github-copilot", "GitHub Copilot"), provider("xai", "xAI")],
      }).map((item) => item.id),
    ).toEqual(["xai"])
  })

  test("treats configured fallback providers as connected", () => {
    expect(
      providerDialogConnected({
        providerID: "xai",
        connected: [],
        configured: [provider("xai", "xAI")],
      }),
    ).toBe(true)
    expect(
      providerDialogConnected({
        providerID: "openai",
        connected: ["openai"],
        configured: [],
      }),
    ).toBe(true)
  })
})
