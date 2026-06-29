import { describe, expect, test } from "vitest"
import { ElectronSshManager } from "./ssh-manager.mjs"

const createMemorySettingsMutator = (initialRoot = {}) => {
  const root = structuredClone(initialRoot)
  const mutateSettings = async (mutator) => {
    const result = await mutator(root)
    if (result && result !== root) {
      for (const key of Object.keys(root)) delete root[key]
      Object.assign(root, result)
    }
  }
  return { root, mutateSettings }
}

const createManager = (options = {}) =>
  new ElectronSshManager({
    settingsFilePath: "/tmp/ax-code-desktop-test-settings.json",
    appVersion: "0.0.0",
    emit: () => {},
    mutateSettings: options.mutateSettings ?? (async () => {}),
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

  test("updates SSH instances through the shared settings mutator", async () => {
    const settings = createMemorySettingsMutator({
      desktopHosts: [
        { id: "local", label: "Local", url: "http://127.0.0.1/" },
        { id: "old-remote", label: "Old", url: "http://127.0.0.1:4200" },
      ],
      desktopDefaultHostId: "old-remote",
      desktopSshInstances: [{ id: "old-remote", sshCommand: "ssh old.example.com" }],
      desktopWindowState: { width: 1200, height: 800 },
    })
    const manager = createManager(settings)

    await manager.setInstances({
      instances: [
        {
          id: "new-remote",
          nickname: "Production",
          sshCommand: "ssh prod.example.com",
        },
      ],
    })

    expect(settings.root.desktopSshInstances).toHaveLength(1)
    expect(settings.root.desktopSshInstances[0]).toMatchObject({
      id: "new-remote",
      nickname: "Production",
      sshParsed: { destination: "prod.example.com" },
    })
    expect(settings.root.desktopHosts).toEqual([
      { id: "new-remote", label: "Production", url: "http://127.0.0.1/" },
    ])
    expect(settings.root.desktopDefaultHostId).toBe("local")
    expect(settings.root.desktopWindowState).toEqual({ width: 1200, height: 800 })
  })

  test("persists remote host URLs and local ports without dropping unrelated settings", async () => {
    const settings = createMemorySettingsMutator({
      desktopHosts: [],
      desktopSshInstances: [
        {
          id: "remote-1",
          sshCommand: "ssh example.com",
          localForward: { bindHost: "127.0.0.1" },
        },
      ],
      desktopVibrancy: true,
    })
    const manager = createManager(settings)

    await manager.updateHostUrl("remote-1", "Remote One", "http://127.0.0.1:4455")
    await manager.persistLocalPort("remote-1", 4455)

    expect(settings.root.desktopHosts).toEqual([
      { id: "remote-1", label: "Remote One", url: "http://127.0.0.1:4455" },
    ])
    expect(settings.root.desktopSshInstances[0].localForward).toMatchObject({
      bindHost: "127.0.0.1",
      preferredLocalPort: 4455,
    })
    expect(settings.root.desktopVibrancy).toBe(true)
  })
})
