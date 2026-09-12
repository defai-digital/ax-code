import { describe, expect, test } from "vitest"

import { AX_ENGINE_PROVIDER_ID } from "../../src/provider/ax-engine"
import { ProviderID } from "../../src/provider/schema"
import {
  capTitleWords,
  cleanGeneratedTitle,
  fallbackTitleFromUserText,
  shouldSkipAutomaticTitle,
} from "../../src/session/prompt-title"

describe("session prompt title", () => {
  test("skips automatic title generation for the managed ax-engine provider", () => {
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID) })).toBe(true)
    expect(shouldSkipAutomaticTitle({ providerID: ProviderID.make("groq") })).toBe(false)
  })

  test("cleanGeneratedTitle strips thinking blocks and wrappers", () => {
    expect(cleanGeneratedTitle("<think>pondering</think>\nCount lines of code")).toBe("Count lines of code")
    expect(cleanGeneratedTitle('"Debugging production 500s"')).toBe("Debugging production 500s")
    expect(cleanGeneratedTitle("Title: Auth refresh token support")).toBe("Auth refresh token support")
    expect(cleanGeneratedTitle("<think>only thinking</think>")).toBeUndefined()
    expect(cleanGeneratedTitle("<mm:think>pondering MiniMax style</mm:think>\nQuality review")).toBe("Quality review")
    expect(cleanGeneratedTitle("<mm:think>only thinking</mm:think>")).toBeUndefined()
    expect(cleanGeneratedTitle("   ")).toBeUndefined()
  })

  test("fallbackTitleFromUserText uses the first non-empty line", () => {
    expect(fallbackTitleFromUserText("count the line of code")).toBe("count the line of code")
    expect(fallbackTitleFromUserText("\n\n  hello world  \nmore")).toBe("hello world")
    expect(fallbackTitleFromUserText("a".repeat(100))).toBe("a".repeat(77) + "...")
    expect(fallbackTitleFromUserText("   \n  ")).toBeUndefined()
  })

  test("capTitleWords collapses whitespace and clamps to the 12-word budget", () => {
    expect(capTitleWords("  fix   the  flaky test ")).toBe("fix the flaky test")
    expect(capTitleWords("a b c", 2)).toBe("a b...")
    const twelve = "one two three four five six seven eight nine ten eleven twelve"
    expect(capTitleWords(twelve)).toBe(twelve)
    expect(capTitleWords(`${twelve} thirteen`)).toBe(`${twelve}...`)
  })

  test("cleanGeneratedTitle clamps a long generated title to 12 words", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen"
    expect(cleanGeneratedTitle(long)).toBe("one two three four five six seven eight nine ten eleven twelve...")
  })

  test("fallbackTitleFromUserText summarizes the first sentence within 12 words", () => {
    expect(
      fallbackTitleFromUserText(
        "the footer progress bar is not cool. also make the session id copyable and summarize the first prompt",
      ),
    ).toBe("the footer progress bar is not cool.")
    expect(
      fallbackTitleFromUserText("one two three four five six seven eight nine ten eleven twelve thirteen fourteen"),
    ).toBe("one two three four five six seven eight nine ten eleven twelve...")
  })
})
