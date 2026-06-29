"use strict"

const dgram = require("dgram")
const os = require("os")

function isUsableLanIPv4Address(address) {
  if (typeof address !== "string") return false
  const parts = address.split(".")
  if (parts.length !== 4) return false
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN
    return Number(part)
  })
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false

  if (address === "0.0.0.0" || address === "255.255.255.255") return false
  if (address.startsWith("127.")) return false
  if (address.startsWith("169.254.")) return false
  return true
}

function selectLanIPv4Address(networkInterfaces) {
  for (const entries of Object.values(networkInterfaces || {})) {
    for (const entry of entries || []) {
      if (entry?.family === "IPv4" && !entry.internal && isUsableLanIPv4Address(entry.address)) {
        return entry.address
      }
    }
  }
  return null
}

function detectRoutedIPv4Address({
  createSocket = dgram.createSocket,
  connectHost = "8.8.8.8",
  connectPort = 80,
} = {}) {
  return new Promise((resolve) => {
    const socket = createSocket("udp4")
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        /* ignore */
      }
      resolve(isUsableLanIPv4Address(value) ? value : null)
    }

    if (typeof socket.once === "function") {
      socket.once("error", () => finish(null))
    }

    try {
      socket.connect(connectPort, connectHost, (error) => {
        if (error) {
          finish(null)
          return
        }
        try {
          const addr = typeof socket.address === "function" ? socket.address() : null
          finish(addr && typeof addr.address === "string" ? addr.address : null)
        } catch {
          finish(null)
        }
      })
    } catch {
      finish(null)
    }
  })
}

async function detectLanIPv4Address({
  createSocket = dgram.createSocket,
  networkInterfaces = os.networkInterfaces,
  connectHost = "8.8.8.8",
  connectPort = 80,
} = {}) {
  const routed = await detectRoutedIPv4Address({ createSocket, connectHost, connectPort })
  if (routed) return routed
  return selectLanIPv4Address(networkInterfaces())
}

module.exports = {
  detectLanIPv4Address,
  detectRoutedIPv4Address,
  isUsableLanIPv4Address,
  selectLanIPv4Address,
}
