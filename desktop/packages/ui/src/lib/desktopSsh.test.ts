import { afterEach, describe, expect, test, vi } from "vitest"
import { createDesktopSshInstance, desktopSshInstancesGet } from "./desktopSsh"

describe("desktopSsh", () => {
  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  })

  test("uses npm as the default managed install method", () => {
    const instance = createDesktopSshInstance("remote-1", "ssh example.com")

    expect(instance.remoteOpenchamber.installMethod).toBe("npm")
  })

  test("normalizes legacy bun install method to npm", async () => {
    const invoke = vi.fn().mockResolvedValue({
      instances: [
        {
          id: "remote-1",
          sshCommand: "ssh example.com",
          remoteOpenchamber: {
            mode: "managed",
            installMethod: "bun",
          },
        },
      ],
    })
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
    }

    await expect(desktopSshInstancesGet()).resolves.toEqual({
      instances: [
        expect.objectContaining({
          id: "remote-1",
          remoteOpenchamber: expect.objectContaining({
            installMethod: "npm",
          }),
        }),
      ],
    })
  })
})
