import { describe, expect, test } from "vitest"
import {
  formatTuiUpgradeCompleteMessage,
  nextTuiStartupUpgradeCheckState,
  shouldRunTuiStartupUpgradeCheck,
} from "../../../src/cli/cmd/tui/upgrade-check-view-model"

const DAY_MS = 24 * 60 * 60 * 1_000

describe("tui upgrade check view model", () => {
  test("runs when there is no previous startup check state", () => {
    expect(
      shouldRunTuiStartupUpgradeCheck({
        state: undefined,
        currentVersion: "6.3.3",
        nowMs: 10_000,
        intervalMs: DAY_MS,
      }),
    ).toBe(true)
  })

  test("does not run more than once per interval for the same installed version", () => {
    expect(
      shouldRunTuiStartupUpgradeCheck({
        state: { currentVersion: "6.3.3", checkedAt: 10_000 },
        currentVersion: "6.3.3",
        nowMs: 10_000 + DAY_MS - 1,
        intervalMs: DAY_MS,
      }),
    ).toBe(false)
  })

  test("runs again after the daily interval expires", () => {
    expect(
      shouldRunTuiStartupUpgradeCheck({
        state: { currentVersion: "6.3.3", checkedAt: 10_000 },
        currentVersion: "6.3.3",
        nowMs: 10_000 + DAY_MS,
        intervalMs: DAY_MS,
      }),
    ).toBe(true)
  })

  test("runs after the installed version changes", () => {
    expect(
      shouldRunTuiStartupUpgradeCheck({
        state: { currentVersion: "6.3.3", checkedAt: 10_000 },
        currentVersion: "6.3.4",
        nowMs: 20_000,
        intervalMs: DAY_MS,
      }),
    ).toBe(true)
  })

  test("records the current installed version and check time", () => {
    expect(nextTuiStartupUpgradeCheckState({ currentVersion: "6.3.3", nowMs: 42 })).toEqual({
      currentVersion: "6.3.3",
      checkedAt: 42,
    })
  })

  test("keeps post-upgrade warnings in the restart dialog", () => {
    expect(formatTuiUpgradeCompleteMessage("7.6.4")).toBe(
      "Successfully updated to ax-code v7.6.4. Please restart the application.",
    )
    expect(formatTuiUpgradeCompleteMessage("7.6.4", ["PATH still resolves an older launcher."])).toContain(
      "Warnings:\n- PATH still resolves an older launcher.",
    )
  })
})
