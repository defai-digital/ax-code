import { describe, expect, test } from "vitest"
import { shouldHideAutocompleteOnInput } from "../../../src/cli/cmd/tui/component/prompt/autocomplete"

describe("autocomplete display-offset handling", () => {
  test("keeps the dropdown open when wide characters precede the @ token", () => {
    // "世界世界 " is 5 UTF-16 units but 9 display columns; the trigger index
    // and cursor offset arrive in display columns. Cursor sits after "@a".
    expect(
      shouldHideAutocompleteOnInput({
        mode: "@",
        value: "世界世界 @ab cd",
        triggerIndex: 9,
        cursorOffset: 11,
      }),
    ).toBe(false)
  })

  test("hides once whitespace enters the @ token after wide characters", () => {
    // Cursor sits after "@ab c" — the filter range now contains whitespace.
    expect(
      shouldHideAutocompleteOnInput({
        mode: "@",
        value: "世界世界 @ab cd",
        triggerIndex: 9,
        cursorOffset: 14,
      }),
    ).toBe(true)
  })

  test("recognizes a lagging trigger character behind wide characters", () => {
    // "你好@" — trigger at display column 4 (UTF-16 index 2); the cursor
    // update can lag by one tick, so equality at the trigger index keeps
    // the dropdown open when the trigger character is really there.
    expect(
      shouldHideAutocompleteOnInput({
        mode: "@",
        value: "你好@",
        triggerIndex: 4,
        cursorOffset: 4,
      }),
    ).toBe(false)
  })

  test("still hides when the cursor moves before the trigger", () => {
    expect(
      shouldHideAutocompleteOnInput({
        mode: "@",
        value: "你好@",
        triggerIndex: 4,
        cursorOffset: 2,
      }),
    ).toBe(true)
  })
})
