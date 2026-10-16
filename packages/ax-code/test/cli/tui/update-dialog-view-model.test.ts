import { describe, expect, test } from "vitest"
import {
  primaryUpdateAction,
  updateStateFromAvailable,
  updateStateFromCheck,
  updateStateFromUpgrade,
} from "../../../src/cli/tui/update-dialog-view-model"

const describeError = (error: unknown) => (error instanceof Error ? error.message : "unknown failure")

describe("update dialog view model", () => {
  test("maps a version check report to a dialog state", () => {
    expect(updateStateFromCheck({ current: "7.26.0", latest: "7.26.0", upToDate: true, method: "curl" })).toEqual({
      type: "current",
      version: "7.26.0",
    })
    expect(
      updateStateFromCheck({
        current: "7.26.0",
        latest: "7.27.0",
        upToDate: false,
        method: "curl",
        releaseType: "minor",
      }),
    ).toEqual({ type: "available", current: "7.26.0", latest: "7.27.0" })
    expect(
      updateStateFromCheck({ current: "7.26.0", latest: null, upToDate: null, method: "curl", error: "offline" }),
    ).toEqual({ type: "check-failed", message: "offline" })
    expect(updateStateFromCheck({ current: "7.26.0", latest: null, upToDate: null, method: "curl" }).type).toBe(
      "check-failed",
    )
  })

  test("maps upgrade responses to installed or failed", () => {
    expect(updateStateFromUpgrade("7.27.0", { data: { success: true, version: "7.27.0" } }, describeError)).toEqual({
      type: "installed",
      version: "7.27.0",
      warnings: [],
    })
    expect(
      updateStateFromUpgrade(
        "7.27.0",
        { data: { success: true, version: "7.27.0", warnings: ["PATH"] } },
        describeError,
      ),
    ).toMatchObject({ type: "installed", warnings: ["PATH"] })
    expect(updateStateFromUpgrade("7.27.0", { error: new Error("boom") }, describeError)).toEqual({
      type: "install-failed",
      message: "boom",
      latest: "7.27.0",
    })
    expect(
      updateStateFromUpgrade("7.27.0", { data: { success: false, error: "denied" } }, describeError),
    ).toMatchObject({ type: "install-failed", message: "denied" })
  })

  test("Enter runs the primary action of each state", () => {
    expect(primaryUpdateAction({ type: "checking" })).toBe("none")
    expect(primaryUpdateAction({ type: "installing", version: "1" })).toBe("none")
    expect(primaryUpdateAction({ type: "current", version: "1" })).toBe("none")
    expect(primaryUpdateAction(updateStateFromAvailable("1.0.0", "1.0.1"))).toBe("install")
    expect(primaryUpdateAction({ type: "check-failed", message: "x" })).toBe("retry-check")
    expect(primaryUpdateAction({ type: "install-failed", message: "x", latest: "1" })).toBe("retry-install")
    expect(primaryUpdateAction({ type: "installed", version: "1", warnings: [] })).toBe("exit")
  })
})
