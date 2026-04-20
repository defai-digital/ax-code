const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")
const NPM_SCOPE = "@defai.digital"

function normalizePlatform(value = os.platform()) {
  return (
    {
      darwin: "darwin",
      linux: "linux",
      win32: "windows",
    }[value] || value
  )
}

function normalizeArch(value = os.arch()) {
  return (
    {
      x64: "x64",
      arm64: "arm64",
      arm: "arm",
    }[value] || value
  )
}

function supportsAvx2(platform, arch) {
  if (arch !== "x64") return false

  if (platform === "linux") {
    try {
      return /(^|\s)avx2(\s|$)/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"))
    } catch {
      return false
    }
  }

  if (platform === "darwin") {
    try {
      const result = childProcess.spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], {
        encoding: "utf8",
        timeout: 1500,
      })
      if (result.status !== 0) return false
      return (result.stdout || "").trim() === "1"
    } catch {
      return false
    }
  }

  if (platform === "windows") {
    const cmd =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'

    for (const exe of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const result = childProcess.spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        })
        if (result.status !== 0) continue
        const out = (result.stdout || "").trim().toLowerCase()
        if (out === "true" || out === "1") return true
        if (out === "false" || out === "0") return false
      } catch {
        continue
      }
    }
  }

  return false
}

function detectMusl(platform) {
  if (platform !== "linux") return false

  try {
    if (fs.existsSync("/etc/alpine-release")) return true
  } catch {
    // ignore
  }

  try {
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    const text = ((result.stdout || "") + (result.stderr || "")).toLowerCase()
    if (text.includes("musl")) return true
  } catch {
    // ignore
  }

  return false
}

function candidatePackageNames(options = {}) {
  const platform = normalizePlatform(options.platform)
  const arch = normalizeArch(options.arch)
  const base = "ax-code-" + platform + "-" + arch
  const binary = platform === "windows" ? "ax-code.exe" : "ax-code"
  const scoped = (names) => names.map((name) => `${NPM_SCOPE}/${name}`)

  if (platform === "darwin" && arch !== "arm64") {
    return {
      platform,
      arch,
      binary,
      names: [],
      unsupported: "macOS Intel is not supported. ax-code supports macOS arm64 only.",
    }
  }

  const avx2 = options.avx2 ?? supportsAvx2(platform, arch)
  const baseline = arch === "x64" && !avx2

  if (platform === "linux") {
    const musl = options.musl ?? detectMusl(platform)

    if (musl) {
      if (arch === "x64") {
        const names = scoped(
          baseline
          ? [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
          : [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`],
        )
        return { platform, arch, binary, names }
      }
      return { platform, arch, binary, names: scoped([`${base}-musl`, base]) }
    }

    if (arch === "x64") {
      const names = scoped(
        baseline
        ? [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
        : [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`],
      )
      return { platform, arch, binary, names }
    }
    return { platform, arch, binary, names: scoped([base, `${base}-musl`]) }
  }

  if (arch === "x64") {
    return { platform, arch, binary, names: scoped([base]) }
  }

  return { platform, arch, binary, names: scoped([base]) }
}

function findBinary(startDir, options = {}) {
  const { names, binary } = candidatePackageNames(options)
  const fallbackNames = names.map((name) => name.replace(/^@[^/]+\//, ""))
  let current = startDir

  for (;;) {
    const modules = path.join(current, "node_modules")
    if (fs.existsSync(modules)) {
      for (const name of [...names, ...fallbackNames]) {
        const candidate = path.join(modules, name, "bin", binary)
        if (fs.existsSync(candidate)) return candidate
      }
    }

    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

module.exports = {
  candidatePackageNames,
  findBinary,
  normalizeArch,
  normalizePlatform,
}
