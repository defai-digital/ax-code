#!/usr/bin/env node

import fs from "fs"
import net from "net"
import os from "os"
import path from "path"
import { spawn, spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { isModuleCliExecution } from "./cli-entry.js"
import {
  intro as clackIntro,
  outro as clackOutro,
  log as clackLog,
  cancel as clackCancel,
  isJsonMode,
  isQuietMode,
  shouldRenderHumanOutput,
  createSpinner,
  printJson,
  logStatus,
} from "./cli-output.js"
import {
  TUNNEL_MODE_QUICK,
  TUNNEL_PROVIDER_CLOUDFLARE,
  createTunnelManager,
  normalizeTunnelMode,
  normalizeTunnelProvider,
} from "./tunnel-manager.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_PORT = 3100
const FALLBACK_PORT_SCAN_LIMIT = 100
const DEFAULT_TAIL_LINES = 200
const DAEMON_READY_TIMEOUT_MS = 30000
const LOG_ROTATE_MAX_BYTES = 10 * 1024 * 1024
const LOG_ROTATE_KEEP = 5
const STARTUP_SERVICE_ID = "ai.ax-code.app.web"
const SYSTEMD_SERVICE_NAME = "ax-code-desktop.service"
const API_BASE_PATH = "/api"
const API_HEALTH_PATH = "/health"
const AUTH_SESSION_PATH = "/auth/session"
const API_SYSTEM_INFO_PATH = `${API_BASE_PATH}/system/info`
const API_SYSTEM_SHUTDOWN_PATH = `${API_BASE_PATH}/system/shutdown`
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))

let onCancelCleanup = null
let activeCommandOptions = null
let foregroundServerActive = false
let foregroundShutdown = null

function setCancelCleanup(handler) {
  onCancelCleanup = typeof handler === "function" ? handler : null
}

const HAS_PLAIN_FLAG = process.argv.includes("--plain")
const STYLE_ENABLED = process.stdout.isTTY && process.env.NO_COLOR !== "1" && !HAS_PLAIN_FLAG
const ANSI = {
  bold: "\x1b[1m",
  unbold: "\x1b[22m",
}

// Browser-unsafe ports (Fetch/Chromium restricted ports).
const UNSAFE_BROWSER_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
])

const EXIT_CODE = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  MISSING_DEPENDENCY: 3,
  AUTH_CONFIG_ERROR: 4,
  NETWORK_RUNTIME_ERROR: 5,
}

class CliError extends Error {
  constructor(message, exitCode = EXIT_CODE.GENERAL_ERROR) {
    super(message)
    this.name = "CliError"
    this.exitCode = exitCode
  }
}

function boldText(text) {
  if (!STYLE_ENABLED) return text
  return `${ANSI.bold}${text}${ANSI.unbold}`
}

function isUnsafeBrowserPort(port) {
  return Number.isFinite(port) && UNSAFE_BROWSER_PORTS.has(Math.trunc(port))
}

function resolveApiHost() {
  const configured = typeof process.env.AX_CODE_DESKTOP_HOST === "string" ? process.env.AX_CODE_DESKTOP_HOST.trim() : ""

  if (!configured) {
    return "127.0.0.1"
  }

  // Wildcard bind hosts are not valid destination hosts.
  if (configured === "0.0.0.0") {
    return "127.0.0.1"
  }
  if (configured === "::" || configured === "[::]") {
    return "::1"
  }

  // Strip brackets if user provided [::1]
  if (configured.startsWith("[") && configured.endsWith("]")) {
    return configured.slice(1, -1)
  }

  return configured
}

function formatHostForUrl(host) {
  if (typeof host !== "string") return "127.0.0.1"
  // Bracket IPv6 for URL usage.
  return host.includes(":") ? `[${host}]` : host
}

function buildLocalUrl(port, endpoint = "") {
  const host = formatHostForUrl(resolveApiHost())
  const pathPart = endpoint.startsWith("/") ? endpoint : `/${endpoint}`
  return `http://${host}:${port}${pathPart}`
}

function buildTunnelOriginUrl(port) {
  return `http://127.0.0.1:${port}`
}

function formatUnsafePortWarning(port) {
  return `Port ${port} is browser-unsafe (ERR_UNSAFE_PORT) and is not supported for AX Code Desktop UI at ${buildLocalUrl(port, "/")}.`
}

function assertSafeBrowserPort(port, { context = "This action" } = {}) {
  if (!isUnsafeBrowserPort(port)) {
    return
  }
  throw new CliError(
    `${context} cannot use port ${port}. ${formatUnsafePortWarning(port)} Use a safe port such as 3100, 5173, 8080, or a high ephemeral port.`,
    EXIT_CODE.USAGE_ERROR,
  )
}

function levenshteinDistance(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function findClosestMatch(input, candidates, maxDistance = 3) {
  if (typeof input !== "string" || input.length === 0 || !Array.isArray(candidates)) {
    return null
  }
  const normalized = input.toLowerCase()
  let bestCandidate = null
  let bestDistance = maxDistance + 1
  for (const candidate of candidates) {
    const distance = levenshteinDistance(normalized, candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      bestCandidate = candidate
    }
  }
  return bestDistance <= maxDistance ? bestCandidate : null
}

function hasUiPasswordConfigured(password) {
  return typeof password === "string" && password.trim().length > 0
}

function splitOptionToken(arg) {
  if (!arg.startsWith("-")) return null
  if (arg.startsWith("--")) {
    const eqIndex = arg.indexOf("=")
    return {
      name: eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2),
      inlineValue: eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined,
      long: true,
    }
  }
  return {
    name: arg.slice(1),
    inlineValue: undefined,
    long: false,
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? [...argv] : []
  const options = {
    port: DEFAULT_PORT,
    host: undefined,
    uiPassword: process.env.AX_CODE_DESKTOP_UI_PASSWORD || undefined,
    json: false,
    all: false,
    follow: true,
    lines: DEFAULT_TAIL_LINES,
    provider: undefined,
    mode: undefined,
    profile: undefined,
    name: undefined,
    configPath: undefined,
    token: undefined,
    tokenFile: undefined,
    tokenStdin: false,
    hostname: undefined,
    connectTtl: undefined,
    sessionTtl: undefined,
    force: false,
    showSecrets: false,
    dryRun: false,
    plain: false,
    quiet: false,
    explicitPort: false,
    explicitUiPassword: false,
    envSnapshot: true,
    foreground: false,
  }

  const removedFlagErrors = []
  const positional = []
  let helpRequested = false
  let versionRequested = false

  const consumeValue = (index, inlineValue) => {
    if (typeof inlineValue === "string" && inlineValue.length > 0) {
      return { value: inlineValue, nextIndex: index }
    }
    const candidate = args[index + 1]
    if (typeof candidate === "string" && !candidate.startsWith("-")) {
      return { value: candidate, nextIndex: index + 1 }
    }
    return { value: undefined, nextIndex: index }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const parsedToken = splitOptionToken(arg)
    if (!parsedToken) {
      positional.push(arg)
      continue
    }

    const { name, inlineValue, long } = parsedToken
    switch (name) {
      case "port":
      case "p": {
        const { value: consumedValue, nextIndex: consumedIndex } = consumeValue(i, inlineValue)
        let value = consumedValue
        let nextIndex = consumedIndex

        // Support explicit negative numeric values like `-p -1` so we can report
        // a clear range validation error instead of "Unknown option".
        if (value === undefined && typeof inlineValue !== "string") {
          const candidate = args[i + 1]
          if (typeof candidate === "string" && /^-\d+$/.test(candidate)) {
            value = candidate
            nextIndex = i + 1
          }
        }

        i = nextIndex

        if (typeof value !== "string" || value.trim().length === 0) {
          throw new CliError("Missing value for --port.", EXIT_CODE.USAGE_ERROR)
        }

        if (!/^-?\d+$/.test(value.trim())) {
          throw new CliError(`Invalid port value: ${value}`, EXIT_CODE.USAGE_ERROR)
        }

        const parsed = parseInt(value, 10)
        if (parsed < 1 || parsed > 65535) {
          throw new CliError(`Invalid port value: ${parsed}`, EXIT_CODE.USAGE_ERROR)
        }

        options.port = parsed
        options.explicitPort = true
        break
      }
      case "host": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        if (typeof value !== "string" || value.trim().length === 0) {
          throw new CliError("Missing value for --host.", EXIT_CODE.USAGE_ERROR)
        }
        options.host = value.trim()
        break
      }
      case "ui-password": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.uiPassword = typeof value === "string" ? value : ""
        options.explicitUiPassword = true
        break
      }
      case "provider": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.provider = typeof value === "string" ? value : options.provider
        break
      }
      case "mode": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.mode = typeof value === "string" ? value : options.mode
        break
      }
      case "profile": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.profile = typeof value === "string" ? value : options.profile
        break
      }
      case "name": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.name = typeof value === "string" ? value : options.name
        break
      }
      case "config": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.configPath = typeof value === "string" ? value : null
        break
      }
      case "token": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.token = typeof value === "string" ? value : options.token
        break
      }
      case "token-file": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.tokenFile = typeof value === "string" ? value : options.tokenFile
        break
      }
      case "token-stdin":
        options.tokenStdin = true
        break
      case "hostname": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.hostname = typeof value === "string" ? value : options.hostname
        break
      }
      case "connect-ttl": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.connectTtl = typeof value === "string" ? value : options.connectTtl
        break
      }
      case "session-ttl": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        options.sessionTtl = typeof value === "string" ? value : options.sessionTtl
        break
      }
      case "json":
        options.json = true
        break
      case "all":
        options.all = true
        break
      case "no-follow":
        options.follow = false
        break
      case "no-env-snapshot":
        options.envSnapshot = false
        break
      case "lines": {
        const { value, nextIndex } = consumeValue(i, inlineValue)
        i = nextIndex
        const parsed = parseInt(value ?? "", 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          options.lines = parsed
        }
        break
      }
      case "force":
        options.force = true
        break
      case "show-secrets":
        options.showSecrets = true
        break
      case "dry-run":
        options.dryRun = true
        break
      case "plain":
        options.plain = true
        break
      case "quiet":
      case "q":
        options.quiet = true
        break
      case "help":
      case "h":
        helpRequested = true
        break
      case "version":
      case "v":
        versionRequested = true
        break
      case "foreground":
      case "no-daemon":
        options.foreground = true
        break
      case "daemon":
      case "d":
        // Legacy no-op: daemon mode is already the default, but older clients
        // may still pass this when starting a remote server.
        break
      default:
        if (!long && name.length === 1) {
          removedFlagErrors.push(`Unknown option: -${name}`)
        } else {
          removedFlagErrors.push(`Unknown option: --${name}`)
        }
        break
    }
  }

  const command = positional[0] || "serve"
  const subcommand = null
  const startupAction = command === "startup" ? positional[1] || "status" : null
  const tunnelAction = command === "tunnel" ? positional[1] || "status" : null

  return {
    command,
    subcommand,
    startupAction,
    tunnelAction,
    options,
    removedFlagErrors,
    helpRequested,
    versionRequested,
  }
}

function showHelp() {
  console.log(`
 AX Code Desktop - Web interface for the ax-code AI coding agent

USAGE:
  ax-code-desktop [COMMAND] [OPTIONS]

COMMANDS:
  serve          Start the web server (daemon default)
  stop           Stop running instance(s)
  restart        Stop and start the server
  status         Show server status
  tunnel         Manage a Cloudflare quick tunnel for browser access
  startup        Manage launch at system startup
  logs           Tail AX Code Desktop logs
  update         Check desktop runtime update status

OPTIONS:
  -p, --port              Web server port (default: ${DEFAULT_PORT})
  --host                  Bind address (default: 127.0.0.1)
  --ui-password           Protect browser UI with single password
  --foreground            Run server in foreground (use with systemd/process managers)
  --no-daemon             Alias for --foreground
  -h, --help              Show help
  -v, --version           Show version

ENVIRONMENT:
  AX_CODE_DESKTOP_HOST             Bind address (e.g. 0.0.0.0 for all interfaces)
  AX_CODE_DESKTOP_UI_PASSWORD      Alternative to --ui-password flag
  AX_CODE_DESKTOP_DATA_DIR         Override AX Code Desktop data directory
  AX_CODE_HOST               External ax-code server base URL, e.g. http://hostname:4096
  AX_CODE_PORT               Port of external ax-code server to connect to
  AX_CODE_SKIP_START          Skip starting AX Code, use external server
  AX_CODE_DESKTOP_AX_CODE_HOSTNAME  Bind hostname for managed ax-code server (default: 127.0.0.1)

EXAMPLES:
  ax-code-desktop                    # Start in daemon mode on default port 3100 (or next free port)
  ax-code-desktop --port 8080        # Start on port 8080 (daemon)
  ax-code-desktop serve --foreground # Start in foreground (for systemd Type=simple)
  ax-code-desktop startup enable     # Start AX Code Desktop at user login
  ax-code-desktop tunnel start --ui-password secret
  ax-code-desktop logs               # Follow logs for latest running instance
`)
}

function showTunnelHelp() {
  console.log(`
 AX Code Desktop Tunnel Commands

USAGE:
  ax-code-desktop tunnel <SUBCOMMAND> [OPTIONS]

SUBCOMMANDS:
  start       Start a Cloudflare quick tunnel for a running or new web UI
  status      Show active tunnel state
  stop        Stop active tunnel(s)
  providers   Show supported tunnel providers

OPTIONS:
  -p, --port              Target AX Code Desktop web server port
  --ui-password           Required when tunnel start needs to launch the web server
  --provider              Tunnel provider (only cloudflare is supported)
  --mode                  Tunnel mode (only quick is supported)
  --force                 Replace an existing tunnel on the same port
  --json                  Output machine-readable JSON
  -q, --quiet             Suppress non-essential output

EXAMPLES:
  ax-code-desktop tunnel start --ui-password be-creative-here
  ax-code-desktop tunnel start --port 3100 --force
  ax-code-desktop tunnel status --json
  ax-code-desktop tunnel stop --port 3100
`)
}

function showStartupHelp() {
  console.log(`
 AX Code Desktop Startup Commands

USAGE:
  ax-code-desktop startup <SUBCOMMAND> [OPTIONS]

SUBCOMMANDS:
  status      Show startup integration status
  enable      Install and start native user startup integration
  disable     Stop and remove native user startup integration

OPTIONS:
  -p, --port              Web server port used by startup service
  --host                  Bind address used by startup service
  --ui-password           Protect browser UI with single password
  --no-env-snapshot       Do not save current environment for startup service
  --json                  Output machine-readable JSON
  -q, --quiet             Suppress non-essential output

EXAMPLES:
  ax-code-desktop startup enable
  ax-code-desktop startup enable --port 3100
  ax-code-desktop startup status --json
`)
}

function getDataDir() {
  if (
    typeof process.env.AX_CODE_DESKTOP_DATA_DIR === "string" &&
    process.env.AX_CODE_DESKTOP_DATA_DIR.trim().length > 0
  ) {
    return path.resolve(process.env.AX_CODE_DESKTOP_DATA_DIR.trim())
  }
  return path.join(os.homedir(), ".config", "openchamber")
}

function getLogsDir() {
  return path.join(getDataDir(), "logs")
}

function getSettingsFilePath() {
  return path.join(getDataDir(), "settings.json")
}

function readDesktopLocalPortFromSettings() {
  try {
    const raw = fs.readFileSync(getSettingsFilePath(), "utf8")
    const parsed = JSON.parse(raw)
    const value = parsed?.desktopLocalPort
    if (Number.isFinite(value) && value > 0 && value <= 65535) {
      return value
    }
    return null
  } catch {
    return null
  }
}

function ensureLogsDir() {
  fs.mkdirSync(getLogsDir(), { recursive: true })
}

function getLogFilePath(port) {
  return path.join(getLogsDir(), `ax-code-desktop-${port}.log`)
}

function rotateLogFile(logPath) {
  try {
    const stats = fs.statSync(logPath)
    if (stats.size < LOG_ROTATE_MAX_BYTES) {
      return
    }
  } catch {
    return
  }

  for (let i = LOG_ROTATE_KEEP - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`
    const dst = `${logPath}.${i + 1}`
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, dst)
      } catch {}
    }
  }

  try {
    if (fs.existsSync(logPath)) {
      fs.renameSync(logPath, `${logPath}.1`)
    }
  } catch {}
}

const WINDOWS_EXTENSIONS =
  process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .map((ext) => ext.trim().toLowerCase())
        .filter(Boolean)
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
    : [""]

function isExecutable(filePath) {
  try {
    const stats = fs.statSync(filePath)
    if (!stats.isFile()) {
      return false
    }
    if (process.platform === "win32") {
      return true
    }
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveExplicitBinary(candidate) {
  if (!candidate) {
    return null
  }
  if (candidate.includes(path.sep) || path.isAbsolute(candidate)) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate)
    return isExecutable(resolved) ? resolved : null
  }
  return null
}

function searchPathFor(command) {
  const pathValue = process.env.PATH || ""
  const segments = pathValue.split(path.delimiter).filter(Boolean)
  for (const dir of segments) {
    for (const ext of WINDOWS_EXTENSIONS) {
      const fileName = process.platform === "win32" ? `${command}${ext}` : command
      const candidate = path.join(dir, fileName)
      if (isExecutable(candidate)) {
        return candidate
      }
    }
  }
  return null
}

async function checkAxCodeCLI(onNotice) {
  if (process.env.AX_CODE_BINARY) {
    const override = resolveExplicitBinary(process.env.AX_CODE_BINARY)
    if (override) {
      process.env.AX_CODE_BINARY = override
      return override
    }
    const message = `AX_CODE_BINARY="${process.env.AX_CODE_BINARY}" is not an executable file. Falling back to PATH lookup.`
    if (typeof onNotice === "function") {
      onNotice({ level: "warning", code: "AX_CODE_BINARY_INVALID", message })
    } else {
      console.warn(`Warning: ${message}`)
    }
  }

  const resolvedFromPath = searchPathFor("ax-code")
  if (resolvedFromPath) {
    process.env.AX_CODE_BINARY = resolvedFromPath
    return resolvedFromPath
  }

  throw new Error(
    `Unable to locate the ax-code CLI on PATH (${process.env.PATH || "<empty>"}). ` +
      "Ensure the CLI is installed and reachable, or set AX_CODE_BINARY to its full path.",
  )
}

async function isPortAvailable(port, host) {
  if (!Number.isFinite(port) || port <= 0) {
    return false
  }

  return await new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.on("error", () => resolve(false))
    server.listen({ port, host }, () => {
      server.close(() => resolve(true))
    })
  })
}

function resolvePortCheckHost(host) {
  if (typeof host === "string" && host.trim().length > 0) return host.trim()
  if (typeof process.env.AX_CODE_DESKTOP_HOST === "string" && process.env.AX_CODE_DESKTOP_HOST.trim().length > 0) {
    return process.env.AX_CODE_DESKTOP_HOST.trim()
  }
  return "127.0.0.1"
}

async function resolveAvailablePort(desiredPort, explicitPort = false, onNotice, host, dependencies = {}) {
  const portAvailable = dependencies.isPortAvailable || isPortAvailable
  const systemInfoFromPort = dependencies.fetchSystemInfoFromPort || fetchSystemInfoFromPort
  const startPort = Number.isFinite(desiredPort) ? Math.trunc(desiredPort) : DEFAULT_PORT
  const checkHost = resolvePortCheckHost(host)
  if (explicitPort) {
    return startPort
  }
  if (await portAvailable(startPort, checkHost)) {
    return startPort
  }

  const occupant = await systemInfoFromPort(startPort)
  let message
  if (occupant?.runtime === "desktop") {
    message = `Port ${startPort} is used by AX Code Desktop; using a free port`
  } else if (occupant?.runtime) {
    message = `Port ${startPort} is used by an existing AX Code Desktop instance; using a free port`
  } else {
    message = `Port ${startPort} in use; using a free port`
  }
  if (typeof onNotice === "function" && message) {
    onNotice({
      level: "warning",
      code: "PORT_REASSIGNED",
      message,
    })
  } else if (message) {
    console.warn(message)
  }

  for (let offset = 1; offset <= FALLBACK_PORT_SCAN_LIMIT; offset++) {
    const candidate = startPort + offset
    if (candidate > 65535 || isUnsafeBrowserPort(candidate)) continue
    if (await portAvailable(candidate, checkHost)) {
      return candidate
    }
  }

  throw new CliError(
    `No available AX Code Desktop web UI port found in ${startPort}-${Math.min(startPort + FALLBACK_PORT_SCAN_LIMIT, 65535)}. Pass --port to choose an explicit safe port.`,
    EXIT_CODE.NETWORK_RUNTIME_ERROR,
  )
}

function getRunDir() {
  const dir = path.join(getDataDir(), "run")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function getStartupServicePaths() {
  if (process.platform === "darwin") {
    return {
      platform: "macos",
      servicePath: path.join(os.homedir(), "Library", "LaunchAgents", `${STARTUP_SERVICE_ID}.plist`),
    }
  }
  if (process.platform === "linux") {
    return {
      platform: "linux",
      servicePath: path.join(os.homedir(), ".config", "systemd", "user", SYSTEMD_SERVICE_NAME),
    }
  }
  if (process.platform === "win32") {
    return { platform: "windows", servicePath: STARTUP_SERVICE_ID }
  }
  return { platform: process.platform, servicePath: null }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function systemdEscapeArg(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function startupShellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function systemdUnitPath(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/ /g, "\\x20")
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function startupEnvFileQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function systemdEnvFileQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`").replace(/\$/g, "\\$")}"`
}

function getStartupEnvFilePath() {
  return path.join(getDataDir(), "startup.env")
}

function getMacosStartupWrapperPath() {
  return path.join(getDataDir(), "bin", "AX Code Desktop")
}

function collectStartupEnv(options = {}) {
  const env =
    options.envSnapshot === false
      ? {}
      : Object.fromEntries(
          Object.entries(process.env)
            .filter(([key, value]) => shouldPersistStartupEnv(key, value))
            .map(([key, value]) => [key, String(value)]),
        )

  if (options.envSnapshot !== false) {
    const axCodeBinary = process.env.AX_CODE_BINARY || searchPathFor("ax-code")
    if (typeof axCodeBinary === "string" && axCodeBinary.trim().length > 0) {
      env.AX_CODE_BINARY = axCodeBinary.trim()
    }
  }
  const uiPassword = hasUiPasswordConfigured(options.uiPassword) ? options.uiPassword : undefined
  if (uiPassword) {
    env.AX_CODE_DESKTOP_UI_PASSWORD = uiPassword
  }
  if (
    typeof process.env.AX_CODE_DESKTOP_DATA_DIR === "string" &&
    process.env.AX_CODE_DESKTOP_DATA_DIR.trim().length > 0
  ) {
    env.AX_CODE_DESKTOP_DATA_DIR = path.resolve(process.env.AX_CODE_DESKTOP_DATA_DIR.trim())
  }
  return env
}

function shouldPersistStartupEnv(key, value) {
  if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return false
  if (typeof value !== "string") return false
  if (/[\r\n]/.test(value)) return false

  // These are shell/session implementation details, not app configuration.
  const volatileKeys = new Set([
    "_",
    "BASH_ENV",
    "COLUMNS",
    "CONDA_DEFAULT_ENV",
    "CONDA_PREFIX",
    "CONDA_PROMPT_MODIFIER",
    "CONDA_SHLVL",
    "ENV",
    "HISTFILE",
    "HISTFILESIZE",
    "HISTSIZE",
    "LINES",
    "OLDPWD",
    "PROMPT",
    "PROMPT_COMMAND",
    "PS1",
    "PS2",
    "PS3",
    "PS4",
    "PWD",
    "PYENV_VERSION",
    "SHLVL",
    "TERM",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TTY",
    "VIRTUAL_ENV",
    "VIRTUAL_ENV_PROMPT",
  ])
  return !volatileKeys.has(key)
}

function writeStartupEnvFile(options = {}, fileOptions = {}) {
  const envFilePath = getStartupEnvFilePath()
  const lines = []
  const env = collectStartupEnv(options)
  const quoteValue = typeof fileOptions.quoteValue === "function" ? fileOptions.quoteValue : startupEnvFileQuote
  for (const [key, value] of Object.entries(env)) {
    lines.push(`${key}=${quoteValue(value)}`)
  }
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(envFilePath, lines.length > 0 ? `${lines.join("\n")}\n` : "", { mode: 0o600 })
  return envFilePath
}

function removeStartupEnvFile() {
  try {
    fs.unlinkSync(getStartupEnvFilePath())
  } catch {}
}

function resolveCliEntrypoint() {
  const entry =
    typeof process.argv[1] === "string" && process.argv[1].trim().length > 0
      ? process.argv[1]
      : path.join(__dirname, "cli.js")
  try {
    return fs.realpathSync(entry)
  } catch {
    return path.resolve(entry)
  }
}

function buildStartupArgs(options = {}) {
  const args = [resolveCliEntrypoint(), "serve", "--foreground", "--port", String(options.port || DEFAULT_PORT)]
  if (typeof options.host === "string" && options.host.length > 0) {
    args.push("--host", options.host)
  }
  return args
}

function writeMacosStartupWrapper(options = {}) {
  const wrapperPath = getMacosStartupWrapperPath()
  const args = buildStartupArgs(options).map(startupShellQuote).join(" ")
  const content = `#!/bin/sh
exec ${startupShellQuote(process.execPath)} ${args}
`
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(wrapperPath, content, { mode: 0o700 })
  return wrapperPath
}

function buildMacosLaunchAgent(options = {}) {
  const wrapperPath = writeMacosStartupWrapper(options)
  const args = [wrapperPath]
  const env = collectStartupEnv(options)
  const logDir = path.join(os.homedir(), "Library", "Logs", "AX Code Desktop")
  const argXml = args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")
  const envXml =
    Object.entries(env).length > 0
      ? `  <key>EnvironmentVariables</key>\n  <dict>\n${Object.entries(env)
          .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
          .join("\n")}\n  </dict>\n`
      : ""
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${STARTUP_SERVICE_ID}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
${envXml}  <key>ProcessType</key>
  <string>Background</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${escapeXml(os.homedir())}</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, "startup.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, "startup.err.log"))}</string>
</dict>
</plist>
`
}

function buildSystemdUserService(options = {}) {
  const args = buildStartupArgs(options)
    .map((arg) => `"${systemdEscapeArg(arg)}"`)
    .join(" ")
  const envFilePath = getStartupEnvFilePath()
  return `[Unit]
Description=AX Code Desktop web server
After=network-online.target

[Service]
Type=simple
EnvironmentFile=-${systemdEscapeArg(envFilePath)}
ExecStart="${systemdEscapeArg(process.execPath)}" ${args}
WorkingDirectory=${systemdUnitPath(os.homedir())}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
}

function runStartupCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    windowsHide: true,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0 && options.allowFailure !== true) {
    const detail = (result.stderr || result.stdout || "").trim()
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`)
  }
  return result
}

function getStartupStatus() {
  const paths = getStartupServicePaths()
  if (!paths.servicePath) {
    return { supported: false, platform: paths.platform, enabled: false, servicePath: null }
  }
  if (paths.platform === "windows") {
    const result = runStartupCommand("schtasks.exe", ["/Query", "/TN", STARTUP_SERVICE_ID], { allowFailure: true })
    return {
      supported: true,
      platform: paths.platform,
      enabled: result.status === 0,
      active: null,
      servicePath: paths.servicePath,
    }
  }
  if (paths.platform === "linux") {
    const enabledResult = runStartupCommand("systemctl", ["--user", "is-enabled", SYSTEMD_SERVICE_NAME], {
      allowFailure: true,
    })
    const activeResult = runStartupCommand("systemctl", ["--user", "is-active", SYSTEMD_SERVICE_NAME], {
      allowFailure: true,
    })
    const activeState = (activeResult.stdout || "").trim() || "inactive"
    return {
      supported: true,
      platform: paths.platform,
      enabled: enabledResult.status === 0 || fs.existsSync(paths.servicePath),
      active: activeState === "active",
      activeState,
      servicePath: paths.servicePath,
    }
  }
  return {
    supported: true,
    platform: paths.platform,
    enabled: fs.existsSync(paths.servicePath),
    active: null,
    servicePath: paths.servicePath,
  }
}

function enableStartupService(options = {}) {
  const paths = getStartupServicePaths()
  if (!paths.servicePath) {
    throw new CliError(`Startup integration is not supported on ${paths.platform}.`, EXIT_CODE.USAGE_ERROR)
  }

  if (paths.platform === "macos") {
    removeStartupEnvFile()
    fs.mkdirSync(path.dirname(paths.servicePath), { recursive: true, mode: 0o700 })
    fs.mkdirSync(path.join(os.homedir(), "Library", "Logs", "AX Code Desktop"), { recursive: true, mode: 0o700 })
    fs.writeFileSync(paths.servicePath, buildMacosLaunchAgent(options), { mode: 0o600 })
    runStartupCommand("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, paths.servicePath], {
      allowFailure: true,
    })
    runStartupCommand("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, paths.servicePath])
    runStartupCommand("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${STARTUP_SERVICE_ID}`], {
      allowFailure: true,
    })
    return getStartupStatus()
  }

  if (paths.platform === "linux") {
    writeStartupEnvFile(options, { quoteValue: systemdEnvFileQuote })
    fs.mkdirSync(path.dirname(paths.servicePath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(paths.servicePath, buildSystemdUserService(options), { mode: 0o600 })
    runStartupCommand("systemctl", ["--user", "daemon-reload"])
    runStartupCommand("systemctl", ["--user", "enable", "--now", SYSTEMD_SERVICE_NAME])
    return getStartupStatus()
  }

  const envFilePath = writeStartupEnvFile(options)
  const startupArgs = buildStartupArgs(options).map(powershellQuote).join(", ")
  const powerShellCommand = [
    `$envFile=${powershellQuote(envFilePath)}`,
    `if (Test-Path $envFile) { Get-Content $envFile | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { $v=$matches[2]; if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v=$v.Substring(1,$v.Length-2).Replace("'\\''","'") }; [Environment]::SetEnvironmentVariable($matches[1], $v, 'Process') } } }`,
    `& ${powershellQuote(process.execPath)} ${startupArgs}`,
  ].join("; ")
  const taskArgs = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${powerShellCommand.replace(/"/g, '\\"')}"`
  runStartupCommand("schtasks.exe", [
    "/Create",
    "/TN",
    STARTUP_SERVICE_ID,
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F",
    "/TR",
    taskArgs,
  ])
  runStartupCommand("schtasks.exe", ["/Run", "/TN", STARTUP_SERVICE_ID], { allowFailure: true })
  return getStartupStatus()
}

function disableStartupService() {
  const paths = getStartupServicePaths()
  if (!paths.servicePath) {
    throw new CliError(`Startup integration is not supported on ${paths.platform}.`, EXIT_CODE.USAGE_ERROR)
  }

  if (paths.platform === "macos") {
    runStartupCommand("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, paths.servicePath], {
      allowFailure: true,
    })
    try {
      fs.unlinkSync(paths.servicePath)
    } catch {}
    return getStartupStatus()
  }

  if (paths.platform === "linux") {
    runStartupCommand("systemctl", ["--user", "disable", "--now", SYSTEMD_SERVICE_NAME], { allowFailure: true })
    try {
      fs.unlinkSync(paths.servicePath)
    } catch {}
    runStartupCommand("systemctl", ["--user", "daemon-reload"], { allowFailure: true })
    return getStartupStatus()
  }

  runStartupCommand("schtasks.exe", ["/End", "/TN", STARTUP_SERVICE_ID], { allowFailure: true })
  runStartupCommand("schtasks.exe", ["/Delete", "/TN", STARTUP_SERVICE_ID, "/F"], { allowFailure: true })
  return getStartupStatus()
}

async function getPidFilePath(port) {
  return path.join(getRunDir(), `ax-code-desktop-${port}.pid`)
}

async function getInstanceFilePath(port) {
  return path.join(getRunDir(), `ax-code-desktop-${port}.json`)
}

function readPidFile(pidFilePath) {
  try {
    const content = fs.readFileSync(pidFilePath, "utf8").trim()
    const pid = parseInt(content, 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

function writePidFile(pidFilePath, pid, onNotice) {
  try {
    fs.writeFileSync(pidFilePath, String(pid), { mode: 0o600 })
  } catch (error) {
    const message = `Could not write PID file: ${error.message}`
    if (typeof onNotice === "function") {
      onNotice({ level: "warning", code: "PID_FILE_WRITE_FAILED", message })
    } else {
      console.warn(`Warning: ${message}`)
    }
  }
}

function removePidFile(pidFilePath) {
  try {
    if (fs.existsSync(pidFilePath)) {
      fs.unlinkSync(pidFilePath)
    }
  } catch {}
}

function readInstanceOptions(instanceFilePath) {
  try {
    return JSON.parse(fs.readFileSync(instanceFilePath, "utf8"))
  } catch {
    return null
  }
}

function writeInstanceOptions(instanceFilePath, options, onNotice) {
  try {
    const toStore = {
      port: options.port,
      host: typeof options.host === "string" && options.host.length > 0 ? options.host : undefined,
      launchMode: options.launchMode === "foreground" ? "foreground" : "daemon",
      uiPassword: typeof options.uiPassword === "string" ? options.uiPassword : undefined,
      hasUiPassword: typeof options.uiPassword === "string",
      startedAt: Number.isFinite(options.startedAt) ? options.startedAt : Date.now(),
    }
    fs.writeFileSync(instanceFilePath, JSON.stringify(toStore, null, 2), { mode: 0o600 })
  } catch (error) {
    const message = `Could not write instance file: ${error.message}`
    if (typeof onNotice === "function") {
      onNotice({ level: "warning", code: "INSTANCE_FILE_WRITE_FAILED", message })
    } else {
      console.warn(`Warning: ${message}`)
    }
  }
}

function removeInstanceFile(instanceFilePath) {
  try {
    if (fs.existsSync(instanceFilePath)) {
      fs.unlinkSync(instanceFilePath)
    }
  } catch {}
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForProcessExit(pid, timeoutMs) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return Promise.resolve(true)
  }

  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const check = () => {
      if (!isProcessRunning(pid)) {
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        resolve(false)
        return
      }
      setTimeout(check, 150)
    }
    check()
  })
}

async function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return true
  }

  const gracefulTimeoutMs =
    Number.isFinite(options.gracefulTimeoutMs) && options.gracefulTimeoutMs >= 0
      ? Math.trunc(options.gracefulTimeoutMs)
      : 2500
  const forceTimeoutMs =
    Number.isFinite(options.forceTimeoutMs) && options.forceTimeoutMs >= 0 ? Math.trunc(options.forceTimeoutMs) : 3000

  if (process.platform === "win32") {
    try {
      process.kill(pid)
    } catch {}

    if (await waitForProcessExit(pid, 800)) {
      return true
    }

    try {
      spawnSync("taskkill", ["/pid", String(pid), "/t"], {
        stdio: "ignore",
        timeout: 3000,
        windowsHide: true,
      })
    } catch {}

    if (await waitForProcessExit(pid, gracefulTimeoutMs)) {
      return true
    }

    try {
      spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        timeout: 5000,
        windowsHide: true,
      })
    } catch {}

    return waitForProcessExit(pid, forceTimeoutMs)
  }

  try {
    process.kill(pid, "SIGTERM")
  } catch {}

  if (await waitForProcessExit(pid, gracefulTimeoutMs)) {
    return true
  }

  try {
    process.kill(pid, "SIGKILL")
  } catch {}

  return waitForProcessExit(pid, forceTimeoutMs)
}

async function stopInstanceProcess(pid, options = {}) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return true
  }

  const shutdownWaitMs =
    Number.isFinite(options.shutdownWaitMs) && options.shutdownWaitMs >= 0 ? Math.trunc(options.shutdownWaitMs) : 5000

  if (await waitForProcessExit(pid, shutdownWaitMs)) {
    return true
  }

  return terminateProcessTree(pid, options)
}

async function requestServerShutdown(port) {
  if (!Number.isFinite(port) || port <= 0) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const resp = await fetch(buildLocalUrl(port, API_SYSTEM_SHUTDOWN_PATH), {
      method: "POST",
      signal: controller.signal,
    })
    return resp.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function requestJson(port, endpoint, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.trunc(options.timeoutMs) : 4000
  const fetchOptions = { ...options }
  delete fetchOptions.timeoutMs

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(buildLocalUrl(port, endpoint), {
      ...fetchOptions,
      headers: {
        Accept: "application/json",
        ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
        ...(fetchOptions.headers || {}),
      },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    return { response, body }
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
      throw new Error(`Request to ${endpoint} timed out after ${timeoutMs}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function isServerHealthReady(port, timeoutMs = 1000) {
  if (!Number.isFinite(port) || port <= 0) {
    return false
  }
  const requestTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.trunc(timeoutMs) : 1000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeout)
  try {
    const response = await fetch(buildLocalUrl(port, API_HEALTH_PATH), {
      headers: { Accept: "text/plain" },
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForServerHealth(port, { timeoutMs = 60000, intervalMs = 250, onTick } = {}) {
  const start = Date.now()
  const deadline = start + timeoutMs
  while (Date.now() < deadline) {
    const elapsedMs = Date.now() - start
    if (typeof onTick === "function") {
      onTick({ elapsedMs, timeoutMs })
    }
    if (await isServerHealthReady(port, Math.min(1000, intervalMs * 2))) {
      if (typeof onTick === "function") {
        onTick({ elapsedMs: Math.min(Date.now() - start, timeoutMs), timeoutMs, complete: true })
      }
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  if (typeof onTick === "function") {
    onTick({ elapsedMs: timeoutMs, timeoutMs, timedOut: true })
  }
  return false
}

async function discoverRunningInstances() {
  const instances = []
  const runDir = getRunDir()
  try {
    const files = fs.readdirSync(runDir)
    const pidFiles = files.filter(
      (file) => (file.startsWith("ax-code-desktop-") || file.startsWith("openchamber-")) && file.endsWith(".pid"),
    )
    for (const file of pidFiles) {
      const port = parseInt(file.replace(/^(ax-code-desktop|openchamber)-/, "").replace(".pid", ""), 10)
      if (!Number.isFinite(port) || port <= 0) continue
      const pidFilePath = path.join(runDir, file)
      const pid = readPidFile(pidFilePath)
      if (!pid || !isProcessRunning(pid)) {
        removePidFile(pidFilePath)
        removeInstanceFile(path.join(runDir, `ax-code-desktop-${port}.json`))
        removeInstanceFile(path.join(runDir, `openchamber-${port}.json`))
        continue
      }
      const instanceFilePath = fs.existsSync(path.join(runDir, `ax-code-desktop-${port}.json`))
        ? path.join(runDir, `ax-code-desktop-${port}.json`)
        : path.join(runDir, `openchamber-${port}.json`)
      let mtime = 0
      let startedAt = 0
      try {
        mtime = fs.statSync(pidFilePath).mtimeMs
      } catch {}
      const storedOptions = readInstanceOptions(instanceFilePath)
      if (Number.isFinite(storedOptions?.startedAt)) {
        startedAt = storedOptions.startedAt
      }
      const launchMode = storedOptions?.launchMode === "foreground" ? "foreground" : "daemon"
      instances.push({ port, pid, pidFilePath, instanceFilePath, mtime, startedAt, launchMode })
    }
  } catch {}
  instances.sort((a, b) => a.port - b.port)
  return instances
}

function getLatestInstance(instances) {
  if (!instances.length) return null
  return [...instances].sort((a, b) => {
    const startedDelta = (b.startedAt || 0) - (a.startedAt || 0)
    if (startedDelta !== 0) return startedDelta
    const mtimeDelta = (b.mtime || 0) - (a.mtime || 0)
    if (mtimeDelta !== 0) return mtimeDelta
    return b.port - a.port
  })[0]
}

async function fetchSystemInfoFromPort(port, fetchImpl = globalThis.fetch) {
  if (!Number.isFinite(port) || port <= 0 || typeof fetchImpl !== "function") {
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetchImpl(buildLocalUrl(port, API_SYSTEM_INFO_PATH), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    if (!body || typeof body.runtime !== "string") return null

    return {
      runtime: body.runtime,
      pid: Number.isFinite(body.pid) ? body.pid : null,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchUiPasswordProtectionStatus(port, fetchImpl = globalThis.fetch) {
  if (!Number.isFinite(port) || port <= 0 || typeof fetchImpl !== "function") {
    return { known: false, protected: false }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetchImpl(buildLocalUrl(port, AUTH_SESSION_PATH), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (response.status === 401 && body?.locked === true) {
      return { known: true, protected: true }
    }
    if (response.ok && body?.disabled === true) {
      return { known: true, protected: false }
    }
    if (response.ok && body?.authenticated === true) {
      return { known: true, protected: body?.disabled !== true }
    }
    return { known: true, protected: response.status === 401 }
  } catch {
    return { known: false, protected: false }
  } finally {
    clearTimeout(timeout)
  }
}

async function discoverDesktopInstance(fetchImpl = globalThis.fetch) {
  const port = readDesktopLocalPortFromSettings()
  if (!port) {
    return null
  }

  const info = await fetchSystemInfoFromPort(port, fetchImpl)
  if (!info || info.runtime !== "desktop") {
    return null
  }

  return {
    port,
    pid: info.pid,
    runtime: info.runtime,
  }
}

function createCliTunnelManager() {
  return createTunnelManager({
    getRunDir,
    getLogsDir,
    searchPathFor,
    isExecutable,
    isProcessRunning,
    terminateProcessTree,
  })
}

function buildTunnelServeOptions(options, explicitPort) {
  return {
    ...options,
    explicitPort,
    json: false,
    suppressStartupSummary: true,
    suppressUiPasswordWarning: true,
    quiet: true,
    suppressQuietOutput: true,
  }
}

function resolveTunnelProviderAndMode(options = {}) {
  try {
    return {
      provider: normalizeTunnelProvider(options.provider),
      mode: normalizeTunnelMode(options.mode),
    }
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), EXIT_CODE.USAGE_ERROR)
  }
}

async function resolveTunnelTarget(options, commandRuntime) {
  const runningInstances = await discoverRunningInstances()
  const desktopInstance = await discoverDesktopInstance()
  const explicitPort = options.explicitPort === true

  if (explicitPort) {
    const port = options.port
    const tracked = runningInstances.find((entry) => entry.port === port)
    if (tracked) return { port, started: false }
    const info = await fetchSystemInfoFromPort(port)
    if (info?.runtime) return { port, started: false }
  } else {
    const latest = getLatestInstance(runningInstances)
    if (latest) return { port: latest.port, started: false }
    if (desktopInstance?.port) return { port: desktopInstance.port, started: false }
  }

  if (!hasUiPasswordConfigured(options.uiPassword)) {
    throw new CliError(
      "Starting a tunnel requires UI password protection. Pass --ui-password or set AX_CODE_DESKTOP_UI_PASSWORD before starting the tunnel.",
      EXIT_CODE.AUTH_CONFIG_ERROR,
    )
  }

  const port = await commandRuntime.serve(buildTunnelServeOptions(options, explicitPort))
  return { port, started: true }
}

async function assertTunnelTargetProtected(port) {
  const status = await fetchUiPasswordProtectionStatus(port)
  if (status.known && status.protected) {
    return
  }
  throw new CliError(
    `Refusing to expose AX Code Desktop on port ${port} without UI password protection. Restart it with --ui-password or AX_CODE_DESKTOP_UI_PASSWORD, then retry.`,
    EXIT_CODE.AUTH_CONFIG_ERROR,
  )
}

function readTailLines(filePath, lineCount = DEFAULT_TAIL_LINES) {
  if (!fs.existsSync(filePath)) {
    return []
  }
  const raw = fs.readFileSync(filePath, "utf8")
  const lines = raw.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines.slice(Math.max(0, lines.length - lineCount))
}

function followFile(filePath, onLine) {
  let position = 0
  try {
    position = fs.statSync(filePath).size
  } catch {
    position = 0
  }

  let remainder = ""
  const interval = setInterval(() => {
    try {
      const stats = fs.statSync(filePath)
      if (stats.size < position) {
        position = 0
      }
      if (stats.size === position) {
        return
      }

      const fd = fs.openSync(filePath, "r")
      try {
        const length = stats.size - position
        const buffer = Buffer.alloc(length)
        fs.readSync(fd, buffer, 0, length, position)
        position = stats.size
        const chunk = remainder + buffer.toString("utf8")
        const parts = chunk.split(/\r?\n/)
        remainder = parts.pop() || ""
        for (const line of parts) {
          onLine(line)
        }
      } finally {
        fs.closeSync(fd)
      }
    } catch {}
  }, 400)

  return () => {
    clearInterval(interval)
  }
}

const commands = {
  async serve(options) {
    const showOutput = shouldRenderHumanOutput(options)
    const jsonMessages = []
    const emitNotice = (notice) => {
      if (!notice || typeof notice !== "object" || typeof notice.message !== "string") return
      const level = notice.level === "error" ? "error" : notice.level === "warning" ? "warning" : "info"

      if (isJsonMode(options)) {
        jsonMessages.push({
          level,
          code: notice.code,
          message: notice.message,
        })
        return
      }

      if (showOutput) {
        logStatus(level, notice.message)
        return
      }

      if (!isQuietMode(options)) {
        const prefix = level === "warning" ? "Warning" : level === "error" ? "Error" : "Info"
        const line = `${prefix}: ${notice.message}`
        if (level === "error") {
          console.error(line)
        } else {
          console.warn(line)
        }
      }
    }
    const explicitPort = options.explicitPort === true
    const targetPort = await resolveAvailablePort(options.port, explicitPort, emitNotice, options.host)

    if (targetPort !== 0 && !options.suppressUnsafePortWarning) {
      assertSafeBrowserPort(targetPort, { context: "AX Code Desktop serve" })
    }

    if (targetPort !== 0) {
      const pidFilePath = await getPidFilePath(targetPort)
      const existingPid = readPidFile(pidFilePath)
      if (existingPid && isProcessRunning(existingPid)) {
        throw new Error(`AX Code Desktop is already running on port ${targetPort} (PID: ${existingPid})`)
      }

      if (explicitPort && !(await isPortAvailable(targetPort, options.host))) {
        const systemInfo = await fetchSystemInfoFromPort(targetPort)
        if (systemInfo?.runtime === "desktop") {
          throw new Error(`Port ${targetPort} is used by AX Code Desktop. Choose another port or stop the desktop app.`)
        }
        if (systemInfo?.runtime) {
          throw new Error(
            `AX Code Desktop is already running on port ${targetPort}. Use \`ax-code-desktop status\` or \`ax-code-desktop stop --port ${targetPort}\`.`,
          )
        }
        throw new Error(`Port ${targetPort} is already in use by another process.`)
      }
    }

    const axCodeBinary = await checkAxCodeCLI(emitNotice)
    const serverPath = path.join(__dirname, "..", "server", "index.js")
    const runtimeBin = process.execPath

    ensureLogsDir()
    const initialLogPort = targetPort === 0 ? "auto" : String(targetPort)
    const initialLogPath = getLogFilePath(initialLogPort)
    rotateLogFile(initialLogPath)
    const logFd = fs.openSync(initialLogPath, "a")

    const effectiveUiPassword = hasUiPasswordConfigured(options.uiPassword) ? options.uiPassword : undefined
    if (!effectiveUiPassword && !options.suppressUiPasswordWarning) {
      const warningLine = "AX_CODE_DESKTOP_UI_PASSWORD is not set"
      const warningDetail = "browser UI is unsecured. Use --ui-password or AX_CODE_DESKTOP_UI_PASSWORD."
      if (showOutput) {
        logStatus("warning", warningLine, warningDetail)
      } else if (isJsonMode(options)) {
        emitNotice({
          level: "warning",
          code: "UI_PASSWORD_MISSING",
          message: `${warningLine}; ${warningDetail}`,
        })
      } else if (!isQuietMode(options)) {
        console.warn(`Warning: ${warningLine}; ${warningDetail}`)
      }
    }
    // Foreground mode: run server inline so the CLI process is the server process.
    // Required for process managers like systemd (Type=simple) that track the
    // direct child rather than a detached grandchild.
    // IMPORTANT: foreground MUST remain inline (in-process). Do not convert to
    // child-process orchestration — that causes shell job-control suspension.
    if (options.foreground) {
      if (isJsonMode(options)) {
        throw new CliError(
          "--json is not supported with --foreground. Use --json with background (daemon) mode instead.",
          EXIT_CODE.USAGE_ERROR,
        )
      }

      // Propagate resolved values into env before importing the server module.
      if (axCodeBinary) {
        process.env.AX_CODE_BINARY = axCodeBinary
      }
      if (effectiveUiPassword) {
        process.env.AX_CODE_DESKTOP_UI_PASSWORD = effectiveUiPassword
      }

      // In --quiet mode, redirect stdout/stderr to the log file so that
      // server runtime output (console.log calls) does not pollute the
      // deterministic CLI output contract.  In plain human mode, close the
      // log fd and let output go to the inherited terminal as before.
      const suppressServerOutput = isQuietMode(options)
      // Keep a reference to the real stdout.write so CLI output (port, JSON)
      // can bypass the log-file redirect.
      const realStdoutWrite = process.stdout.write.bind(process.stdout)
      if (suppressServerOutput) {
        const logStream = fs.createWriteStream(null, { fd: logFd })
        process.stdout.write = (chunk, encoding, callback) => {
          return logStream.write(chunk, encoding, callback)
        }
        process.stderr.write = (chunk, encoding, callback) => {
          return logStream.write(chunk, encoding, callback)
        }
      } else {
        // Close the log fd – in foreground human mode stdout/stderr are
        // inherited from the parent (e.g. journald/terminal).
        try {
          fs.closeSync(logFd)
        } catch {}
      }

      if (!isQuietMode(options)) {
        console.log(`Starting AX Code Desktop on port ${targetPort === 0 ? "auto" : targetPort} (foreground)`)
      }

      const effectiveHost = typeof options.host === "string" && options.host.length > 0 ? options.host : undefined

      const { startWebUiServer } = await import(pathToFileURL(serverPath).href)
      const controller = await startWebUiServer({
        port: targetPort,
        host: effectiveHost,
        uiPassword: effectiveUiPassword,
        attachSignals: false,
        exitOnShutdown: false,
      })

      const resolvedPort = controller.getPort()

      // Write PID / instance files so status, stop, and restart can discover
      // this foreground instance the same way they discover daemon instances.
      const fgPidFilePath = await getPidFilePath(resolvedPort)
      const fgInstanceFilePath = await getInstanceFilePath(resolvedPort)
      writePidFile(fgPidFilePath, process.pid, emitNotice)
      writeInstanceOptions(
        fgInstanceFilePath,
        {
          port: resolvedPort,
          host: effectiveHost,
          launchMode: "foreground",
          uiPassword: effectiveUiPassword,
        },
        emitNotice,
      )

      if (isQuietMode(options)) {
        if (!options.suppressQuietOutput) {
          realStdoutWrite(`${resolvedPort}\n`)
        }
      }

      // Clean up PID / instance files.
      const cleanupFiles = () => {
        removePidFile(fgPidFilePath)
        removeInstanceFile(fgInstanceFilePath)
      }

      process.on("exit", cleanupFiles)

      // Idempotent graceful shutdown with deterministic exit codes.
      let shutdownInProgress = false
      const shutdownForegroundServer = async (signal = "SIGTERM") => {
        if (shutdownInProgress) return
        shutdownInProgress = true
        try {
          await controller.stop({ exitProcess: false })
        } catch {}
        cleanupFiles()
        foregroundServerActive = false
        foregroundShutdown = null
        const exitCode = signal === "SIGINT" ? 130 : signal === "SIGQUIT" ? 131 : 143
        process.exit(exitCode)
      }

      // Expose shutdown to the global SIGINT handler.
      foregroundShutdown = shutdownForegroundServer
      foregroundServerActive = true

      // Register signal handlers (additive, no removeAllListeners).
      process.on("SIGINT", () => {
        void shutdownForegroundServer("SIGINT")
      })
      process.on("SIGTERM", () => {
        void shutdownForegroundServer("SIGTERM")
      })
      process.on("SIGQUIT", () => {
        void shutdownForegroundServer("SIGQUIT")
      })

      // Block forever – the process stays alive until signalled.
      await new Promise(() => {})
    }

    const serverArgs = [serverPath, "--port", String(targetPort)]
    const effectiveHost = typeof options.host === "string" && options.host.length > 0 ? options.host : undefined
    if (effectiveHost) {
      serverArgs.push("--host", effectiveHost)
    }

    const serveSpin = showOutput ? createSpinner(options) : null

    const child = spawn(runtimeBin, serverArgs, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd, "ipc"],
      env: {
        ...process.env,
        AX_CODE_DESKTOP_PORT: String(targetPort),
        AX_CODE_BINARY: axCodeBinary,
        ...(effectiveHost ? { AX_CODE_DESKTOP_HOST: effectiveHost } : {}),
        ...(effectiveUiPassword ? { AX_CODE_DESKTOP_UI_PASSWORD: effectiveUiPassword } : {}),
        ...(process.env.AX_CODE_SKIP_START
          ? { AX_CODE_DESKTOP_SKIP_AX_CODE_START: process.env.AX_CODE_SKIP_START }
          : {}),
      },
    })

    child.unref()
    serveSpin?.start(`Starting AX Code Desktop on port ${targetPort === 0 ? "auto" : targetPort}...`)

    let resolvedPort
    try {
      resolvedPort = await new Promise((resolve, reject) => {
        let settled = false
        const timeout = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(`AX Code Desktop daemon did not report ready within ${DAEMON_READY_TIMEOUT_MS / 1000}s`))
        }, DAEMON_READY_TIMEOUT_MS)

        child.on("message", (msg) => {
          if (settled) return
          if (msg && msg.type === "openchamber:ready" && typeof msg.port === "number") {
            settled = true
            clearTimeout(timeout)
            resolve(msg.port)
          }
        })

        child.on("error", (error) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(error)
        })

        child.on("exit", (code, signal) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(
            new Error(
              `AX Code Desktop daemon exited before reporting ready${signal ? ` (${signal})` : ` (code ${code ?? "unknown"})`}`,
            ),
          )
        })
      })
    } catch (error) {
      await terminateProcessTree(child.pid, { gracefulTimeoutMs: 1500, forceTimeoutMs: 1500 })
      throw error
    }

    try {
      if (typeof child.disconnect === "function" && child.connected) {
        child.disconnect()
      }
    } catch {}

    try {
      fs.closeSync(logFd)
    } catch {}

    const resolvedLogPath = getLogFilePath(resolvedPort)
    if (initialLogPath !== resolvedLogPath && !fs.existsSync(resolvedLogPath)) {
      try {
        fs.renameSync(initialLogPath, resolvedLogPath)
      } catch {}
    }

    if (!isProcessRunning(child.pid)) {
      serveSpin?.error("Failed to start AX Code Desktop")
      throw new Error("Failed to start server in daemon mode")
    }

    const pidFilePath = await getPidFilePath(resolvedPort)
    const instanceFilePath = await getInstanceFilePath(resolvedPort)
    writePidFile(pidFilePath, child.pid, emitNotice)
    writeInstanceOptions(
      instanceFilePath,
      {
        port: resolvedPort,
        host: effectiveHost,
        launchMode: "daemon",
        uiPassword: effectiveUiPassword,
      },
      emitNotice,
    )

    const serveResult = {
      port: resolvedPort,
      pid: child.pid,
      url: buildLocalUrl(resolvedPort, "/"),
      logs: `ax-code-desktop logs -p ${resolvedPort}`,
      launchMode: "daemon",
    }

    if (isJsonMode(options)) {
      printJson({ ...serveResult, messages: jsonMessages })
      return resolvedPort
    }

    if (isQuietMode(options)) {
      if (options.suppressQuietOutput) {
        return resolvedPort
      }
      process.stdout.write(`${resolvedPort}\n`)
      return resolvedPort
    }

    serveSpin?.clear()

    if (!options.suppressStartupSummary && showOutput) {
      clackIntro("AX Code Desktop Started")
      logStatus("success", `port ${serveResult.port} (PID: ${serveResult.pid})`)
      logStatus("info", `visit: ${serveResult.url}`)
      logStatus("info", `logs: ${serveResult.logs}`)
      clackOutro("daemon running")
    }

    return resolvedPort
  },

  async stop(options) {
    const showOutput = shouldRenderHumanOutput(options)
    const suppressQuietOutput = options?.suppressQuietOutput === true
    const jsonResults = []
    const printQuietStopResults = () => {
      if (suppressQuietOutput) return
      if (!isQuietMode(options) || isJsonMode(options)) return
      if (jsonResults.length === 0) {
        process.stdout.write("none\n")
        return
      }
      for (const result of jsonResults) {
        if (result.stopped) {
          process.stdout.write(`stopped ${result.port}\n`)
        } else {
          const reason = result.reason || "failed"
          process.stderr.write(`failed ${result.port} ${reason}\n`)
        }
      }
    }
    const finish = (text) => {
      if (!showOutput) return
      clackOutro(text)
    }

    if (showOutput) {
      clackIntro("AX Code Desktop Stop")
    }

    let runningInstances = await discoverRunningInstances()
    if (runningInstances.length === 0) {
      if (isJsonMode(options)) {
        printJson({ stoppedCount: 0, results: jsonResults })
      }
      if (showOutput) {
        logStatus("info", "No running AX Code Desktop instances found")
        finish("nothing to stop")
      }
      printQuietStopResults()
      return
    }

    if (options.explicitPort) {
      runningInstances = runningInstances.filter((entry) => entry.port === options.port)
      if (runningInstances.length === 0) {
        const systemInfo = await fetchSystemInfoFromPort(options.port)
        if (systemInfo?.runtime === "desktop") {
          jsonResults.push({ port: options.port, runtime: "desktop", stopped: false, reason: "desktop-managed" })
          if (isJsonMode(options)) {
            printJson({
              stoppedCount: 0,
              results: jsonResults,
              messages: [
                {
                  level: "warning",
                  code: "DESKTOP_MANAGED_PORT",
                  message: `Port ${options.port} is managed by AX Code Desktop and cannot be stopped with this command.`,
                },
              ],
            })
          }
          if (showOutput) {
            logStatus(
              "warning",
              `port ${options.port} is managed by AX Code Desktop`,
              "cannot be stopped with this command",
            )
            finish("no changes applied")
          }
          printQuietStopResults()
          return
        }

        if (systemInfo?.runtime) {
          const unmanagedStopSpin = showOutput ? createSpinner(options) : null
          if (showOutput && !unmanagedStopSpin) {
            logStatus("info", `found unmanaged AX Code Desktop instance on port ${options.port}`, "attempting shutdown")
          }
          unmanagedStopSpin?.start(`Stopping unmanaged AX Code Desktop on port ${options.port}...`)
          const requested = await requestServerShutdown(options.port)

          if (Number.isFinite(systemInfo.pid) && isProcessRunning(systemInfo.pid)) {
            await stopInstanceProcess(systemInfo.pid, {
              shutdownWaitMs: requested ? 5000 : 0,
              gracefulTimeoutMs: 2500,
              forceTimeoutMs: 3000,
            }).catch(() => false)
          }

          const stopped = await isPortAvailable(options.port)
          if (stopped) {
            unmanagedStopSpin?.stop(`Stopped unmanaged AX Code Desktop on port ${options.port}`)
            jsonResults.push({ port: options.port, runtime: "unmanaged", stopped: true })
            if (isJsonMode(options)) {
              printJson({ stoppedCount: 1, results: jsonResults })
            }
            if (showOutput && !unmanagedStopSpin) {
              logStatus("success", `stopped AX Code Desktop on port ${options.port}`)
              finish("stop complete")
            }
            printQuietStopResults()
          } else if (requested) {
            unmanagedStopSpin?.stop(`Shutdown requested on port ${options.port} (still occupied)`)
            jsonResults.push({
              port: options.port,
              runtime: "unmanaged",
              stopped: false,
              reason: "shutdown-requested-port-busy",
            })
            if (isJsonMode(options)) {
              printJson({
                status: "warning",
                stoppedCount: 0,
                results: jsonResults,
                messages: [
                  {
                    level: "warning",
                    code: "SHUTDOWN_PARTIAL",
                    message: `Shutdown was requested for port ${options.port}, but the port is still occupied.`,
                  },
                ],
              })
            }
            if (showOutput && !unmanagedStopSpin) {
              logStatus("warning", `shutdown requested on port ${options.port}`, "port is still occupied")
              finish("partial stop")
            }
            printQuietStopResults()
          } else {
            unmanagedStopSpin?.error(`Could not stop AX Code Desktop on port ${options.port}`)
            jsonResults.push({ port: options.port, runtime: "unmanaged", stopped: false, reason: "stop-failed" })
            if (isJsonMode(options)) {
              printJson({
                status: "error",
                stoppedCount: 0,
                results: jsonResults,
                messages: [
                  {
                    level: "error",
                    code: "STOP_FAILED",
                    message: `Could not stop AX Code Desktop on port ${options.port}.`,
                  },
                ],
              })
            }
            if (showOutput && !unmanagedStopSpin) {
              logStatus("error", `could not stop AX Code Desktop on port ${options.port}`)
              finish("failed")
            }
            printQuietStopResults()
          }
          return
        }

        jsonResults.push({ port: options.port, stopped: false, reason: "not-found" })
        if (isJsonMode(options)) {
          printJson({ stoppedCount: 0, results: jsonResults })
        }
        if (showOutput) {
          logStatus("info", `no AX Code Desktop instance found on port ${options.port}`)
          finish("nothing to stop")
        }
        printQuietStopResults()
        return
      }
    }

    for (const instance of runningInstances) {
      const stopSpin = showOutput ? createSpinner(options) : null
      if (showOutput && !stopSpin) {
        logStatus("info", `stopping port ${instance.port} (PID: ${instance.pid})`)
      }
      stopSpin?.start(`Stopping AX Code Desktop on port ${instance.port}...`)
      try {
        const requested = await requestServerShutdown(instance.port)
        const stopped = await stopInstanceProcess(instance.pid, {
          shutdownWaitMs: requested ? 5000 : 0,
          gracefulTimeoutMs: 2500,
          forceTimeoutMs: 3000,
        })
        if (!stopped && isProcessRunning(instance.pid)) {
          throw new Error(`Timed out stopping pid ${instance.pid}`)
        }
        removePidFile(instance.pidFilePath)
        removeInstanceFile(instance.instanceFilePath)
        stopSpin?.stop(`Stopped AX Code Desktop on port ${instance.port}`)
        jsonResults.push({ port: instance.port, pid: instance.pid, stopped: true })
        if (showOutput && !stopSpin) {
          logStatus("success", `stopped port ${instance.port}`)
        }
      } catch (error) {
        stopSpin?.error(`Failed to stop AX Code Desktop on port ${instance.port}`)
        jsonResults.push({
          port: instance.port,
          pid: instance.pid,
          stopped: false,
          reason: error instanceof Error ? error.message : String(error),
        })
        if (showOutput) {
          logStatus("error", `error stopping port ${instance.port}`, error.message)
        } else if (!isJsonMode(options) && !isQuietMode(options)) {
          console.error(`Error stopping port ${instance.port}: ${error.message}`)
        }
      }
    }

    if (isJsonMode(options)) {
      const stoppedCount = jsonResults.filter((entry) => entry.stopped).length
      const hasFailure = jsonResults.some((entry) => !entry.stopped)
      printJson({
        status: hasFailure ? "warning" : "ok",
        stoppedCount,
        results: jsonResults,
      })
      return
    }

    finish(`${runningInstances.length} instance(s)`)
    printQuietStopResults()
  },

  async restart(options) {
    const showOutput = shouldRenderHumanOutput(options)
    const restarted = []

    if (showOutput) {
      clackIntro("AX Code Desktop Restart")
    }

    let runningInstances = await discoverRunningInstances()
    if (runningInstances.length === 0) {
      if (isJsonMode(options)) {
        printJson({ restartedCount: 0, results: restarted })
      }
      if (showOutput) {
        logStatus("info", "No running AX Code Desktop instances to restart")
        clackOutro("nothing to restart")
      } else if (isQuietMode(options)) {
        process.stdout.write("restarted 0\n")
      }
      return
    }

    if (options.explicitPort) {
      runningInstances = runningInstances.filter((entry) => entry.port === options.port)
      if (runningInstances.length === 0) {
        if (isJsonMode(options)) {
          printJson({ restartedCount: 0, results: restarted })
        }
        if (showOutput) {
          logStatus("warning", `no AX Code Desktop instance found on port ${options.port}`)
          clackOutro("nothing to restart")
        } else if (isQuietMode(options)) {
          process.stdout.write("restarted 0\n")
        }
        return
      }
    }

    for (const instance of runningInstances) {
      const storedOptions = readInstanceOptions(instance.instanceFilePath) || { port: instance.port }
      const launchMode = instance.launchMode || "daemon"
      const isForeground = launchMode === "foreground"

      const restartPort = options.explicitPort ? options.port : instance.port

      const restartSpin = showOutput ? createSpinner(options) : null
      if (showOutput && !restartSpin) {
        logStatus("info", `restarting port ${instance.port}`, `mode: ${launchMode}`)
      }
      restartSpin?.start(`Restarting AX Code Desktop on port ${instance.port}...`)
      try {
        await this.stop({
          explicitPort: true,
          port: instance.port,
          quiet: true,
          suppressQuietOutput: true,
        })

        // Foreground instances are managed by a process manager (systemd,
        // Docker, etc.) that will restart them automatically after stop.
        // Do not call serve() here — just record the stop as a successful
        // restart and let the process manager handle the actual restart.
        if (isForeground) {
          restarted.push({ fromPort: instance.port, toPort: restartPort, launchMode, ok: true })
          restartSpin?.stop(`Stopped foreground instance on port ${instance.port} (process manager will restart)`)
          if (showOutput && !restartSpin) {
            logStatus("success", `port ${instance.port} stopped`, "process manager will restart")
          }
          continue
        }

        await new Promise((resolve) => setTimeout(resolve, 500))

        const restartedPort = await this.serve({
          port: restartPort,
          host: storedOptions.host,
          explicitPort: true,
          uiPassword: options.explicitUiPassword ? options.uiPassword : storedOptions.uiPassword,
          suppressStartupSummary: true,
          quiet: true,
          suppressUiPasswordWarning: true,
          suppressQuietOutput: true,
        })
        restarted.push({ fromPort: instance.port, toPort: restartedPort, launchMode, ok: true })
        restartSpin?.stop(`Restarted AX Code Desktop on port ${restartedPort}`)
        if (showOutput && !restartSpin) {
          logStatus("success", `port ${restartedPort} restarted`, `mode: ${launchMode}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        restartSpin?.error(`Failed to restart AX Code Desktop on port ${instance.port}`)
        if (showOutput && !restartSpin) {
          logStatus("error", `failed to restart port ${instance.port}`, message)
        }
        throw error
      }
    }

    if (isJsonMode(options)) {
      printJson({
        restartedCount: restarted.length,
        results: restarted.map((r) => ({ ...r, launchMode: r.launchMode })),
      })
      return
    }

    if (showOutput) {
      clackOutro(`${runningInstances.length} instance(s) restarted`)
    } else if (isQuietMode(options)) {
      process.stdout.write(`restarted ${restarted.length}\n`)
    }
  },

  async status(options = {}) {
    const [runningInstances, desktopInstance] = await Promise.all([
      discoverRunningInstances(),
      discoverDesktopInstance(),
    ])

    const toPasswordProtectionLabel = (value) => {
      if (value === true) return "yes"
      if (value === false) return "no"
      return "unknown"
    }

    const desktopOnly =
      desktopInstance && !runningInstances.some((entry) => entry.port === desktopInstance.port)
        ? {
            runtime: "desktop",
            port: desktopInstance.port,
            pid: Number.isFinite(desktopInstance.pid) ? desktopInstance.pid : null,
            launchMode: null,
            passwordProtected: null,
          }
        : null

    const cliInstances = runningInstances.map((instance) => {
      const storedOptions = readInstanceOptions(instance.instanceFilePath) || {}
      const passwordProtected =
        storedOptions.hasUiPassword === true ||
        (typeof storedOptions.uiPassword === "string" && storedOptions.uiPassword.trim().length > 0)

      return {
        runtime: "cli",
        port: instance.port,
        pid: instance.pid,
        launchMode: instance.launchMode || "daemon",
        passwordProtected,
      }
    })

    const instances = desktopOnly ? [...cliInstances, desktopOnly] : cliInstances
    const runningCount = instances.length

    if (isJsonMode(options)) {
      printJson({
        state: runningCount > 0 ? "running" : "stopped",
        runningCount,
        instances,
      })
      return
    }

    if (isQuietMode(options)) {
      if (runningCount === 0) {
        process.stdout.write("stopped\n")
        return
      }

      for (const instance of instances) {
        process.stdout.write(
          `port ${instance.port} mode:${instance.launchMode || "n/a"} pass:${toPasswordProtectionLabel(instance.passwordProtected)}\n`,
        )
      }
      return
    }

    clackIntro("AX Code Desktop Status")

    if (runningCount === 0) {
      logStatus("warning", "stopped")
      clackOutro("no running instances")
      return
    }

    for (const instance of instances) {
      const pidSuffix = Number.isFinite(instance.pid) ? ` (PID: ${instance.pid})` : ""
      const modeDetail = instance.launchMode ? `mode: ${instance.launchMode}` : ""
      const protectionDetail = `password: ${toPasswordProtectionLabel(instance.passwordProtected)}`
      const detail = modeDetail ? `${modeDetail}; ${protectionDetail}` : protectionDetail
      if (instance.runtime === "desktop") {
        logStatus("info", `desktop app on port ${instance.port}${pidSuffix}`, detail)
      } else {
        logStatus("success", `port ${instance.port}${pidSuffix}`, detail)
      }
    }

    clackOutro(`${runningCount} running runtime(s)`)
  },

  async tunnel(options = {}, action = "status") {
    const normalizedAction = typeof action === "string" ? action.trim().toLowerCase() : "status"
    if (!["start", "status", "stop", "providers"].includes(normalizedAction)) {
      throw new CliError(
        `Unknown tunnel subcommand '${action}'. Use 'ax-code-desktop tunnel --help'.`,
        EXIT_CODE.USAGE_ERROR,
      )
    }

    const manager = createCliTunnelManager()
    const showOutput = shouldRenderHumanOutput(options)

    if (normalizedAction === "providers") {
      const result = {
        providers: [
          {
            id: TUNNEL_PROVIDER_CLOUDFLARE,
            modes: [TUNNEL_MODE_QUICK],
            dependency: "cloudflared",
          },
        ],
      }
      if (isJsonMode(options)) {
        printJson(result)
        return
      }
      if (isQuietMode(options)) {
        process.stdout.write(`${TUNNEL_PROVIDER_CLOUDFLARE} modes:${TUNNEL_MODE_QUICK} dependency:cloudflared\n`)
        return
      }
      clackIntro("AX Code Desktop Tunnel Providers")
      logStatus("success", "cloudflare", "quick mode via cloudflared")
      clackOutro("provider list complete")
      return
    }

    if (normalizedAction === "status") {
      let tunnels = manager.listTunnels()
      if (options.explicitPort) {
        tunnels = tunnels.filter((entry) => entry.port === options.port)
      }
      if (isJsonMode(options)) {
        printJson({
          state: tunnels.length > 0 ? "running" : "stopped",
          runningCount: tunnels.length,
          tunnels,
        })
        return
      }
      if (isQuietMode(options)) {
        if (tunnels.length === 0) {
          process.stdout.write("stopped\n")
          return
        }
        for (const tunnel of tunnels) {
          process.stdout.write(`port ${tunnel.port} ${tunnel.provider}:${tunnel.mode} ${tunnel.url}\n`)
        }
        return
      }
      clackIntro("AX Code Desktop Tunnel Status")
      if (tunnels.length === 0) {
        logStatus("warning", "stopped")
        clackOutro("no active tunnels")
        return
      }
      for (const tunnel of tunnels) {
        logStatus("success", `port ${tunnel.port}`, `${tunnel.url}`)
        logStatus("info", "log", tunnel.logPath)
      }
      clackOutro(`${tunnels.length} active tunnel(s)`)
      return
    }

    if (normalizedAction === "stop") {
      let tunnels = manager.listTunnels()
      if (options.explicitPort) {
        const byPort = manager.getTunnel(options.port)
        tunnels = byPort ? [byPort] : []
      }

      const results = []
      for (const tunnel of tunnels) {
        results.push(await manager.stopTunnel({ port: tunnel.port }))
      }
      if (options.explicitPort && tunnels.length === 0) {
        results.push({ port: options.port, stopped: false, reason: "not-running" })
      }

      if (isJsonMode(options)) {
        printJson({
          stoppedCount: results.filter((entry) => entry.stopped).length,
          results,
        })
        return
      }
      if (isQuietMode(options)) {
        if (results.length === 0) {
          process.stdout.write("none\n")
          return
        }
        for (const result of results) {
          process.stdout.write(
            result.stopped ? `stopped ${result.port}\n` : `not-running ${result.port} ${result.reason || ""}\n`,
          )
        }
        return
      }
      clackIntro("AX Code Desktop Tunnel Stop")
      if (results.length === 0) {
        logStatus("info", "No active tunnels found")
        clackOutro("nothing to stop")
        return
      }
      for (const result of results) {
        logStatus(result.stopped ? "success" : "warning", `port ${result.port}`, result.reason || undefined)
      }
      clackOutro("stop complete")
      return
    }

    const { provider, mode } = resolveTunnelProviderAndMode(options)
    const dependency = manager.checkDependency({ provider })
    if (!dependency.ok) {
      throw new CliError(dependency.message, EXIT_CODE.MISSING_DEPENDENCY)
    }
    const target = await resolveTunnelTarget(options, this)
    const targetPort = target.port
    assertSafeBrowserPort(targetPort, { context: "AX Code Desktop tunnel" })
    await assertTunnelTargetProtected(targetPort)

    const startSpin = showOutput ? createSpinner(options) : null
    if (showOutput && !startSpin) {
      clackIntro("AX Code Desktop Tunnel Start")
      logStatus("info", `target`, buildTunnelOriginUrl(targetPort))
    }
    startSpin?.start(`Starting Cloudflare tunnel for port ${targetPort}...`)
    let tunnel
    try {
      tunnel = await manager.startTunnel({
        port: targetPort,
        originUrl: buildTunnelOriginUrl(targetPort),
        provider,
        mode,
        force: options.force,
      })
    } catch (error) {
      if (target.started) {
        await this.stop({
          explicitPort: true,
          port: targetPort,
          quiet: true,
          suppressQuietOutput: true,
        }).catch(() => undefined)
      }
      throw error
    }
    startSpin?.stop(`Cloudflare tunnel started: ${tunnel.url}`)

    if (isJsonMode(options)) {
      printJson({
        ok: true,
        tunnel,
      })
      return tunnel
    }
    if (isQuietMode(options)) {
      process.stdout.write(`${tunnel.url}\n`)
      return tunnel
    }
    if (showOutput) {
      logStatus("success", "public URL", tunnel.url)
      logStatus("info", "log", tunnel.logPath)
      clackOutro("tunnel running")
    }
    return tunnel
  },

  async logs(options) {
    const showFrames = shouldRenderHumanOutput(options)
    const shouldPrefixLines = options.all || !showFrames
    let targets = []
    const running = await discoverRunningInstances()

    if (options.all) {
      targets = running
      if (targets.length === 0) {
        throw new Error("No running AX Code Desktop instance found.")
      }
    } else if (options.explicitPort) {
      const found = running.find((entry) => entry.port === options.port)
      if (!found) {
        throw new Error(`No running AX Code Desktop instance found on port ${options.port}.`)
      }
      targets = [found]
    } else {
      const latest = getLatestInstance(running)
      if (!latest) {
        throw new Error("No running AX Code Desktop instance found.")
      }
      targets = [latest]
      if (shouldRenderHumanOutput(options)) {
        logStatus("info", `no port specified; using latest started instance on port ${latest.port}`)
      }
    }

    if (isJsonMode(options)) {
      if (options.follow) {
        throw new Error("`ax-code-desktop logs --json` requires `--no-follow` for deterministic JSON output.")
      }
      const entries = targets.map((target) => {
        const logPath = getLogFilePath(target.port)
        return {
          port: target.port,
          logPath,
          lines: readTailLines(logPath, options.lines),
        }
      })
      printJson({ entries })
      return
    }

    if (showFrames) {
      clackIntro("AX Code Desktop Logs")
    }

    for (const target of targets) {
      const logPath = getLogFilePath(target.port)
      const lines = readTailLines(logPath, options.lines)
      if (showFrames) {
        logStatus("info", `port ${target.port}`, logPath)
      }

      for (const line of lines) {
        if (shouldPrefixLines) {
          console.log(`[${target.port}] ${line}`)
        } else {
          console.log(line)
        }
      }
    }

    if (showFrames) {
      clackOutro(options.follow ? "following (Ctrl+C to stop)" : "tail complete")
    }

    if (!options.follow) {
      return
    }

    const unsubs = targets.map((target) => {
      const logPath = getLogFilePath(target.port)
      return followFile(logPath, (line) => {
        if (shouldPrefixLines) {
          console.log(`[${target.port}] ${line}`)
        } else {
          console.log(line)
        }
      })
    })

    await new Promise((resolve) => {
      const onSignal = () => {
        for (const unsub of unsubs) {
          unsub()
        }
        process.off("SIGINT", onSignal)
        process.off("SIGTERM", onSignal)
        resolve()
      }
      process.on("SIGINT", onSignal)
      process.on("SIGTERM", onSignal)
    })
  },

  async startup(options, action = "status") {
    const normalized = typeof action === "string" ? action.trim().toLowerCase() : "status"
    if (!["status", "enable", "disable"].includes(normalized)) {
      throw new CliError(
        `Unknown startup subcommand '${action}'. Use 'ax-code-desktop startup --help'.`,
        EXIT_CODE.USAGE_ERROR,
      )
    }

    let status
    if (normalized === "enable") {
      status = enableStartupService(options)
    } else if (normalized === "disable") {
      status = disableStartupService()
    } else {
      status = getStartupStatus()
    }

    const result = { action: normalized, ...status }
    if (!result.supported) {
      throw new CliError(`Startup integration is not supported on ${result.platform}.`, EXIT_CODE.USAGE_ERROR)
    }
    if (normalized === "enable" && result.activeState === "failed") {
      throw new CliError(
        "Startup service was installed but failed to start. Run `journalctl --user -u ax-code-desktop.service -n 80 --no-pager` for details.",
        EXIT_CODE.GENERAL_ERROR,
      )
    }
    if (isJsonMode(options)) {
      printJson(result)
      return
    }

    if (isQuietMode(options)) {
      process.stdout.write(
        `startup ${result.enabled ? "enabled" : "disabled"} platform:${result.platform} supported:${result.supported ? "yes" : "no"}${result.servicePath ? ` path:${result.servicePath}` : ""}\n`,
      )
      return
    }

    clackIntro("AX Code Desktop Startup")
    logStatus(
      result.enabled ? "success" : "info",
      `startup ${result.enabled ? "enabled" : "disabled"}`,
      result.servicePath || undefined,
    )
    if (typeof result.activeState === "string") {
      logStatus(
        result.active ? "success" : result.activeState === "failed" ? "error" : "warning",
        `service ${result.activeState}`,
      )
    }
    if (normalized === "enable") {
      logStatus("info", "service command", "ax-code-desktop serve --foreground")
    }
    clackOutro(normalized === "status" ? "status complete" : `${normalized} complete`)
  },

  async update(options = {}) {
    const showOutput = shouldRenderHumanOutput(options)
    const updateSpin = createSpinner(options)

    const currentVersion = typeof PACKAGE_JSON.version === "string" ? PACKAGE_JSON.version : "unknown"

    if (showOutput) {
      clackIntro("AX Code Desktop Update")
    }

    if (showOutput && !updateSpin) {
      logStatus("info", `current version: ${currentVersion}`)
    }

    updateSpin?.start("Checking update status...")
    if (isJsonMode(options)) {
      printJson({
        currentVersion,
        latestVersion: currentVersion,
        updated: false,
      })
      return
    }
    if (showOutput && !updateSpin) {
      logStatus("success", "you are running the latest version")
    }
    updateSpin?.stop("Already up to date")
    if (showOutput) {
      clackOutro("no update needed")
    } else if (isQuietMode(options)) {
      process.stdout.write(`up-to-date ${currentVersion}\n`)
    }
  },
}

async function main() {
  const parsed = parseArgs()
  const {
    command,
    subcommand,
    startupAction,
    tunnelAction,
    options,
    removedFlagErrors,
    helpRequested,
    versionRequested,
  } = parsed
  activeCommandOptions = options

  if (versionRequested) {
    if (isJsonMode(options)) {
      printJson({ version: PACKAGE_JSON.version })
    } else {
      console.log(PACKAGE_JSON.version)
    }
    return
  }

  if (removedFlagErrors.length > 0) {
    if (isJsonMode(options)) {
      printJson({
        status: "error",
        error: {
          message: removedFlagErrors[0],
          details: removedFlagErrors,
        },
      })
    } else {
      for (const error of removedFlagErrors) {
        console.error(`Error: ${error}`)
      }
    }
    process.exit(1)
  }

  if (helpRequested) {
    if (command === "startup") {
      showStartupHelp()
    } else if (command === "tunnel") {
      showTunnelHelp()
    } else {
      showHelp()
    }
    return
  }

  if (command === "startup") {
    await commands.startup(options, startupAction)
    return
  }

  if (command === "tunnel") {
    await commands.tunnel(options, tunnelAction)
    return
  }

  if (!commands[command]) {
    const knownCommands = ["serve", "stop", "restart", "status", "tunnel", "startup", "logs", "update"]
    const suggestion = findClosestMatch(command, knownCommands)
    const hint = suggestion ? ` Did you mean '${suggestion}'?` : ""
    if (isJsonMode(options)) {
      printJson({
        status: "error",
        error: {
          message: `Unknown command '${command}'.${hint}`,
        },
        messages: [{ level: "info", code: "USAGE_HELP", message: "Use --help to see available commands" }],
      })
    } else {
      console.error(`Error: Unknown command '${command}'.${hint}`)
      console.error("Use --help to see available commands")
    }
    process.exit(EXIT_CODE.USAGE_ERROR)
  }

  await commands[command](options)
}

const isCliExecution = isModuleCliExecution(process.argv[1], import.meta.url, fs.realpathSync, "ax-code-desktop")

if (isCliExecution) {
  let isHandlingSigint = false
  process.on("SIGINT", () => {
    if (isHandlingSigint) {
      return
    }
    if (foregroundServerActive) {
      if (typeof foregroundShutdown === "function") {
        void foregroundShutdown("SIGINT")
      }
      return
    }
    isHandlingSigint = true
    ;(async () => {
      clackCancel("Operation cancelled.")
      if (onCancelCleanup) {
        try {
          await onCancelCleanup()
        } catch {
        } finally {
          setCancelCleanup(null)
        }
      }
      process.exit(130)
    })()
  })

  process.on("unhandledRejection", (reason, promise) => {
    if (isJsonMode(activeCommandOptions)) {
      printJson({
        status: "error",
        error: {
          message: `Unhandled rejection: ${String(reason)}`,
        },
      })
    } else {
      console.error("Unhandled Rejection at:", promise, "reason:", reason)
    }
    process.exit(1)
  })

  process.on("uncaughtException", (error) => {
    if (isJsonMode(activeCommandOptions)) {
      printJson({
        status: "error",
        error: {
          message: `Uncaught exception: ${error instanceof Error ? error.message : String(error)}`,
        },
      })
    } else {
      console.error("Uncaught Exception:", error)
    }
    process.exit(1)
  })

  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    if (isJsonMode(activeCommandOptions)) {
      printJson({
        status: "error",
        error: {
          message,
        },
      })
    } else if (process.stdout?.isTTY && !HAS_PLAIN_FLAG) {
      clackIntro(boldText("Error"))
      logStatus("error", message)
      clackOutro("failed")
    } else {
      console.error(`Error: ${message}`)
    }
    const exitCode = error instanceof CliError ? error.exitCode : EXIT_CODE.GENERAL_ERROR
    process.exit(exitCode)
  })
}

export {
  commands,
  parseArgs,
  hasUiPasswordConfigured,
  readDesktopLocalPortFromSettings,
  getPidFilePath,
  fetchSystemInfoFromPort,
  discoverRunningInstances,
  resolveAvailablePort,
  findClosestMatch,
  buildTunnelServeOptions,
  resolveTunnelProviderAndMode,
  CliError,
  EXIT_CODE,
}
