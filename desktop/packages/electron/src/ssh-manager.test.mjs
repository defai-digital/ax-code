import { describe, expect, test } from "vitest"
import { ElectronSshManager } from "./ssh-manager.mjs"

const createManager = () =>
  new ElectronSshManager({
    settingsFilePath: "/tmp/ax-code-desktop-test-settings.json",
    appVersion: "0.0.0",
    emit: () => {},
  })

describe("ElectronSshManager", () => {
  test("preserves IPv4 loopback bind aliases for extra local forwards", () => {
    const manager = createManager()

    expect(
      manager.sanitizeForward({
        id: "preview",
        type: "local",
        localHost: "127.0.0.2",
        localPort: 5173,
        remoteHost: "127.0.0.1",
        remotePort: 5173,
      }),
    ).toMatchObject({
      localHost: "127.0.0.2",
    })
    expect(
      manager.sanitizeForward({
        id: "service",
        type: "local",
        localHost: "127.10.20.30",
        localPort: 8080,
        remoteHost: "127.0.0.1",
        remotePort: 8080,
      }),
    ).toMatchObject({
      localHost: "127.10.20.30",
    })
  })

  test("falls back to a local-only bind host for invalid or non-loopback hosts", () => {
    const manager = createManager()

    expect(
      manager.sanitizeForward({
        id: "invalid",
        type: "local",
        localHost: "127.0.0.999",
        localPort: 5173,
        remoteHost: "127.0.0.1",
        remotePort: 5173,
      }),
    ).toMatchObject({
      localHost: "127.0.0.1",
    })
    expect(
      manager.sanitizeForward({
        id: "remote-host",
        type: "local",
        localHost: "192.168.1.10",
        localPort: 8080,
        remoteHost: "127.0.0.1",
        remotePort: 8080,
      }),
    ).toMatchObject({
      localHost: "127.0.0.1",
    })
  })

  test("drops extra forwards with invalid port numbers before ssh receives them", () => {
    const manager = createManager()

    expect(
      manager.sanitizeForward({
        id: "negative",
        type: "local",
        localHost: "127.0.0.1",
        localPort: -1,
        remoteHost: "127.0.0.1",
        remotePort: 8080,
      }),
    ).toBeNull()
    expect(
      manager.sanitizeForward({
        id: "too-high",
        type: "remote",
        localHost: "127.0.0.1",
        localPort: 8080,
        remoteHost: "127.0.0.1",
        remotePort: 70000,
      }),
    ).toBeNull()
    expect(
      manager.sanitizeForward({
        id: "fractional",
        type: "dynamic",
        localHost: "127.0.0.1",
        localPort: 1080.5,
      }),
    ).toBeNull()
  })

  test("omits invalid preferred tunnel ports from sanitized instances", () => {
    const manager = createManager()

    const instance = manager.sanitizeInstance({
      id: "remote-1",
      sshCommand: "ssh example.com",
      remoteOpenchamber: {
        preferredPort: 70000,
      },
      localForward: {
        preferredLocalPort: -1,
      },
    })

    expect(instance.remoteOpenchamber).not.toHaveProperty("preferredPort")
    expect(instance.localForward).not.toHaveProperty("preferredLocalPort")
  })
})
