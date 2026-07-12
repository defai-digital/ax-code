import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  applyDesktopHostsConfigToRoot,
  isAllowedDesktopHostTargetUrl,
  isLocalOnlyDesktopHostsConfigInput,
  isLocalDesktopSenderUrl,
  normalizeHostUrl,
  readDesktopHostsConfigFromRoot,
  removeDisabledRemoteAccessSettingsFromRoot,
  resolveStoredClientTokenForUrl,
} = require("./desktop-hosts.js")

describe("desktop hosts config", () => {
  test("accepts local-only compatibility writes and rejects remote host data", () => {
    expect(isLocalOnlyDesktopHostsConfigInput({ hosts: [], defaultHostId: "local" })).toBe(true)
    expect(isLocalOnlyDesktopHostsConfigInput({ hosts: [], defaultHostId: null })).toBe(true)
    expect(
      isLocalOnlyDesktopHostsConfigInput({
        hosts: [{ id: "remote-a", url: "https://remote.example.com" }],
        defaultHostId: "remote-a",
      }),
    ).toBe(false)
    expect(isLocalOnlyDesktopHostsConfigInput({ hosts: "invalid", defaultHostId: "local" })).toBe(false)
  })

  test("purges persisted remote endpoints and credentials without touching local preferences", () => {
    const root = {
      themeId: "ax-dark",
      desktopHosts: [{ id: "remote-a", clientToken: "secret-token" }],
      desktopDefaultHostId: "remote-a",
      desktopInitialHostChoiceCompleted: true,
      desktopLocalClientToken: "local-secret",
      desktopSshInstances: [{ id: "ssh-a", auth: { sshPassword: { value: "secret" } } }],
      desktopLanAccessEnabled: true,
      desktopUiPassword: "old-password",
      publicOrigin: "https://remote.example.com",
    }

    expect(removeDisabledRemoteAccessSettingsFromRoot(root)).toBe(true)
    expect(root).toEqual({ themeId: "ax-dark" })
    expect(removeDisabledRemoteAccessSettingsFromRoot(root)).toBe(false)
  })

  test("strips URL-carried credentials before storing or exposing hosts", () => {
    expect(normalizeHostUrl(" https://user:pass@remote.example.com/app?token=secret#frag ")).toBe(
      "https://remote.example.com/app",
    )

    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          url: "https://user:pass@remote.example.com/app?token=secret#frag",
          apiUrl: "https://api-user:api-pass@api.remote.example.com/v1?token=api-secret#frag",
        },
      ],
    }

    expect(readDesktopHostsConfigFromRoot(root)).toEqual({
      hosts: [
        {
          id: "remote-a",
          label: "https://remote.example.com/app",
          url: "https://remote.example.com/app",
          apiUrl: "https://api.remote.example.com/v1",
        },
      ],
      defaultHostId: null,
      initialHostChoiceCompleted: false,
    })
  })

  test("omits client tokens from public host config", () => {
    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          apiUrl: "https://api.remote.example.com/",
          clientToken: "secret-token",
        },
      ],
      desktopDefaultHostId: "remote-a",
      desktopInitialHostChoiceCompleted: true,
    }

    expect(readDesktopHostsConfigFromRoot(root)).toEqual({
      hosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          apiUrl: "https://api.remote.example.com/",
        },
      ],
      defaultHostId: "remote-a",
      initialHostChoiceCompleted: true,
    })
  })

  test("can include client tokens for internal main-process lookups", () => {
    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          clientToken: "secret-token",
        },
      ],
    }

    expect(readDesktopHostsConfigFromRoot(root, { includeSecrets: true }).hosts[0]).toMatchObject({
      id: "remote-a",
      clientToken: "secret-token",
    })
  })

  test("resolves stored client tokens for saved host and API URLs", () => {
    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/app?token=leaked",
          apiUrl: "https://api.remote.example.com/v1",
          clientToken: "secret-token",
        },
      ],
    }
    const config = readDesktopHostsConfigFromRoot(root, { includeSecrets: true })

    expect(resolveStoredClientTokenForUrl("https://remote.example.com/app", config)).toBe("secret-token")
    expect(resolveStoredClientTokenForUrl("https://remote.example.com/app/", config)).toBe("secret-token")
    expect(resolveStoredClientTokenForUrl("https://remote.example.com/app/session/abc", config)).toBe("secret-token")
    expect(resolveStoredClientTokenForUrl("https://api.remote.example.com/v1", config)).toBe("secret-token")
    expect(resolveStoredClientTokenForUrl("https://api.remote.example.com/v1/status", config)).toBe("secret-token")
    expect(resolveStoredClientTokenForUrl("https://remote.example.com/other", config)).toBe("")
    expect(resolveStoredClientTokenForUrl("https://remote.example.com/app2", config)).toBe("")
  })

  test("preserves existing private host metadata when renderer roundtrips public hosts", () => {
    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          apiUrl: "https://api.remote.example.com/",
          clientToken: "secret-token",
        },
      ],
      desktopDefaultHostId: "remote-a",
    }

    applyDesktopHostsConfigToRoot(root, {
      hosts: [
        {
          id: "remote-a",
          label: "Renamed Remote",
          url: "https://remote.example.com/",
        },
      ],
      defaultHostId: "local",
      initialHostChoiceCompleted: true,
    })

    expect(root.desktopHosts).toEqual([
      {
        id: "remote-a",
        label: "Renamed Remote",
        url: "https://remote.example.com/",
        apiUrl: "https://api.remote.example.com/",
        clientToken: "secret-token",
      },
    ])
    expect(root.desktopDefaultHostId).toBe("local")
    expect(root.desktopInitialHostChoiceCompleted).toBe(true)
  })

  test("clears a client token only when an explicit empty token is provided", () => {
    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          clientToken: "secret-token",
        },
      ],
    }

    applyDesktopHostsConfigToRoot(root, {
      hosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          clientToken: "",
        },
      ],
      defaultHostId: "remote-a",
    })

    expect(root.desktopHosts[0]).not.toHaveProperty("clientToken")
  })

  test("does not carry a private token across a host endpoint change", () => {
    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          apiUrl: "https://api.remote.example.com/",
          clientToken: "secret-token",
        },
      ],
    }

    applyDesktopHostsConfigToRoot(root, {
      hosts: [
        {
          id: "remote-a",
          label: "Remote B",
          url: "https://other.example.com/",
        },
      ],
    })

    expect(root.desktopHosts).toEqual([
      {
        id: "remote-a",
        label: "Remote B",
        url: "https://other.example.com/",
        apiUrl: "https://other.example.com/",
      },
    ])
  })

  test("does not carry a private token across an api endpoint change", () => {
    const root = {
      desktopHosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          apiUrl: "https://api.remote.example.com/",
          clientToken: "secret-token",
        },
      ],
    }

    applyDesktopHostsConfigToRoot(root, {
      hosts: [
        {
          id: "remote-a",
          label: "Remote A",
          url: "https://remote.example.com/",
          apiUrl: "https://api2.remote.example.com/",
        },
      ],
    })

    expect(root.desktopHosts).toEqual([
      {
        id: "remote-a",
        label: "Remote A",
        url: "https://remote.example.com/",
        apiUrl: "https://api2.remote.example.com/",
      },
    ])
  })

  test("allows local and configured host navigation targets only", () => {
    const hosts = [
      { id: "remote-a", label: "Remote A", url: "https://remote.example.com/app" },
      { id: "remote-b", label: "Remote B", url: "https://root.example.com/" },
    ]

    expect(
      isAllowedDesktopHostTargetUrl("http://localhost:3910/session/abc", {
        localOrigin: "http://localhost:3910",
        hosts,
      }),
    ).toBe(true)
    expect(
      isAllowedDesktopHostTargetUrl("https://remote.example.com/app/session/abc", {
        localOrigin: "http://localhost:3910",
        hosts,
      }),
    ).toBe(true)
    expect(
      isAllowedDesktopHostTargetUrl("https://root.example.com/anything", {
        localOrigin: "http://localhost:3910",
        hosts,
      }),
    ).toBe(true)
    expect(
      isAllowedDesktopHostTargetUrl("https://remote.example.com/app2", {
        localOrigin: "http://localhost:3910",
        hosts,
      }),
    ).toBe(false)
    expect(
      isAllowedDesktopHostTargetUrl("https://attacker.example.com/app", {
        localOrigin: "http://localhost:3910",
        hosts,
      }),
    ).toBe(false)
  })

  test("allows configured API URL probe targets only when explicitly requested", () => {
    const hosts = [
      {
        id: "remote-a",
        label: "Remote A",
        url: "https://remote.example.com/app",
        apiUrl: "https://api.remote.example.com/v1",
      },
    ]

    expect(
      isAllowedDesktopHostTargetUrl("https://api.remote.example.com/v1/status", {
        localOrigin: "http://localhost:3910",
        hosts,
      }),
    ).toBe(false)
    expect(
      isAllowedDesktopHostTargetUrl("https://api.remote.example.com/v1/status", {
        localOrigin: "http://localhost:3910",
        hosts,
        includeApiUrls: true,
      }),
    ).toBe(true)
    expect(
      isAllowedDesktopHostTargetUrl("https://api.remote.example.com/v2/status", {
        localOrigin: "http://localhost:3910",
        hosts,
        includeApiUrls: true,
      }),
    ).toBe(false)
  })

  test("treats IPv6 loopback renderer URLs on the desktop server port as local senders", () => {
    expect(isLocalDesktopSenderUrl("http://[::1]:3910/settings", { serverPort: 3910 })).toBe(true)
    expect(isLocalDesktopSenderUrl("http://127.5.5.5:3910/settings", { serverPort: 3910 })).toBe(true)
    expect(isLocalDesktopSenderUrl("http://0.0.0.0:3910/settings", { serverPort: 3910 })).toBe(false)
    expect(isLocalDesktopSenderUrl("http://[::]:3910/settings", { serverPort: 3910 })).toBe(false)
    expect(isLocalDesktopSenderUrl("http://[::1]:3911/settings", { serverPort: 3910 })).toBe(false)
    expect(isLocalDesktopSenderUrl("https://remote.example.com/settings", { serverPort: 3910 })).toBe(false)
  })
})
