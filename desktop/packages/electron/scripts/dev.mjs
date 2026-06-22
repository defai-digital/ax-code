#!/usr/bin/env node
import { spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Resolve the Electron the renderer should run on. Prefer the locally
// installed, pinned binary so it matches the version `rebuild:native` built
// node-pty against (avoids a native ABI mismatch and the ~290MB npx download
// of whatever "electron@latest" resolves to). Fall back to a version-pinned
// npx if the binary was not installed (e.g. its postinstall was skipped).
const resolveElectron = () => {
  try {
    const bin = require("electron")
    if (typeof bin === "string" && fs.existsSync(bin)) return { command: bin, args: [] }
  } catch {
    // electron package present but binary not installed — fall through
  }
  const version = require("electron/package.json").version
  console.warn(`[electron-dev] pinned electron binary not installed; falling back to npx electron@${version}`)
  return { command: "npx", args: [`electron@${version}`] }
}
const electronDir = path.resolve(__dirname, "..")
const webDir = path.resolve(electronDir, "..", "web")
const root = path.resolve(electronDir, "..", "..")

const rendererPort = Number.parseInt(process.env.AX_CODE_DESKTOP_RENDERER_PORT || "5173", 10)
const rendererUrl = `http://127.0.0.1:${rendererPort}`

const findFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate a local server port"))
          return
        }
        resolve(address.port)
      })
    })
  })

const waitForUrl = async (url, timeoutMs = 30000) => {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" })
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "not ready"}`)
}

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: options.env || process.env,
      stdio: options.stdio || "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`))
    })
  })

const spawnManaged = (children, command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
  })
  children.add(child)
  child.on("exit", () => children.delete(child))
  return child
}

const stopAll = (children) => {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM")
  }
}

await run("node", [path.join(electronDir, "scripts", "bundle-main.mjs")], { cwd: electronDir })

const serverPort = Number.parseInt(process.env.AX_CODE_DESKTOP_ELECTRON_SERVER_PORT || "", 10) || (await findFreePort())
const children = new Set()

const shutdown = () => {
  stopAll(children)
}
process.once("SIGINT", () => {
  shutdown()
  process.exit(130)
})
process.once("SIGTERM", () => {
  shutdown()
  process.exit(143)
})
process.once("exit", shutdown)

const sharedEnv = {
  ...process.env,
  AX_CODE_DESKTOP_PORT: String(serverPort),
  AX_CODE_DESKTOP_RENDERER_PORT: String(rendererPort),
}

const vite = spawnManaged(children, "pnpm", ["run", "dev:vite"], {
  cwd: webDir,
  env: sharedEnv,
})

vite.once("exit", (code, signal) => {
  if (code !== 0) {
    console.error(`[electron-dev] Vite exited with ${signal || code}`)
    stopAll(children)
    process.exit(typeof code === "number" ? code : 1)
  }
})

await waitForUrl(rendererUrl)

const { command: electronCommand, args: electronArgs } = resolveElectron()
const electron = spawnManaged(children, electronCommand, [...electronArgs, path.join(electronDir, "dist", "main.js")], {
  cwd: root,
  env: {
    ...sharedEnv,
    AX_CODE_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl,
    AX_CODE_DESKTOP_ELECTRON_SERVER_PORT: String(serverPort),
  },
})

electron.on("exit", (code, signal) => {
  stopAll(children)
  process.exit(typeof code === "number" ? code : signal ? 1 : 0)
})
