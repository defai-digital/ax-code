import { describe, expect, it, vi } from "vitest"

import { assertNoActiveLegacyPublicTunnels } from "./legacy-tunnel.js"

const pathImpl = { join: (...segments) => segments.join("/") }
const createFs = (files = {}, error = null) => ({
  readdirSync: vi.fn(() => {
    if (error) throw error
    return Object.keys(files)
  }),
  readFileSync: vi.fn((file) => files[file.split(/[\\/]/).at(-1)]),
  unlinkSync: vi.fn(),
})

describe("legacy public tunnel startup guard", () => {
  it("allows startup when the run directory does not exist", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" })
    expect(() =>
      assertNoActiveLegacyPublicTunnels({ dataDir: "/data", fsImpl: createFs({}, error), pathImpl }),
    ).not.toThrow()
  })

  it("removes stale tunnel state after its process exits", () => {
    const file = "ax-code-desktop-tunnel-3100.json"
    const fsImpl = createFs({ [file]: JSON.stringify({ pid: 123 }) })

    assertNoActiveLegacyPublicTunnels({
      dataDir: "/data",
      fsImpl,
      pathImpl,
      isProcessRunning: () => false,
    })

    expect(fsImpl.unlinkSync).toHaveBeenCalledWith(`/data/run/${file}`)
  })

  it("refuses startup while a legacy public tunnel is alive", () => {
    const file = "ax-code-desktop-tunnel-3100.json"
    const fsImpl = createFs({ [file]: JSON.stringify({ pid: 123 }) })

    expect(() =>
      assertNoActiveLegacyPublicTunnels({
        dataDir: "/data",
        fsImpl,
        pathImpl,
        isProcessRunning: (pid) => pid === 123,
      }),
    ).toThrow("tunnel stop")
    expect(fsImpl.unlinkSync).not.toHaveBeenCalled()
  })

  it("cleans malformed legacy state without affecting unrelated files", () => {
    const malformed = "ax-code-desktop-tunnel-3100.json"
    const fsImpl = createFs({ [malformed]: "not-json", "ax-code-desktop-3100.json": "{}" })

    assertNoActiveLegacyPublicTunnels({ dataDir: "/data", fsImpl, pathImpl })

    expect(fsImpl.unlinkSync).toHaveBeenCalledTimes(1)
    expect(fsImpl.unlinkSync).toHaveBeenCalledWith(`/data/run/${malformed}`)
  })
})
