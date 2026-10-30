import { expect, test, vi } from "vitest"
import { TerminalPalette } from "../src/lib/terminal-palette.js"

function detector() {
  return new TerminalPalette({
    stdin: { isTTY: true, on: vi.fn(), removeListener: vi.fn() } as never,
    stdout: { isTTY: true, write: vi.fn() } as never,
  })
}

test("detect forwards an explicit timeout to the OSC support probe", async () => {
  const palette = detector()
  const probe = vi.spyOn(palette, "detectOSCSupport").mockResolvedValue(false)

  await palette.detect({ timeout: 123 })

  expect(probe).toHaveBeenCalledWith(123)
})

test("detect keeps the probe's short default when no timeout is given", async () => {
  const palette = detector()
  const probe = vi.spyOn(palette, "detectOSCSupport").mockResolvedValue(false)

  await palette.detect()

  expect(probe).toHaveBeenCalledWith(undefined)
})
