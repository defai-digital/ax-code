import { describe, expect, test, vi } from "vitest"

import { runSettingsDeleteMutation } from "./settingsDeleteMutation"

describe("runSettingsDeleteMutation", () => {
  test("returns completed mutation results", async () => {
    const result = await runSettingsDeleteMutation(async () => ({ ok: true, message: "Deleted" }))

    expect(result).toEqual({ status: "completed", result: { ok: true, message: "Deleted" } })
  })

  test("converts thrown delete mutations into explicit errors", async () => {
    const error = new Error("delete failed")
    const mutation = vi.fn(async () => {
      throw error
    })

    const result = await runSettingsDeleteMutation(mutation)

    expect(result).toEqual({ status: "unexpected-error", error })
  })

  test("supports boolean mutation results", async () => {
    await expect(runSettingsDeleteMutation(async () => true)).resolves.toEqual({
      status: "completed",
      result: true,
    })
  })
})
