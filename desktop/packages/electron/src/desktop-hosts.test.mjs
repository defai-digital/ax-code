import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { applyDesktopHostsConfigToRoot, readDesktopHostsConfigFromRoot } = require("./desktop-hosts.js")

describe("desktop hosts config", () => {
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
})
