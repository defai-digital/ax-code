import { beforeEach, expect, test, vi } from "vitest"

const backend = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  version: vi.fn(),
}))
vi.mock("../src/platform/ffi.js", () => ({ dlopen: backend.open }))
import { verifyNativeAbi } from "../src/platform/native-abi.js"

beforeEach(() => {
  vi.resetAllMocks()
  backend.open.mockReturnValue({
    symbols: { axTuiAbiVersion: backend.version },
    close: backend.close,
  })
})

test("matching AX TUI native ABI closes the probe", () => {
  backend.version.mockReturnValue(3)
  expect(() => verifyNativeAbi("native-library")).not.toThrow()
  expect(backend.close).toHaveBeenCalledOnce()
})

test("an incompatible AX TUI library is rejected before binding renderer functions", () => {
  backend.version.mockReturnValue(1)
  expect(() => verifyNativeAbi("native-library")).toThrow("expected 3, received 1")
  expect(backend.close).toHaveBeenCalledOnce()
})

test("a library without the AX ABI reports the original load error", () => {
  const cause = new Error("missing axTuiAbiVersion")
  backend.open.mockImplementation(() => {
    throw cause
  })
  expect(() => verifyNativeAbi("native-library")).toThrow(expect.objectContaining({ cause }))
  expect(backend.close).not.toHaveBeenCalled()
})
