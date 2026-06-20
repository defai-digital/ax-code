import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import {
  isOptionalStateUnavailableError,
  optionalStateErrorMessage,
  shouldSurfaceOptionalStateError,
} from "../../../src/cli/cmd/tui/util/optional-state"
import { readOptionalJsonState } from "../../../src/cli/cmd/tui/util/optional-json-state"
import { tmpdir } from "../../fixture/fixture"

describe("tui optional state errors", () => {
  test("suppresses read-only and missing-file state errors from user-facing toasts", () => {
    expect(isOptionalStateUnavailableError({ code: "ENOENT" })).toBeTrue()
    expect(isOptionalStateUnavailableError({ code: "EACCES" })).toBeTrue()
    expect(isOptionalStateUnavailableError({ code: "EPERM" })).toBeTrue()
    expect(isOptionalStateUnavailableError({ code: "EROFS" })).toBeTrue()
    expect(shouldSurfaceOptionalStateError({ code: "EPERM" })).toBeFalse()
  })

  test("still surfaces unexpected state errors", () => {
    expect(isOptionalStateUnavailableError(new Error("boom"))).toBeFalse()
    expect(shouldSurfaceOptionalStateError(new Error("boom"))).toBeTrue()
  })

  test("formats fallback messages for non-error values", () => {
    expect(optionalStateErrorMessage(new Error("disk full"), "fallback")).toBe("disk full")
    expect(optionalStateErrorMessage("weird", "fallback")).toBe("fallback")
  })

  test("separates missing optional JSON state from invalid state", async () => {
    await using tmp = await tmpdir()
    const missing = await readOptionalJsonState(path.join(tmp.path, "missing.json"))
    expect(missing).toEqual({ status: "missing" })

    const validPath = path.join(tmp.path, "valid.json")
    await fs.writeFile(validPath, JSON.stringify({ ok: true }))
    const found = await readOptionalJsonState<{ ok: boolean }>(validPath)
    expect(found).toEqual({ status: "found", value: { ok: true } })

    const malformedPath = path.join(tmp.path, "malformed.json")
    const malformed = "{not json"
    await fs.writeFile(malformedPath, malformed)
    const invalid = await readOptionalJsonState(malformedPath)
    expect(invalid.status).toBe("invalid")
    expect(await fs.readFile(malformedPath, "utf8")).toBe(malformed)
  })
})
