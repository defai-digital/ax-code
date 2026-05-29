export type DesktopSecurityBaseline = {
  contentOrigin: "custom-protocol" | "loopback"
  contextIsolation: boolean
  nodeIntegration: boolean
  sandbox: boolean
  webSecurity: boolean
  allowRunningInsecureContent: boolean
  csp: string
  navigationAllowlist: readonly string[]
  exposesRawElectron: boolean
  exposesRawIpcRenderer: boolean
  exposesFileSystem: boolean
  exposesShell: boolean
  exposesProcess: boolean
}

export const desktopSecurityBaseline = {
  contentOrigin: "custom-protocol",
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  csp: [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      "http://127.0.0.1:*",
      "http://localhost:*",
      "http://[::1]:*",
      "https://127.0.0.1:*",
      "https://localhost:*",
      "https://[::1]:*",
    ].join(" "),
    [
      "frame-src",
      "http://127.0.0.1:*",
      "http://localhost:*",
      "http://[::1]:*",
      "https://127.0.0.1:*",
      "https://localhost:*",
      "https://[::1]:*",
    ].join(" "),
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  navigationAllowlist: ["app://ax-code"],
  exposesRawElectron: false,
  exposesRawIpcRenderer: false,
  exposesFileSystem: false,
  exposesShell: false,
  exposesProcess: false,
} satisfies DesktopSecurityBaseline

export function assertDesktopSecurityBaseline(config: DesktopSecurityBaseline = desktopSecurityBaseline) {
  const failures: string[] = []
  if (!config.contextIsolation) failures.push("contextIsolation must be enabled")
  if (config.nodeIntegration) failures.push("nodeIntegration must be disabled")
  if (!config.sandbox) failures.push("renderer sandbox must be enabled")
  if (!config.webSecurity) failures.push("webSecurity must be enabled")
  if (config.allowRunningInsecureContent) failures.push("allowRunningInsecureContent must be disabled")
  if (!config.csp.includes("default-src 'self'")) failures.push("CSP must include a self default-src")
  if (!config.csp.includes("object-src 'none'")) failures.push("CSP must block object-src")
  if (config.navigationAllowlist.some((value) => value === "*" || value.startsWith("file:"))) {
    failures.push("navigation allowlist must not include wildcard or file origins")
  }
  if (config.exposesRawElectron) failures.push("renderer must not receive raw Electron APIs")
  if (config.exposesRawIpcRenderer) failures.push("renderer must not receive raw ipcRenderer")
  if (config.exposesFileSystem) failures.push("renderer must not receive filesystem APIs")
  if (config.exposesShell) failures.push("renderer must not receive shell APIs")
  if (config.exposesProcess) failures.push("renderer must not receive process APIs")
  if (failures.length) throw new Error(failures.join("; "))
}

export function isNavigationAllowed(
  target: string,
  allowlist: readonly string[] = desktopSecurityBaseline.navigationAllowlist,
) {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }

  return allowlist.some((entry) => {
    let allowed: URL
    try {
      allowed = new URL(entry)
    } catch {
      return false
    }

    if (url.protocol !== allowed.protocol || url.hostname !== allowed.hostname) return false
    if (allowed.port && url.port !== allowed.port) return false
    return true
  })
}
