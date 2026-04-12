import { describe, expect, test } from "bun:test"
import {
  AX_CODE_DIRECTORY_HEADER,
  LEGACY_OPENCODE_DIRECTORY_HEADER,
  applyTuiDirectoryHeaders,
  encodeTuiDirectory,
  readTuiRouteEnv,
} from "../../../src/cli/cmd/tui/transport"

describe("tui transport", () => {
  test("adds current and legacy directory headers", () => {
    const headers: Record<string, string> = { accept: "application/json" }

    applyTuiDirectoryHeaders(headers, "/tmp/project")

    expect(headers).toEqual({
      accept: "application/json",
      [AX_CODE_DIRECTORY_HEADER]: "/tmp/project",
      [LEGACY_OPENCODE_DIRECTORY_HEADER]: "/tmp/project",
    })
  })

  test("encodes non-ascii directory headers", () => {
    expect(encodeTuiDirectory("/tmp/專案")).toBe("%2Ftmp%2F%E5%B0%88%E6%A1%88")
  })

  test("does not mutate headers when directory is missing", () => {
    const headers: Record<string, string> = { accept: "application/json" }

    applyTuiDirectoryHeaders(headers)

    expect(headers).toEqual({ accept: "application/json" })
  })

  test("prefers the AX Code route env over the legacy OpenCode route env", () => {
    expect(
      readTuiRouteEnv({
        AX_CODE_ROUTE: '{"type":"home"}',
        OPENCODE_ROUTE: '{"type":"session","sessionID":"legacy"}',
      }),
    ).toBe('{"type":"home"}')
  })

  test("falls back to the legacy OpenCode route env", () => {
    expect(readTuiRouteEnv({ OPENCODE_ROUTE: '{"type":"session","sessionID":"legacy"}' })).toBe(
      '{"type":"session","sessionID":"legacy"}',
    )
  })
})
