const requireFunction = (value, name) => {
  if (typeof value !== "function") {
    throw new TypeError(`managedAxCodeRuntime requires ${name}`)
  }
  return value
}

export const createManagedAxCodeRuntimeAdapter = (implementation) => {
  const launchServerProcess = requireFunction(implementation.launchServerProcess, "launchServerProcess")
  const probeProcessHealth = requireFunction(implementation.probeProcessHealth, "probeProcessHealth")
  const probeExternalServer = requireFunction(implementation.probeExternalServer, "probeExternalServer")
  const killPort = requireFunction(implementation.killPort, "killPort")
  const waitForPortRelease = requireFunction(implementation.waitForPortRelease, "waitForPortRelease")
  const isProcessAlive = requireFunction(implementation.isProcessAlive, "isProcessAlive")

  return {
    launchServerProcess: (options) => launchServerProcess(options),
    probeProcessHealth: () => probeProcessHealth(),
    probeExternalServer: (port, origin) => probeExternalServer(port, origin),
    releasePort: async (port, timeoutMs) => {
      killPort(port)
      return waitForPortRelease(port, timeoutMs)
    },
    isProcessAlive: () => isProcessAlive(),
  }
}
