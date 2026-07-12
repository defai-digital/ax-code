import { describe, expect, it, vi } from "vitest"

import { resolveAxCodeEnvConfig } from "./env-config.js"

describe("resolveAxCodeEnvConfig", () => {
  it("trims AX_CODE_HOST before parsing origin and port", () => {
    const logger = { warn: vi.fn() }

    expect(
      resolveAxCodeEnvConfig({
        env: { AX_CODE_HOST: " http://127.0.0.1:4096 " },
        logger,
      }),
    ).toMatchObject({
      configuredAxCodeHost: {
        origin: "http://127.0.0.1:4096",
        port: 4096,
      },
      effectivePort: 4096,
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("falls back to localhost when hostname is empty after trimming", () => {
    const logger = { warn: vi.fn() }

    expect(
      resolveAxCodeEnvConfig({
        env: { AX_CODE_HOSTNAME: "   " },
        logger,
      }).configuredAxCodeHostname,
    ).toBe("127.0.0.1")
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("empty after trimming"))
  })

  it("ignores remote server URLs and non-loopback managed hostnames", () => {
    const logger = { warn: vi.fn() }

    expect(
      resolveAxCodeEnvConfig({
        env: { AX_CODE_HOST: "https://remote.example:4096", AX_CODE_HOSTNAME: "0.0.0.0" },
        logger,
      }),
    ).toMatchObject({
      configuredAxCodeHost: null,
      effectivePort: null,
      configuredAxCodeHostname: "127.0.0.1",
    })
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it("normalizes bracketed IPv6 loopback before socket operations", () => {
    const logger = { warn: vi.fn() }

    expect(
      resolveAxCodeEnvConfig({
        env: { AX_CODE_HOSTNAME: " [::1] " },
        logger,
      }).configuredAxCodeHostname,
    ).toBe("::1")
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
