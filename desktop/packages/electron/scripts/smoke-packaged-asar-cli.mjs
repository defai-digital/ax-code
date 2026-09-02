#!/usr/bin/env node

import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const require = createRequire(import.meta.url)
const { resolvePackagedTarget, resourcesPathFor } = require("./verify-packaged-electron.cjs")
const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_LOG_BYTES = 64 * 1024

export function parseSmokeArgs(argv) {
  const builderArgs = []
  let timeoutMs = DEFAULT_TIMEOUT_MS
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== "--timeout-ms") {
      builderArgs.push(argv[index])
      continue
    }
    const value = Number(argv[++index])
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
      throw new Error("--timeout-ms must be an integer between 1000 and 300000")
    }
    timeoutMs = value
  }
  return { builderArgs, timeoutMs }
}

export function packagedPaths(target) {
  const resourcesPath = resourcesPathFor(target.appPath, target.platform)
  const archivePath = path.join(resourcesPath, "app.asar")
  return {
    archivePath,
    cliPath: path.join(archivePath, "dist", "desktop-cli.mjs"),
    executablePath:
      target.platform === "darwin" ? path.join(target.appPath, "Contents", "MacOS", "AX Code") : target.appPath,
    launcherPath: path.join(resourcesPath, "ax-code", "bin", target.platform === "win32" ? "ax-code.cmd" : "ax-code"),
    resourcesPath,
    serverPath: path.join(archivePath, "dist", "server.js"),
    webDistPath: path.join(archivePath, "web-dist"),
  }
}

export function extractAssetPath(html) {
  return html.match(/(?:src|href)=["'](\/assets\/[^"']+\.(?:css|js))["']/u)?.[1]
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error("Could not reserve a loopback port")
  return port
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", path: pathname, port }, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => {
        resolve({ body: Buffer.concat(chunks).toString("utf8"), status: response.statusCode ?? 0 })
      })
    })
    req.on("error", reject)
  })
}

function appendLog(current, chunk) {
  return `${current}${String(chunk)}`.slice(-MAX_LOG_BYTES)
}

async function stopChild(child, platform) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (platform === "win32") {
    await execFileAsync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => {})
  } else {
    child.kill("SIGTERM")
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
}

export async function runSmoke(argv = process.argv.slice(2)) {
  const { builderArgs, timeoutMs } = parseSmokeArgs(argv)
  const target = resolvePackagedTarget(builderArgs)
  const paths = packagedPaths(target)
  // Stock Node cannot stat virtual paths inside app.asar. The packaging gate
  // validates those entries; this smoke proves Electron can load them.
  for (const required of [target.appPath, paths.executablePath, paths.archivePath, paths.launcherPath]) {
    if (!fs.existsSync(required)) throw new Error(`Packaged ASAR CLI smoke is missing ${required}`)
  }

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ax-packaged-asar-cli-"))
  const env = {
    ...process.env,
    AX_CODE_BINARY: paths.launcherPath,
    AX_CODE_DESKTOP_DATA_DIR: path.join(dataRoot, "desktop"),
    AX_CODE_DESKTOP_DIST_DIR: paths.webDistPath,
    AX_CODE_DESKTOP_SERVER_PATH: paths.serverPath,
    AX_CODE_DESKTOP_UI_PASSWORD: "packaged-asar-smoke-password",
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    XDG_CACHE_HOME: path.join(dataRoot, "cache"),
    XDG_CONFIG_HOME: path.join(dataRoot, "config"),
    XDG_DATA_HOME: path.join(dataRoot, "share"),
    XDG_STATE_HOME: path.join(dataRoot, "state"),
  }

  let child
  try {
    const status = await execFileAsync(paths.executablePath, [paths.cliPath, "status", "--json", "--plain"], {
      encoding: "utf8",
      env,
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    })
    let statusResult
    try {
      statusResult = JSON.parse(status.stdout)
    } catch (error) {
      throw new Error(`Packaged CLI status was not JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (statusResult?.status !== "ok") throw new Error(`Unexpected packaged CLI status: ${status.stdout}`)

    const port = await reservePort()
    child = spawn(paths.executablePath, [paths.cliPath, "serve", "--foreground", "--port", String(port), "--plain"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let logs = ""
    let spawnError
    child.on("error", (error) => (spawnError = error))
    child.stdout.on("data", (chunk) => (logs = appendLog(logs, chunk)))
    child.stderr.on("data", (chunk) => (logs = appendLog(logs, chunk)))

    let page
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Packaged desktop CLI exited before serving ASAR assets: ${logs}`)
      }
      try {
        page = await request(port, "/")
        if (page.status === 200) break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!page || page.status !== 200) throw new Error(`Packaged ASAR static root did not become ready: ${logs}`)

    const assetPath = extractAssetPath(page.body)
    if (!assetPath) throw new Error("Packaged ASAR index does not reference a JavaScript or CSS asset")
    const asset = await request(port, assetPath)
    if (asset.status !== 200 || asset.body.length === 0) {
      throw new Error(`Packaged ASAR asset request failed (${asset.status}): ${assetPath}`)
    }

    console.log(`[smoke-packaged-asar-cli] ${target.platform}-${target.arch}: / and ${assetPath} passed`)
  } finally {
    if (child) await stopChild(child, target.platform)
    try {
      fs.rmSync(dataRoot, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 })
    } catch {}
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  runSmoke().catch((error) => {
    console.error(`[smoke-packaged-asar-cli] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
