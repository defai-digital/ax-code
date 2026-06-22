import { execFile, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { mergePathValues } from "./path-utils.js"

export const createAxCodeEnvRuntime = (deps) => {
  const { state, normalizeDirectoryPath, readSettingsFromDiskMigrated, ENV_CONFIGURED_AX_CODE_WSL_DISTRO } = deps

  const parseNullSeparatedEnvSnapshot = (raw) => {
    if (typeof raw !== "string" || raw.length === 0) {
      return null
    }

    const result = {}
    const entries = raw.split("\0")
    for (const entry of entries) {
      if (!entry) {
        continue
      }
      const idx = entry.indexOf("=")
      if (idx <= 0) {
        continue
      }
      const key = entry.slice(0, idx)
      const value = entry.slice(idx + 1)
      result[key] = value
    }

    return Object.keys(result).length > 0 ? result : null
  }

  const isExecutable = (filePath) => {
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) return false
      if (process.platform === "win32") {
        const ext = path.extname(filePath).toLowerCase()
        if (!ext) return true
        return [".exe", ".cmd", ".bat", ".com"].includes(ext)
      }
      fs.accessSync(filePath, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  const resolveWindowsExecutablePath = (candidate) => {
    if (process.platform !== "win32" || typeof candidate !== "string" || candidate.trim().length === 0) {
      return candidate
    }

    const trimmed = candidate.trim()
    const ext = path.extname(trimmed).toLowerCase()
    if (ext) {
      return isExecutable(trimmed) ? trimmed : null
    }

    const pathExt = process.env.PATHEXT || process.env.PathExt || ".COM;.EXE;.BAT;.CMD"
    for (const rawExt of pathExt.split(";")) {
      const normalizedExt = rawExt.trim()
      if (!normalizedExt) continue
      const withExt = `${trimmed}${normalizedExt.startsWith(".") ? normalizedExt : `.${normalizedExt}`}`
      if (isExecutable(withExt)) {
        return withExt
      }
    }

    return isExecutable(trimmed) ? trimmed : null
  }

  const searchPathFor = (binaryName) => {
    const trimmed = typeof binaryName === "string" ? binaryName.trim() : ""
    if (!trimmed) {
      return null
    }

    const current = process.env.PATH || ""
    const parts = current.split(path.delimiter).filter(Boolean)
    const candidateNames = []

    if (process.platform === "win32" && !path.extname(trimmed)) {
      const pathExt = process.env.PATHEXT || process.env.PathExt || ".COM;.EXE;.BAT;.CMD"
      for (const ext of pathExt.split(";")) {
        const normalizedExt = ext.trim()
        if (!normalizedExt) continue
        const candidateName = `${trimmed}${normalizedExt.startsWith(".") ? normalizedExt : `.${normalizedExt}`}`
        if (!candidateNames.some((existing) => existing.toLowerCase() === candidateName.toLowerCase())) {
          candidateNames.push(candidateName)
        }
      }
    }

    candidateNames.push(trimmed)

    for (const dir of parts) {
      for (const candidateName of candidateNames) {
        const candidate = path.join(dir, candidateName)
        if (isExecutable(candidate)) {
          return candidate
        }
      }
    }
    return null
  }

  const prependToPath = (dir) => {
    const trimmed = typeof dir === "string" ? dir.trim() : ""
    if (!trimmed) return
    const current = process.env.PATH || ""
    const parts = current.split(path.delimiter).filter(Boolean)
    if (parts.includes(trimmed)) return
    process.env.PATH = [trimmed, ...parts].join(path.delimiter)
  }

  const getWindowsShellEnvSnapshot = () => {
    const parseResult = (stdout) => parseNullSeparatedEnvSnapshot(typeof stdout === "string" ? stdout : "")

    const psScript =
      "Get-ChildItem Env: | ForEach-Object { [Console]::Out.Write($_.Name); [Console]::Out.Write('='); [Console]::Out.Write($_.Value); [Console]::Out.Write([char]0) }"

    const powershellCandidates = [
      "pwsh.exe",
      "powershell.exe",
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ]

    for (const shellPath of powershellCandidates) {
      try {
        const result = spawnSync(shellPath, ["-NoLogo", "-Command", psScript], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        })
        if (result.status !== 0) {
          continue
        }
        const parsed = parseResult(result.stdout)
        if (parsed) {
          return parsed
        }
      } catch {}
    }

    const comspec = process.env.ComSpec || "cmd.exe"
    try {
      const result = spawnSync(comspec, ["/d", "/s", "/c", "set"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      })
      if (result.status === 0 && typeof result.stdout === "string" && result.stdout.length > 0) {
        return parseNullSeparatedEnvSnapshot(result.stdout.replace(/\r?\n/g, "\0"))
      }
    } catch {}

    return null
  }

  const getLoginShellEnvSnapshot = () => {
    if (state.cachedLoginShellEnvSnapshot !== undefined) {
      return state.cachedLoginShellEnvSnapshot
    }

    if (process.platform === "win32") {
      const windowsSnapshot = getWindowsShellEnvSnapshot()
      state.cachedLoginShellEnvSnapshot = windowsSnapshot
      return windowsSnapshot
    }

    const shellCandidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean)

    for (const shellPath of shellCandidates) {
      if (!isExecutable(shellPath)) {
        continue
      }

      try {
        const result = spawnSync(shellPath, ["-lic", "env -0"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        })

        if (result.status !== 0) {
          continue
        }

        const parsed = parseNullSeparatedEnvSnapshot(result.stdout || "")
        if (parsed) {
          state.cachedLoginShellEnvSnapshot = parsed
          return parsed
        }
      } catch {}
    }

    state.cachedLoginShellEnvSnapshot = null
    return null
  }

  const applyLoginShellEnvSnapshot = () => {
    const snapshot = getLoginShellEnvSnapshot()
    if (!snapshot) {
      return
    }

    const skipKeys = new Set(["PWD", "OLDPWD", "SHLVL", "_"])
    for (const [key, value] of Object.entries(snapshot)) {
      if (skipKeys.has(key)) {
        continue
      }
      const existing = process.env[key]
      if (typeof existing === "string" && existing.length > 0) {
        continue
      }
      process.env[key] = value
    }

    const currentPath = process.env.PATH || ""
    const shellPath = snapshot.PATH || ""
    if (!shellPath) {
      return
    }

    process.env.PATH = mergePathValues(shellPath, currentPath, path.delimiter)
  }

  /**
   * Non-blocking equivalent of applyLoginShellEnvSnapshot().
   * Uses execFile (async) instead of spawnSync so the event loop is
   * not blocked during the shell spawn (~200 ms–1 s on macOS/Linux).
   * The result is cached, so subsequent synchronous calls to
   * getLoginShellEnvSnapshot() return the already-computed snapshot.
   */
  const ensureLoginShellEnvSnapshotAsync = async () => {
    if (state.cachedLoginShellEnvSnapshot !== undefined) {
      return
    }

    if (process.platform === "win32") {
      // Windows env capture is already synchronous and fast
      applyLoginShellEnvSnapshot()
      return
    }

    const shellCandidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean)

    for (const shellPath of shellCandidates) {
      if (!isExecutable(shellPath)) {
        continue
      }

      try {
        const stdout = await new Promise((resolve, reject) => {
          execFile(
            shellPath,
            ["-lic", "env -0"],
            {
              encoding: "utf8",
              maxBuffer: 10 * 1024 * 1024,
              windowsHide: true,
            },
            (error, stdout) => {
              if (error) {
                reject(error)
              } else {
                resolve(stdout || "")
              }
            },
          )
        })

        const parsed = parseNullSeparatedEnvSnapshot(stdout)
        if (parsed) {
          state.cachedLoginShellEnvSnapshot = parsed
          // Apply the snapshot to process.env
          applyLoginShellEnvSnapshot()
          return
        }
      } catch {
        // Try next shell candidate
      }
    }

    state.cachedLoginShellEnvSnapshot = null
  }

  const isWslExecutableValue = (value) => {
    if (typeof value !== "string") return false
    const trimmed = value.trim()
    if (!trimmed) return false
    return /(^|[\\/])wsl(\.exe)?$/i.test(trimmed)
  }

  const clearWslAxCodeResolution = () => {
    state.useWslForAxCode = false
    state.resolvedWslBinary = null
    state.resolvedWslAxCodePath = null
    state.resolvedWslDistro = null
  }

  const resolveWslExecutablePath = () => {
    if (process.platform !== "win32") {
      return null
    }

    const explicit = [process.env.WSL_BINARY, process.env.AX_CODE_DESKTOP_WSL_BINARY]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)

    for (const candidate of explicit) {
      if (isExecutable(candidate)) {
        return candidate
      }
    }

    try {
      const result = spawnSync("where", ["wsl"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
      if (result.status === 0) {
        const lines = (result.stdout || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        const found = lines.find((line) => isExecutable(line))
        if (found) {
          return found
        }
      }
    } catch {}

    const systemRoot = process.env.SystemRoot || "C:\\Windows"
    const fallback = path.join(systemRoot, "System32", "wsl.exe")
    if (isExecutable(fallback)) {
      return fallback
    }

    return null
  }

  const buildWslExecArgs = (execArgs, distroOverride = null) => {
    const distro =
      typeof distroOverride === "string" && distroOverride.trim().length > 0
        ? distroOverride.trim()
        : ENV_CONFIGURED_AX_CODE_WSL_DISTRO

    const prefix = distro ? ["-d", distro] : []
    return [...prefix, "--exec", ...execArgs]
  }

  const probeWslForAxCode = () => {
    if (process.platform !== "win32") {
      return null
    }

    const wslBinary = resolveWslExecutablePath()
    if (!wslBinary) {
      return null
    }

    try {
      const result = spawnSync(wslBinary, buildWslExecArgs(["sh", "-lc", "command -v ax-code"]), {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 6000,
        windowsHide: true,
      })

      if (result.status !== 0) {
        return null
      }

      const lines = (result.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const found = lines[0] || ""
      if (!found) {
        return null
      }

      return {
        wslBinary,
        axCodePath: found,
        distro: ENV_CONFIGURED_AX_CODE_WSL_DISTRO,
      }
    } catch {
      return null
    }
  }

  const applyWslAxCodeResolution = ({ wslBinary, axCodePath, source = "wsl", distro = null } = {}) => {
    const resolvedWsl = wslBinary || resolveWslExecutablePath()
    if (!resolvedWsl) {
      return null
    }

    state.useWslForAxCode = true
    state.resolvedWslBinary = resolvedWsl
    state.resolvedWslAxCodePath =
      typeof axCodePath === "string" && axCodePath.trim().length > 0 ? axCodePath.trim() : "ax-code"
    state.resolvedWslDistro =
      typeof distro === "string" && distro.trim().length > 0 ? distro.trim() : ENV_CONFIGURED_AX_CODE_WSL_DISTRO
    state.resolvedAxCodeBinary = `wsl:${state.resolvedWslAxCodePath}`
    state.resolvedAxCodeBinarySource = source

    delete process.env.AX_CODE_BINARY
    return state.resolvedAxCodeBinary
  }

  const resolveAxCodeCliPath = () => {
    const explicit = [
      process.env.AX_CODE_BINARY,
      process.env.AX_CODE_PATH,
      process.env.AX_CODE_DESKTOP_AX_CODE_PATH,
      process.env.AX_CODE_DESKTOP_AX_CODE_BIN,
    ]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)

    for (const candidate of explicit) {
      if (isExecutable(candidate)) {
        clearWslAxCodeResolution()
        state.resolvedAxCodeBinarySource = "env"
        return candidate
      }
    }

    const resolvedFromPath = searchPathFor("ax-code")
    if (resolvedFromPath) {
      clearWslAxCodeResolution()
      state.resolvedAxCodeBinarySource = "path"
      return resolvedFromPath
    }

    const home = os.homedir()
    const unixFallbacks = [
      path.join(home, ".ax-code", "bin", "ax-code"),
      path.join(home, ".bun", "bin", "ax-code"),
      path.join(home, ".local", "bin", "ax-code"),
      path.join(home, "bin", "ax-code"),
      "/opt/homebrew/bin/ax-code",
      "/usr/local/bin/ax-code",
      "/usr/bin/ax-code",
      "/bin/ax-code",
    ]

    const winFallbacks = (() => {
      const userProfile = process.env.USERPROFILE || home
      const appData = process.env.APPDATA || ""
      const localAppData = process.env.LOCALAPPDATA || ""
      const programData = process.env.ProgramData || "C:\\ProgramData"

      return [
        path.join(userProfile, ".ax-code", "bin", "ax-code.exe"),
        path.join(userProfile, ".ax-code", "bin", "ax-code.cmd"),
        path.join(appData, "npm", "ax-code.cmd"),
        path.join(userProfile, "scoop", "shims", "ax-code.cmd"),
        path.join(programData, "chocolatey", "bin", "ax-code.exe"),
        path.join(programData, "chocolatey", "bin", "ax-code.cmd"),
        path.join(userProfile, ".bun", "bin", "ax-code.exe"),
        path.join(userProfile, ".bun", "bin", "ax-code.cmd"),
        localAppData ? path.join(localAppData, "Programs", "ax-code", "ax-code.exe") : "",
      ].filter(Boolean)
    })()

    const fallbacks = process.platform === "win32" ? winFallbacks : unixFallbacks
    for (const candidate of fallbacks) {
      if (isExecutable(candidate)) {
        clearWslAxCodeResolution()
        state.resolvedAxCodeBinarySource = "fallback"
        return candidate
      }
    }

    if (process.platform === "win32") {
      try {
        const result = spawnSync("where", ["ax-code"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        if (result.status === 0) {
          const lines = (result.stdout || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
          const found = lines.find((line) => isExecutable(line))
          if (found) {
            clearWslAxCodeResolution()
            state.resolvedAxCodeBinarySource = "where"
            return found
          }
        }
      } catch {}
      const wsl = probeWslForAxCode()
      if (wsl) {
        return applyWslAxCodeResolution({
          wslBinary: wsl.wslBinary,
          axCodePath: wsl.axCodePath,
          source: "wsl",
          distro: wsl.distro,
        })
      }
      return null
    }

    const shells = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean)
    for (const shell of shells) {
      if (!isExecutable(shell)) continue
      try {
        const result = spawnSync(shell, ["-lic", "command -v ax-code"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        if (result.status === 0) {
          const found = (result.stdout || "").trim().split(/\s+/).pop() || ""
          if (found && isExecutable(found)) {
            clearWslAxCodeResolution()
            state.resolvedAxCodeBinarySource = "shell"
            return found
          }
        }
      } catch {}
    }

    return null
  }

  const resolveNodeCliPath = () => {
    const explicit = [process.env.NODE_BINARY, process.env.AX_CODE_DESKTOP_NODE_BINARY]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)

    for (const candidate of explicit) {
      if (isExecutable(candidate)) {
        return candidate
      }
    }

    const resolvedFromPath = searchPathFor("node")
    if (resolvedFromPath) {
      return resolvedFromPath
    }

    const unixFallbacks = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node", "/bin/node"]
    for (const candidate of unixFallbacks) {
      if (isExecutable(candidate)) {
        return candidate
      }
    }

    if (process.platform === "win32") {
      try {
        const result = spawnSync("where", ["node"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        if (result.status === 0) {
          const lines = (result.stdout || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
          const found = lines.find((line) => isExecutable(line))
          if (found) return found
        }
      } catch {}
      return null
    }

    const shells = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean)
    for (const shell of shells) {
      if (!isExecutable(shell)) continue
      try {
        const result = spawnSync(shell, ["-lic", "command -v node"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        if (result.status === 0) {
          const found = (result.stdout || "").trim().split(/\s+/).pop() || ""
          if (found && isExecutable(found)) {
            return found
          }
        }
      } catch {}
    }

    return null
  }

  const resolveBunCliPath = () => {
    const explicit = [process.env.BUN_BINARY, process.env.AX_CODE_DESKTOP_BUN_BINARY]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)

    for (const candidate of explicit) {
      if (isExecutable(candidate)) {
        return candidate
      }
    }

    const resolvedFromPath = searchPathFor("bun")
    if (resolvedFromPath) {
      return resolvedFromPath
    }

    const home = os.homedir()
    const unixFallbacks = [
      path.join(home, ".bun", "bin", "bun"),
      "/opt/homebrew/bin/bun",
      "/usr/local/bin/bun",
      "/usr/bin/bun",
      "/bin/bun",
    ]
    for (const candidate of unixFallbacks) {
      if (isExecutable(candidate)) {
        return candidate
      }
    }

    if (process.platform === "win32") {
      const userProfile = process.env.USERPROFILE || home
      const winFallbacks = [
        path.join(userProfile, ".bun", "bin", "bun.exe"),
        path.join(userProfile, ".bun", "bin", "bun.cmd"),
      ]
      for (const candidate of winFallbacks) {
        if (isExecutable(candidate)) return candidate
      }

      try {
        const result = spawnSync("where", ["bun"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        if (result.status === 0) {
          const lines = (result.stdout || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
          const found = lines.find((line) => isExecutable(line))
          if (found) return found
        }
      } catch {}
      return null
    }

    const shells = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean)
    for (const shell of shells) {
      if (!isExecutable(shell)) continue
      try {
        const result = spawnSync(shell, ["-lic", "command -v bun"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })
        if (result.status === 0) {
          const found = (result.stdout || "").trim().split(/\s+/).pop() || ""
          if (found && isExecutable(found)) {
            return found
          }
        }
      } catch {}
    }

    return null
  }

  const ensureBunCliEnv = () => {
    if (state.resolvedBunBinary) {
      return state.resolvedBunBinary
    }

    const resolved = resolveBunCliPath()
    if (resolved) {
      prependToPath(path.dirname(resolved))
      state.resolvedBunBinary = resolved
      return resolved
    }

    return null
  }

  const ensureNodeCliEnv = () => {
    if (state.resolvedNodeBinary) {
      return state.resolvedNodeBinary
    }

    const resolved = resolveNodeCliPath()
    if (resolved) {
      prependToPath(path.dirname(resolved))
      state.resolvedNodeBinary = resolved
      return resolved
    }

    return null
  }

  const WINDOWS_BATCH_EXTENSIONS = new Set([".cmd", ".bat", ".com"])

  const normalizeExecutableCandidate = (value) => {
    if (typeof value !== "string") {
      return null
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    if (process.platform === "win32") {
      return resolveWindowsExecutablePath(trimmed)
    }
    return isExecutable(trimmed) ? trimmed : null
  }

  const getWindowsNativeAxCodePackageNames = () => {
    if (process.arch === "arm64") {
      return ["ax-code-windows-arm64"]
    }
    if (process.arch === "x64") {
      // Prefer the baseline build when bypassing package-manager wrappers so the
      // direct binary still runs on hosts without AVX2 support.
      return ["ax-code-windows-x64-baseline", "ax-code-windows-x64"]
    }
    return []
  }

  const resolveNativeAxCodeBinaryFromNodeModules = (nodeModulesDir) => {
    if (typeof nodeModulesDir !== "string" || nodeModulesDir.trim().length === 0) {
      return null
    }

    const packageShim = path.join(nodeModulesDir, "ax-code-ai", "bin", "ax-code.exe")
    if (isExecutable(packageShim)) {
      return packageShim
    }

    for (const packageName of getWindowsNativeAxCodePackageNames()) {
      const candidates = [
        path.join(nodeModulesDir, packageName, "bin", "ax-code.exe"),
        path.join(nodeModulesDir, "ax-code-ai", "node_modules", packageName, "bin", "ax-code.exe"),
      ]
      for (const candidate of candidates) {
        if (isExecutable(candidate)) {
          return candidate
        }
      }
    }

    return null
  }

  const resolveAxCodeNodeLaunchSpecFromNodeModules = (nodeModulesDir) => {
    if (typeof nodeModulesDir !== "string" || nodeModulesDir.trim().length === 0) {
      return null
    }

    const launcher = path.join(nodeModulesDir, "ax-code-ai", "bin", "ax-code")
    if (!isExecutable(launcher) && !fs.existsSync(launcher)) {
      return null
    }

    const nodeBinary = ensureNodeCliEnv() || resolveNodeCliPath() || "node"
    return {
      binary: nodeBinary,
      args: [launcher],
      wrapperType: "node-launcher",
    }
  }

  const resolveNodeModulesDirFromCmdWrapper = (wrapperPath) => {
    if (!wrapperPath || typeof wrapperPath !== "string") {
      return null
    }

    try {
      const content = fs.readFileSync(wrapperPath, "utf8")
      const launcherMatch = content.match(/node_modules[\\/]+ax-code-ai[\\/]+bin[\\/]+ax-code/i)
      if (!launcherMatch) {
        return null
      }

      const launcherPath = path.resolve(path.dirname(wrapperPath), launcherMatch[0].replace(/\\/g, "/"))
      return path.dirname(path.dirname(path.dirname(launcherPath)))
    } catch {
      return null
    }
  }

  const resolveAxCodeNodeModulesDir = (axCodePath) => {
    if (typeof axCodePath !== "string" || axCodePath.trim().length === 0) {
      return null
    }

    const normalized = path.resolve(axCodePath)
    const lower = normalized.toLowerCase()
    const fileDir = path.dirname(normalized)
    const nodeModulesCandidates = []
    const pushCandidate = (candidate) => {
      if (typeof candidate !== "string" || candidate.trim().length === 0) {
        return
      }
      if (!nodeModulesCandidates.includes(candidate)) {
        nodeModulesCandidates.push(candidate)
      }
    }

    if (lower.includes(`${path.sep}.bun${path.sep}bin${path.sep}ax-code`)) {
      const bunRoot = path.dirname(path.dirname(normalized))
      pushCandidate(path.join(bunRoot, "install", "global", "node_modules"))
    }

    if (
      lower.endsWith(`${path.sep}node_modules${path.sep}.bin${path.sep}ax-code`) ||
      lower.endsWith(`${path.sep}node_modules${path.sep}.bin${path.sep}ax-code.cmd`) ||
      lower.endsWith(`${path.sep}node_modules${path.sep}.bin${path.sep}ax-code.bat`) ||
      lower.endsWith(`${path.sep}node_modules${path.sep}.bin${path.sep}ax-code.exe`)
    ) {
      pushCandidate(path.dirname(fileDir))
    }

    if (lower.endsWith(`${path.sep}node_modules${path.sep}ax-code-ai${path.sep}bin${path.sep}ax-code`)) {
      pushCandidate(path.dirname(path.dirname(fileDir)))
    }

    if (path.basename(fileDir).toLowerCase() === "npm") {
      pushCandidate(path.join(fileDir, "node_modules"))
    }

    if (WINDOWS_BATCH_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
      pushCandidate(resolveNodeModulesDirFromCmdWrapper(normalized))
    }

    for (const candidate of nodeModulesCandidates) {
      if (
        resolveNativeAxCodeBinaryFromNodeModules(candidate) ||
        resolveAxCodeNodeLaunchSpecFromNodeModules(candidate)
      ) {
        return candidate
      }
    }

    return null
  }

  const resolveManagedAxCodeLaunchSpec = (axCodePath) => {
    const fallbackBinary =
      typeof axCodePath === "string" && axCodePath.trim().length > 0 ? axCodePath.trim() : "ax-code"

    if (process.platform !== "win32") {
      return { binary: fallbackBinary, args: [], wrapperType: null }
    }

    const ext = path.extname(fallbackBinary).toLowerCase()
    const candidatePaths = [fallbackBinary]
    if (WINDOWS_BATCH_EXTENSIONS.has(ext)) {
      candidatePaths.push(fallbackBinary.slice(0, -ext.length) + ".exe")
    }

    for (const candidate of candidatePaths) {
      const nodeModulesDir = resolveAxCodeNodeModulesDir(candidate)
      const nativeBinary = resolveNativeAxCodeBinaryFromNodeModules(nodeModulesDir)
      if (nativeBinary) {
        return {
          binary: nativeBinary,
          args: [],
          wrapperType: nativeBinary === fallbackBinary ? null : "native-wrapper",
        }
      }

      const nodeLaunchSpec = resolveAxCodeNodeLaunchSpecFromNodeModules(nodeModulesDir)
      if (nodeLaunchSpec) {
        return nodeLaunchSpec
      }

      const interpreter = axCodeShimInterpreter(candidate)
      if (interpreter === "node") {
        return {
          binary: ensureNodeCliEnv() || resolveNodeCliPath() || "node",
          args: [candidate],
          wrapperType: "node-shebang",
        }
      }
      if (interpreter === "bun") {
        return {
          binary: ensureBunCliEnv() || resolveBunCliPath() || "bun",
          args: [candidate],
          wrapperType: "bun-shebang",
        }
      }

      const directBinary = normalizeExecutableCandidate(candidate)
      if (directBinary) {
        const directExt = path.extname(directBinary).toLowerCase()
        if (WINDOWS_BATCH_EXTENSIONS.has(directExt)) {
          return {
            binary: process.env.ComSpec || "cmd.exe",
            args: ["/d", "/s", "/c", "call", directBinary],
            wrapperType: "cmd-wrapper",
          }
        }

        return {
          binary: directBinary,
          args: [],
          wrapperType: directBinary === fallbackBinary ? null : "executable-wrapper",
        }
      }
    }

    return { binary: fallbackBinary, args: [], wrapperType: null }
  }

  const readShebang = (axCodePath) => {
    if (!axCodePath || typeof axCodePath !== "string") {
      return null
    }
    try {
      const fd = fs.openSync(axCodePath, "r")
      try {
        const buf = Buffer.alloc(256)
        const bytes = fs.readSync(fd, buf, 0, buf.length, 0)
        const head = buf.subarray(0, bytes).toString("utf8")
        const firstLine = head.split(/\r?\n/, 1)[0] || ""
        if (!firstLine.startsWith("#!")) {
          return null
        }
        const shebang = firstLine.slice(2).trim()
        if (!shebang) {
          return null
        }
        return shebang
      } finally {
        try {
          fs.closeSync(fd)
        } catch {}
      }
    } catch {
      return null
    }
  }

  const axCodeShimInterpreter = (axCodePath) => {
    const shebang = readShebang(axCodePath)
    if (!shebang) return null
    if (/\bnode\b/i.test(shebang)) return "node"
    if (/\bbun\b/i.test(shebang)) return "bun"
    return null
  }

  const ensureAxCodeShimRuntime = (axCodePath) => {
    const runtime = axCodeShimInterpreter(axCodePath)
    if (runtime === "node") {
      ensureNodeCliEnv()
    }
    if (runtime === "bun") {
      ensureBunCliEnv()
    }
  }

  const isMacAxCodeAppBundlePath = (candidate) => {
    if (process.platform !== "darwin" || typeof candidate !== "string") {
      return false
    }
    return /\/AX Code\.app\/Contents\/MacOS\/(?:AX Code|ax-code-cli)$/i.test(candidate)
  }

  const createConfiguredAxCodeBinaryError = (raw, normalized) => {
    const configured = typeof raw === "string" ? raw.trim() : ""
    const candidate = typeof normalized === "string" && normalized.trim().length > 0 ? normalized.trim() : configured
    const messageSuffix =
      "AX Code Desktop needs the standalone ax-code CLI. Install it and set settings.axCodeBinary to the CLI path, for example ~/.ax-code/bin/ax-code, or leave the setting empty to use PATH lookup."
    const error = (() => {
      if (isMacAxCodeAppBundlePath(candidate) || isMacAxCodeAppBundlePath(configured)) {
        return new Error(
          `Configured ax-code binary points at the macOS desktop app bundle, not the CLI: ${candidate}. ${messageSuffix}`,
        )
      }

      try {
        const configuredStat = fs.statSync(configured)
        if (configuredStat.isDirectory()) {
          return new Error(
            `Configured AX Code binary directory does not contain an executable ${process.platform === "win32" ? "ax-code.exe" : "ax-code"}: ${configured}. ${messageSuffix}`,
          )
        }
      } catch {}

      try {
        const stat = fs.statSync(candidate)
        if (stat.isDirectory()) {
          return new Error(
            `Configured AX Code binary directory does not contain an executable ${process.platform === "win32" ? "ax-code.exe" : "ax-code"}: ${candidate}. ${messageSuffix}`,
          )
        }
        if (!stat.isFile()) {
          return new Error(`Configured ax-code binary is not a file: ${candidate}. ${messageSuffix}`)
        }
        return new Error(`Configured ax-code binary is not executable: ${candidate}. ${messageSuffix}`)
      } catch {
        return new Error(`Configured ax-code binary not found: ${candidate}. ${messageSuffix}`)
      }
    })()
    error.code = "AX_CODE_BINARY_INVALID"
    return error
  }

  const createConfiguredWslAxCodeError = (raw) =>
    new Error(
      `Configured settings.axCodeBinary uses WSL but AX Code Desktop could not resolve a WSL ax-code command: ${raw}. Ensure WSL is available and ax-code is installed in the configured distro.`,
    )

  const normalizeAxCodeBinarySetting = (raw) => {
    if (typeof raw !== "string") {
      return null
    }
    const trimmed = normalizeDirectoryPath(raw).trim()
    if (!trimmed) {
      return ""
    }

    try {
      const stat = fs.statSync(trimmed)
      if (stat.isDirectory()) {
        const bin = process.platform === "win32" ? "ax-code.exe" : "ax-code"
        return path.join(trimmed, bin)
      }
    } catch {}

    return trimmed
  }

  const applyAxCodeBinaryFromSettings = async (options = {}) => {
    const strict = options?.strict === true
    try {
      const settings = await readSettingsFromDiskMigrated()
      if (!settings || typeof settings !== "object") {
        return null
      }
      if (!Object.prototype.hasOwnProperty.call(settings, "axCodeBinary")) {
        return null
      }

      const normalized = normalizeAxCodeBinarySetting(settings.axCodeBinary)

      if (normalized === "") {
        delete process.env.AX_CODE_BINARY
        state.resolvedAxCodeBinary = null
        state.resolvedAxCodeBinarySource = null
        clearWslAxCodeResolution()
        return null
      }

      const raw = typeof settings.axCodeBinary === "string" ? settings.axCodeBinary.trim() : ""
      const explicitWslPath =
        process.platform === "win32" && typeof raw === "string" ? raw.match(/^wsl:\s*(.+)$/i) : null

      if (explicitWslPath && explicitWslPath[1] && explicitWslPath[1].trim().length > 0) {
        const probe = probeWslForAxCode()
        const applied = applyWslAxCodeResolution({
          wslBinary: probe?.wslBinary || resolveWslExecutablePath(),
          axCodePath: explicitWslPath[1].trim(),
          source: "settings-wsl-path",
          distro: probe?.distro || ENV_CONFIGURED_AX_CODE_WSL_DISTRO,
        })
        if (applied) {
          return applied
        }
        if (strict) {
          throw createConfiguredWslAxCodeError(raw)
        }
      }

      if (process.platform === "win32" && (isWslExecutableValue(raw) || isWslExecutableValue(normalized || ""))) {
        const probe = probeWslForAxCode()
        const applied = applyWslAxCodeResolution({
          wslBinary: probe?.wslBinary || normalized || raw || null,
          axCodePath: probe?.axCodePath || "ax-code",
          source: "settings-wsl",
          distro: probe?.distro || ENV_CONFIGURED_AX_CODE_WSL_DISTRO,
        })
        if (applied) {
          return applied
        }
        if (strict) {
          throw createConfiguredWslAxCodeError(raw)
        }
      }

      if (normalized && isExecutable(normalized) && !isMacAxCodeAppBundlePath(normalized)) {
        clearWslAxCodeResolution()
        process.env.AX_CODE_BINARY = normalized
        prependToPath(path.dirname(normalized))
        state.resolvedAxCodeBinary = normalized
        state.resolvedAxCodeBinarySource = "settings"
        ensureAxCodeShimRuntime(normalized)
        return normalized
      }

      if (raw) {
        if (strict) {
          throw createConfiguredAxCodeBinaryError(raw, normalized)
        }
        console.warn(`Configured settings.axCodeBinary is not executable: ${raw}`)
      }
    } catch (error) {
      if (strict) {
        throw error
      }
    }

    return null
  }

  const ensureAxCodeCliEnv = () => {
    if (state.resolvedAxCodeBinary) {
      if (state.useWslForAxCode) {
        return state.resolvedAxCodeBinary
      }
      ensureAxCodeShimRuntime(state.resolvedAxCodeBinary)
      return state.resolvedAxCodeBinary
    }

    const existing = typeof process.env.AX_CODE_BINARY === "string" ? process.env.AX_CODE_BINARY.trim() : ""
    if (existing && isExecutable(existing)) {
      clearWslAxCodeResolution()
      state.resolvedAxCodeBinary = existing
      state.resolvedAxCodeBinarySource = state.resolvedAxCodeBinarySource || "env"
      prependToPath(path.dirname(existing))
      ensureAxCodeShimRuntime(existing)
      return state.resolvedAxCodeBinary
    }

    const resolved = resolveAxCodeCliPath()
    if (resolved) {
      if (state.useWslForAxCode) {
        state.resolvedAxCodeBinary = resolved
        state.resolvedAxCodeBinarySource = state.resolvedAxCodeBinarySource || "wsl"
        console.log(`Resolved ax-code CLI via WSL: ${state.resolvedWslAxCodePath || "ax-code"}`)
        return resolved
      }

      process.env.AX_CODE_BINARY = resolved
      prependToPath(path.dirname(resolved))
      ensureAxCodeShimRuntime(resolved)
      state.resolvedAxCodeBinary = resolved
      state.resolvedAxCodeBinarySource = state.resolvedAxCodeBinarySource || "unknown"
      console.log(`Resolved ax-code CLI: ${resolved}`)
      return resolved
    }

    clearWslAxCodeResolution()
    return null
  }

  const resolveGitBinaryForSpawn = () => {
    if (process.platform !== "win32") {
      return "git"
    }

    if (state.resolvedGitBinary) {
      return state.resolvedGitBinary
    }

    const explicit = [process.env.GIT_BINARY, process.env.AX_CODE_DESKTOP_GIT_BINARY]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
    for (const candidate of explicit) {
      if (isExecutable(candidate)) {
        state.resolvedGitBinary = candidate
        return state.resolvedGitBinary
      }
    }

    const candidates = []
    const normalizeGitCandidate = (candidate) => {
      if (typeof candidate !== "string") {
        return ""
      }
      const trimmed = candidate.trim()
      if (!trimmed) {
        return ""
      }
      const ext = path.extname(trimmed).toLowerCase()
      if (ext === ".cmd" || ext === ".bat" || ext === ".com") {
        const exeCandidate = trimmed.slice(0, -ext.length) + ".exe"
        if (isExecutable(exeCandidate)) {
          return exeCandidate
        }
      }
      return trimmed
    }

    const pathCandidate = normalizeGitCandidate(searchPathFor("git"))
    if (pathCandidate && isExecutable(pathCandidate)) {
      candidates.push(pathCandidate)
    }

    const pathExeCandidate = normalizeGitCandidate(searchPathFor("git.exe"))
    if (pathExeCandidate && isExecutable(pathExeCandidate)) {
      candidates.push(pathExeCandidate)
    }

    const programRoots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LocalAppData]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
    for (const root of programRoots) {
      const installCandidates = [
        path.join(root, "Git", "cmd", "git.exe"),
        path.join(root, "Git", "bin", "git.exe"),
        path.join(root, "Git", "mingw64", "bin", "git.exe"),
        path.join(root, "Programs", "Git", "cmd", "git.exe"),
        path.join(root, "Programs", "Git", "bin", "git.exe"),
      ]
      for (const candidate of installCandidates) {
        const normalized = normalizeGitCandidate(candidate)
        if (normalized && isExecutable(normalized)) {
          candidates.push(normalized)
        }
      }
    }

    const preferredExe = candidates.find((candidate) => candidate.toLowerCase().endsWith(".exe"))
    state.resolvedGitBinary = preferredExe || candidates[0] || "git.exe"
    return state.resolvedGitBinary
  }

  const clearResolvedAxCodeBinary = () => {
    state.resolvedAxCodeBinary = null
  }

  return {
    applyLoginShellEnvSnapshot,
    ensureLoginShellEnvSnapshotAsync,
    ensureAxCodeCliEnv,
    applyAxCodeBinaryFromSettings,
    getLoginShellEnvSnapshot,
    resolveAxCodeCliPath,
    resolveManagedAxCodeLaunchSpec,
    isExecutable,
    searchPathFor,
    resolveGitBinaryForSpawn,
    resolveWslExecutablePath,
    buildWslExecArgs,
    clearResolvedAxCodeBinary,
  }
}
