import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  detectLanIPv4Address,
  detectRoutedIPv4Address,
  isUsableLanIPv4Address,
  selectLanIPv4Address,
} = require("./desktop-lan-address.js")

const createSocketFactory = ({ address, connectError = null, throwOnConnect = false } = {}) => {
  const sockets = []
  const createSocket = () => {
    const socket = {
      closed: false,
      once: () => socket,
      connect: (_port, _host, callback) => {
        if (throwOnConnect) throw new Error("connect failed")
        callback(connectError)
      },
      address: () => ({ address }),
      close: () => {
        socket.closed = true
      },
    }
    sockets.push(socket)
    return socket
  }
  return { createSocket, sockets }
}

describe("isUsableLanIPv4Address", () => {
  test("accepts routable IPv4 addresses and rejects non-LAN placeholders", () => {
    expect(isUsableLanIPv4Address("192.168.1.20")).toBe(true)
    expect(isUsableLanIPv4Address("10.10.0.5")).toBe(true)
    expect(isUsableLanIPv4Address("0.0.0.0")).toBe(false)
    expect(isUsableLanIPv4Address("127.0.0.1")).toBe(false)
    expect(isUsableLanIPv4Address("169.254.10.20")).toBe(false)
    expect(isUsableLanIPv4Address("999.1.1.1")).toBe(false)
  })
})

describe("selectLanIPv4Address", () => {
  test("skips unusable non-internal interfaces before selecting a LAN address", () => {
    expect(
      selectLanIPv4Address({
        awdl0: [{ family: "IPv4", internal: false, address: "169.254.4.1" }],
        lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
        en0: [{ family: "IPv4", internal: false, address: "192.168.1.20" }],
      }),
    ).toBe("192.168.1.20")
  })
})

describe("detectRoutedIPv4Address", () => {
  test("returns the IPv4 address selected by UDP routing and closes the socket", async () => {
    const factory = createSocketFactory({ address: "10.0.0.42" })

    await expect(detectRoutedIPv4Address({ createSocket: factory.createSocket })).resolves.toBe("10.0.0.42")
    expect(factory.sockets[0].closed).toBe(true)
  })

  test("returns null when UDP routing fails", async () => {
    const factory = createSocketFactory({ address: "10.0.0.42", connectError: new Error("offline") })

    await expect(detectRoutedIPv4Address({ createSocket: factory.createSocket })).resolves.toBeNull()
    expect(factory.sockets[0].closed).toBe(true)
  })
})

describe("detectLanIPv4Address", () => {
  test("prefers the routed IPv4 address over fallback interface order", async () => {
    const factory = createSocketFactory({ address: "10.0.0.42" })

    await expect(
      detectLanIPv4Address({
        createSocket: factory.createSocket,
        networkInterfaces: () => ({
          en0: [{ family: "IPv4", internal: false, address: "192.168.1.20" }],
        }),
      }),
    ).resolves.toBe("10.0.0.42")
  })

  test("falls back to the first usable interface when routed detection fails", async () => {
    const factory = createSocketFactory({ throwOnConnect: true })

    await expect(
      detectLanIPv4Address({
        createSocket: factory.createSocket,
        networkInterfaces: () => ({
          awdl0: [{ family: "IPv4", internal: false, address: "169.254.4.1" }],
          en0: [{ family: "IPv4", internal: false, address: "192.168.1.20" }],
        }),
      }),
    ).resolves.toBe("192.168.1.20")
  })
})
