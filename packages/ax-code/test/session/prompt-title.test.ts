import { describe, expect, test } from "vitest"

import { AX_ENGINE_PROVIDER_ID } from "../../src/provider/ax-engine"
import { ProviderID } from "../../src/provider/schema"
import {
  cleanGeneratedTitle,
  fallbackTitleFromUserText,
  shouldSkipAutomaticTitle,
} from "../../src/session/prompt-title"

describe("session prompt title", () => {
  test("skips automatic title generation for the managed ax-engine provider", () => {
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID) })).toBe(true)
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.xai })).toBe(false)
  })

  test("cleanGeneratedTitle strips thinking blocks and wrappers", () => {
    expect(cleanGeneratedTitle("<think>pondering</think>\nCount lines of code")).toBe("Count lines of code")
    expect(cleanGeneratedTitle('"Debugging production 500s"')).toBe("Debugging production 500s")
    expect(cleanGeneratedTitle("Title: Auth refresh token support")).toBe("Auth refresh token support")
    expect(cleanGeneratedTitle("<think>only thinking</think>")).toBeUndefined()
    expect(cleanGeneratedTitle("   ")).toBeUndefined()
  })

  test("fallbackTitleFromUserText uses the first non-empty line", () => {
    expect(fallbackTitleFromUserText("count the line of code")).toBe("count the line of code")
    expect(fallbackTitleFromUserText("\n\n  hello world  \nmore")).toBe("hello world")
    expect(
      fallbackTitleFromUserText(
        "a".repeat(100),
      ),
    ).toBe("a".repeat(77) + "...")
    expect(fallbackTitleFromUserText("   \n  ")).toBeUndefined()
  })
})
