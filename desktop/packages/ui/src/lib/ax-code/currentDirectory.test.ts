import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("./client", () => ({
  axCodeClient: {
    getDirectory: vi.fn(),
  },
}))

import { axCodeClient } from "./client"
import { getAxCodeCurrentDirectory } from "./currentDirectory"

const mockedGetDirectory = vi.mocked(axCodeClient.getDirectory)

describe("getAxCodeCurrentDirectory", () => {
  beforeEach(() => {
    mockedGetDirectory.mockReset()
  })

  test("returns the current ax-code directory", () => {
    mockedGetDirectory.mockReturnValue("/repo")

    expect(getAxCodeCurrentDirectory()).toBe("/repo")
  })

  test("treats blank directories as unavailable", () => {
    mockedGetDirectory.mockReturnValue("   ")

    expect(getAxCodeCurrentDirectory()).toBeNull()
  })
})
