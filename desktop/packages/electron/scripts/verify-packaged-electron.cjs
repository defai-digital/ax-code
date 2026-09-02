"use strict"

const crypto = require("node:crypto")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const asar = require("@electron/asar")
const { NtExecutable, NtExecutableResource } = require("resedit")

const FUSE_SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX")
const FUSE_ENABLED = 49
const FUSE_DISABLED = 48
const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"])
const UNPACKED_NATIVE_EXTENSIONS = new Set([".dll", ".dylib", ".exe", ".node", ".so"])
const EXTERNAL_CODE_ROOTS = new Set(["ax-code", "ax-computer"])
const REQUIRED_ASAR_FILES = [
  "package.json",
  "dist/main.js",
  "dist/preload.js",
  "dist/server-process.js",
  "dist/server.js",
  "dist/desktop-cli.mjs",
  "dist/ax-code-runtime-manifest.json",
  "web-dist/index.html",
]
const EXPECTED_FUSES = [
  { index: 0, name: "RunAsNode", state: FUSE_ENABLED },
  { index: 1, name: "EnableCookieEncryption", state: FUSE_ENABLED },
  { index: 2, name: "EnableNodeOptionsEnvironmentVariable", state: FUSE_DISABLED },
  { index: 3, name: "EnableNodeCliInspectArguments", state: FUSE_DISABLED },
  { index: 4, name: "EnableEmbeddedAsarIntegrityValidation", state: FUSE_ENABLED },
  { index: 5, name: "OnlyLoadAppFromAsar", state: FUSE_ENABLED },
  { index: 7, name: "GrantFileProtocolExtraPrivileges", state: FUSE_DISABLED },
  // AX Code's renderer uses WebAssembly. Electron 42 adds this ninth fuse and
  // ships it enabled; verify it remains enabled even though electron-builder's
  // current FuseOptionsV1 schema does not expose it yet.
  { index: 8, name: "WasmTrapHandlers", state: FUSE_ENABLED },
]

function isJavaScript(filePath) {
  return JAVASCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function walkFiles(root, relative = "") {
  if (!fs.existsSync(root)) return []
  const directory = path.join(root, relative)
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = relative ? path.join(relative, entry.name) : entry.name
    if (entry.isDirectory()) result.push(...walkFiles(root, child))
    else if (entry.isFile()) result.push(child)
  }
  return result
}

function findLooseJavaScript(resourcesPath) {
  const result = []
  const visit = (relative = "") => {
    const directory = path.join(resourcesPath, relative)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = relative ? path.join(relative, entry.name) : entry.name
      const topLevel = child.split(path.sep)[0]
      if (entry.isDirectory()) {
        if (!EXTERNAL_CODE_ROOTS.has(topLevel)) visit(child)
      } else if (entry.isFile() && isJavaScript(child)) {
        result.push(child.split(path.sep).join("/"))
      }
    }
  }
  visit()
  return result.sort()
}

function findUnexpectedUnpackedFiles(resourcesPath) {
  const unpackedRoot = path.join(resourcesPath, "app.asar.unpacked")
  return walkFiles(unpackedRoot)
    .filter(
      (relativePath) =>
        !UNPACKED_NATIVE_EXTENSIONS.has(path.extname(relativePath).toLowerCase()) &&
        path.basename(relativePath) !== "spawn-helper",
    )
    .map((relativePath) => relativePath.split(path.sep).join("/"))
    .sort()
}

function asarEntry(header, relativePath) {
  let current = header
  for (const segment of relativePath.split("/")) {
    current = current?.files?.[segment]
    if (!current) return null
  }
  return current
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex")
}

function assertPackedFileIntegrity(rawHeader, archivePath, relativePath) {
  const entry = asarEntry(rawHeader.header, relativePath)
  if (!entry || typeof entry.size !== "number") throw new Error(`app.asar is missing ${relativePath}`)
  if (entry.unpacked) throw new Error(`app.asar unexpectedly unpacks ${relativePath}`)
  const integrity = entry.integrity
  if (
    integrity?.algorithm !== "SHA256" ||
    !/^[a-f0-9]{64}$/.test(integrity?.hash || "") ||
    !Number.isSafeInteger(integrity?.blockSize) ||
    integrity.blockSize <= 0 ||
    !Array.isArray(integrity?.blocks) ||
    integrity.blocks.length === 0
  ) {
    throw new Error(`app.asar has no SHA256 block integrity for ${relativePath}`)
  }

  const contents = asar.extractFile(archivePath, relativePath)
  if (contents.length !== entry.size || sha256(contents) !== integrity.hash) {
    throw new Error(`app.asar content does not match SHA256 integrity for ${relativePath}`)
  }
  const blocks = []
  if (contents.length === 0) {
    blocks.push(sha256(contents))
  } else {
    for (let offset = 0; offset < contents.length; offset += integrity.blockSize) {
      blocks.push(sha256(contents.subarray(offset, offset + integrity.blockSize)))
    }
  }
  if (blocks.length !== integrity.blocks.length || blocks.some((hash, index) => hash !== integrity.blocks[index])) {
    throw new Error(`app.asar content does not match SHA256 blocks for ${relativePath}`)
  }
}

function verifyAsarLayout(resourcesPath) {
  const archivePath = path.join(resourcesPath, "app.asar")
  if (!fs.existsSync(archivePath)) throw new Error(`Packaged app is missing app.asar: ${archivePath}`)
  if (fs.existsSync(path.join(resourcesPath, "web-dist"))) {
    throw new Error(`Renderer assets must not remain outside app.asar: ${path.join(resourcesPath, "web-dist")}`)
  }

  const files = asar.listPackage(archivePath, { isPack: false }).map((entry) => entry.replace(/^\/+/, ""))
  const fileSet = new Set(files)
  for (const required of REQUIRED_ASAR_FILES) {
    if (!fileSet.has(required)) throw new Error(`app.asar is missing ${required}`)
  }
  const rendererJavaScript = files.filter(
    (entry) => entry.startsWith("web-dist/") && JAVASCRIPT_EXTENSIONS.has(path.posix.extname(entry).toLowerCase()),
  )
  if (rendererJavaScript.length === 0) throw new Error("app.asar contains no renderer JavaScript")

  const javascript = files.filter(isJavaScript)
  const rawHeader = asar.getRawHeader(archivePath)
  for (const required of new Set([...REQUIRED_ASAR_FILES, ...javascript])) {
    assertPackedFileIntegrity(rawHeader, archivePath, required)
  }

  const looseJavaScript = findLooseJavaScript(resourcesPath)
  if (looseJavaScript.length > 0) {
    throw new Error(`Packaged Electron resources contain loose JavaScript: ${looseJavaScript.join(", ")}`)
  }
  const unexpectedUnpacked = findUnexpectedUnpackedFiles(resourcesPath)
  if (unexpectedUnpacked.length > 0) {
    throw new Error(`app.asar.unpacked contains non-native files: ${unexpectedUnpacked.join(", ")}`)
  }

  return {
    archivePath,
    files: files.length,
    javascript: javascript.length,
    rendererJavaScript: rendererJavaScript.length,
  }
}

function computeAsarHeaderHash(archivePath) {
  return crypto.createHash("sha256").update(asar.getRawHeader(archivePath).headerString).digest("hex")
}

function parseJson(contents, description) {
  try {
    return JSON.parse(contents)
  } catch (error) {
    throw new Error(`${description} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readMacAsarIntegrity(appPath, { execFile = execFileSync } = {}) {
  const infoPath = path.join(appPath, "Contents", "Info.plist")
  const output = execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-", infoPath], { encoding: "utf8" })
  const info = parseJson(output, `Electron Info.plist at ${infoPath}`)
  return info?.ElectronAsarIntegrity?.["Resources/app.asar"]
}

function readWindowsAsarIntegrity(appPath) {
  const executable = NtExecutable.from(fs.readFileSync(appPath), { ignoreCert: true })
  const resources = NtExecutableResource.from(executable)
  const entries = resources.entries.filter((entry) => entry.type === "INTEGRITY" && entry.id === "ELECTRONASAR")
  if (entries.length !== 1) {
    throw new Error(`Electron executable must contain exactly one ELECTRONASAR integrity resource: ${appPath}`)
  }
  const contents = Buffer.from(entries[0].bin).toString("utf8").replace(/\0+$/u, "")
  const integrityList = parseJson(contents, `ELECTRONASAR resource in ${appPath}`)
  if (!Array.isArray(integrityList)) throw new Error(`ELECTRONASAR resource is not a list: ${appPath}`)
  const record = integrityList.find(
    (entry) =>
      typeof entry?.file === "string" && entry.file.replaceAll("\\", "/").toLowerCase() === "resources/app.asar",
  )
  return record ? { algorithm: record.alg, hash: record.value } : undefined
}

function assertAsarIntegrityAnchor(record, expectedHash, description) {
  if (String(record?.algorithm).toUpperCase() !== "SHA256" || record?.hash !== expectedHash) {
    throw new Error(`${description} does not bind app.asar to its SHA256 header hash`)
  }
}

function verifyAsarIntegrityAnchor(appPath, platform, archivePath, options = {}) {
  const headerHash = computeAsarHeaderHash(archivePath)
  if (platform === "linux") {
    // Electron does not implement embedded ASAR integrity on Linux. AppImage's
    // read-only SquashFS, root-owned deb installs, and release signatures are
    // the platform trust boundary; still require per-file ASAR block hashes.
    return { status: "platform-unsupported", headerHash }
  }
  const record =
    platform === "darwin"
      ? readMacAsarIntegrity(appPath, options)
      : (options.readWindowsIntegrity || readWindowsAsarIntegrity)(appPath)
  assertAsarIntegrityAnchor(record, headerHash, `${platform} Electron integrity metadata`)
  return { status: "verified", headerHash }
}

function verifyRuntimeManifestBinding(resourcesPath, archivePath) {
  const runtimeRoot = path.join(resourcesPath, "ax-code")
  const hasRuntime =
    fs.existsSync(path.join(runtimeRoot, "package.json")) &&
    (fs.existsSync(path.join(runtimeRoot, "bin", "ax-code")) ||
      fs.existsSync(path.join(runtimeRoot, "bin", "ax-code.cmd")))
  const embedded = asar.extractFile(archivePath, "dist/ax-code-runtime-manifest.json")
  if (!hasRuntime) {
    let marker
    try {
      marker = JSON.parse(embedded.toString("utf8"))
    } catch {
      throw new Error("Placeholder build has an invalid embedded runtime integrity marker")
    }
    if (marker?.schema !== "ax-code.runtime-manifest.placeholder.v1") {
      throw new Error("Placeholder build must contain the runtime integrity marker")
    }
    return { status: "placeholder" }
  }

  const externalPath = path.join(runtimeRoot, "runtime-manifest.json")
  if (!fs.existsSync(externalPath)) throw new Error(`Packaged ax-code runtime is missing ${externalPath}`)
  const external = fs.readFileSync(externalPath)
  if (!embedded.equals(external)) {
    throw new Error("Embedded and external ax-code runtime manifests do not match")
  }
  return { status: "bound" }
}

function parseFuseWires(buffer) {
  const wires = []
  let cursor = 0
  while (cursor < buffer.length) {
    const sentinelIndex = buffer.indexOf(FUSE_SENTINEL, cursor)
    if (sentinelIndex === -1) break
    const wireStart = sentinelIndex + FUSE_SENTINEL.length
    if (wireStart + 2 > buffer.length) throw new Error("Electron fuse wire header is truncated")
    const version = buffer[wireStart]
    const length = buffer[wireStart + 1]
    const stateStart = wireStart + 2
    const stateEnd = stateStart + length
    if (stateEnd > buffer.length) throw new Error("Electron fuse wire is truncated")
    wires.push({ version, states: [...buffer.subarray(stateStart, stateEnd)] })
    cursor = stateEnd
  }
  return wires
}

function resolveFuseBinary(appPath, platform) {
  if (platform === "darwin") {
    return path.join(appPath, "Contents", "Frameworks", "Electron Framework.framework", "Electron Framework")
  }
  return appPath
}

function verifyElectronFuses(appPath, platform) {
  const binaryPath = resolveFuseBinary(appPath, platform)
  const wires = parseFuseWires(fs.readFileSync(binaryPath))
  if (wires.length === 0) throw new Error(`Electron fuse sentinel is missing: ${binaryPath}`)
  for (const [wireIndex, wire] of wires.entries()) {
    if (wire.version !== 1) throw new Error(`Unsupported Electron fuse wire version ${wire.version}: ${binaryPath}`)
    for (const expected of EXPECTED_FUSES) {
      const actual = wire.states[expected.index]
      if (actual !== expected.state) {
        const expectedLabel = expected.state === FUSE_ENABLED ? "enabled" : "disabled"
        throw new Error(
          `Electron fuse ${expected.name} must be ${expectedLabel} (wire ${wireIndex + 1}, found ${String(actual)})`,
        )
      }
    }
  }
  return { binaryPath, wires: wires.length }
}

function packagePlatform(args) {
  const matches = []
  if (args.some((arg) => arg === "--mac" || arg === "-m" || arg.startsWith("--mac="))) matches.push("darwin")
  if (args.some((arg) => arg === "--win" || arg === "-w" || arg.startsWith("--win="))) matches.push("win32")
  if (args.some((arg) => arg === "--linux" || arg === "-l" || arg.startsWith("--linux="))) matches.push("linux")
  if (matches.length !== 1) throw new Error("Packaging must select exactly one of --mac, --win, or --linux")
  return matches[0]
}

function packageArch(args, env = process.env, hostArch = process.arch) {
  for (const arch of ["arm64", "x64", "ia32", "universal"]) {
    if (args.includes(`--${arch}`) || args.includes(`--arch=${arch}`)) return arch
  }
  return String(env.ELECTRON_BUILDER_ARCH || hostArch)
}

function resolvePackagedTarget(
  args,
  { electronDir = path.resolve(__dirname, ".."), env = process.env, hostArch = process.arch } = {},
) {
  const platform = packagePlatform(args)
  const arch = packageArch(args, env, hostArch)
  let outputDirectory
  let appPath
  if (platform === "darwin") {
    outputDirectory = arch === "x64" ? "mac" : `mac-${arch}`
    appPath = path.join(electronDir, "dist", outputDirectory, "AX Code.app")
  } else if (platform === "win32") {
    outputDirectory = arch === "x64" ? "win-unpacked" : `win-${arch}-unpacked`
    appPath = path.join(electronDir, "dist", outputDirectory, "AX Code.exe")
  } else {
    outputDirectory = arch === "x64" ? "linux-unpacked" : `linux-${arch}-unpacked`
    appPath = path.join(electronDir, "dist", outputDirectory, "ax-code-desktop")
  }
  return { appPath, arch, platform }
}

function resourcesPathFor(appPath, platform) {
  return platform === "darwin"
    ? path.join(appPath, "Contents", "Resources")
    : path.join(path.dirname(appPath), "resources")
}

function verifyPackagedElectron(target) {
  if (!fs.existsSync(target.appPath)) throw new Error(`Packaged Electron application is missing: ${target.appPath}`)
  const resourcesPath = resourcesPathFor(target.appPath, target.platform)
  const asarResult = verifyAsarLayout(resourcesPath)
  const runtimeManifest = verifyRuntimeManifestBinding(resourcesPath, asarResult.archivePath)
  const fuseResult = verifyElectronFuses(target.appPath, target.platform)
  const asarIntegrity = verifyAsarIntegrityAnchor(target.appPath, target.platform, asarResult.archivePath)
  return { ...target, asar: asarResult, asarIntegrity, fuses: fuseResult, runtimeManifest }
}

function runCli(args = process.argv.slice(2)) {
  const target = resolvePackagedTarget(args)
  const result = verifyPackagedElectron(target)
  console.log(
    `[verify-packaged-electron] ${result.platform}-${result.arch}: ${result.asar.javascript} JS files in app.asar ` +
      `(${result.asar.rendererJavaScript} renderer), 0 loose Electron JS, ${result.fuses.wires} fuse wire(s), ` +
      `ASAR anchor ${result.asarIntegrity.status}`,
  )
  return result
}

if (require.main === module) {
  try {
    runCli()
  } catch (error) {
    console.error(`[verify-packaged-electron] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

module.exports = {
  EXPECTED_FUSES,
  EXTERNAL_CODE_ROOTS,
  FUSE_DISABLED,
  FUSE_ENABLED,
  FUSE_SENTINEL,
  REQUIRED_ASAR_FILES,
  assertPackedFileIntegrity,
  assertAsarIntegrityAnchor,
  computeAsarHeaderHash,
  findLooseJavaScript,
  findUnexpectedUnpackedFiles,
  packageArch,
  packagePlatform,
  parseFuseWires,
  resolveFuseBinary,
  resolvePackagedTarget,
  resourcesPathFor,
  readMacAsarIntegrity,
  readWindowsAsarIntegrity,
  runCli,
  verifyAsarLayout,
  verifyAsarIntegrityAnchor,
  verifyElectronFuses,
  verifyPackagedElectron,
  verifyRuntimeManifestBinding,
  walkFiles,
}
