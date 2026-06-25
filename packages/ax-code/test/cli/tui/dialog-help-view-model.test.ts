import { describe, expect, test } from "vitest"
import { dialogHelpBodyHeight } from "../../../src/cli/cmd/tui/ui/dialog-help-view-model"

describe("tui dialog help view model", () => {
  test("keeps the help body inside the dialog safe area in tall terminals", () => {
    expect(dialogHelpBodyHeight({ contentRows: 34, terminalHeight: 60 })).toBe(34)
    expect(dialogHelpBodyHeight({ contentRows: 40, terminalHeight: 60 })).toBe(38)
  })

  test("keeps the help dialog scrollable in short terminals", () => {
    expect(dialogHelpBodyHeight({ contentRows: 34, terminalHeight: 30 })).toBe(16)
    expect(dialogHelpBodyHeight({ contentRows: 0, terminalHeight: 30 })).toBe(1)
  })
})
