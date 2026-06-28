import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  applyDesktopHostsConfigToRoot,
  normalizeHostUrl,
  readDesktopHostsConfigFromRoot,
} = require("./desktop-hosts.js")

describe("desktop hosts config", () => {
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
})
