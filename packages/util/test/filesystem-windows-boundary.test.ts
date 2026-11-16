import { describe, expect, test, vi } from "vitest"

vi.mock("path", async (importOriginal) => {
  const { win32 } = await importOriginal<typeof import("node:path")>()
  return { ...win32, default: win32 }
})
vi.mock("fs/promises", () => ({ access: vi.fn(async () => undefined) }))
vi.mock("../src/glob", () => ({
  Glob: { scan: vi.fn(async (_pattern: string, options: { cwd: string }) => [`${options.cwd}\\marker`]) },
}))

import { Filesystem } from "../src/filesystem"

describe("Windows upward-search boundaries", () => {
  test.each(["findUp", "up", "globUp"] as const)("%s stops at a boundary with different casing", async (method) => {
    const start = "C:\\Work\\repo\\nested"
    const stop = "c:\\work\\REPO"
    const found =
      method === "up"
        ? await Array.fromAsync(Filesystem.up({ targets: ["marker"], start, stop }))
        : await Filesystem[method]("marker", start, stop)
    expect(found).toEqual(["C:\\Work\\repo\\nested\\marker", "C:\\Work\\repo\\marker"])
  })
})
