import { afterEach, describe, expect, test } from "vitest"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const asar = require("@electron/asar")
const { NtExecutable, NtExecutableResource } = require("resedit")
const {
  EXPECTED_FUSES,
  FUSE_SENTINEL,
  assertAsarIntegrityAnchor,
  findLooseJavaScript,
  findUnexpectedUnpackedFiles,
  parseFuseWires,
  readMacAsarIntegrity,
  readWindowsAsarIntegrity,
  resolvePackagedTarget,
  verifyAsarIntegrityAnchor,
  verifyAsarLayout,
  verifyElectronFuses,
} = require("./verify-packaged-electron.cjs")

const tempDirs = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function makeTempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ax-packaged-electron-"))
  tempDirs.push(directory)
  return directory
}

function fuseBinary(overrides = {}) {
  const states = Array.from({ length: 9 }, () => 49)
  for (const expected of EXPECTED_FUSES) states[expected.index] = expected.state
  for (const [index, state] of Object.entries(overrides)) states[Number(index)] = state
  return Buffer.concat([
    Buffer.from("prefix"),
    FUSE_SENTINEL,
    Buffer.from([1, states.length, ...states]),
    Buffer.from("suffix"),
  ])
}

async function makeAsarResources() {
  const root = makeTempDir()
  const source = path.join(root, "source")
  const resources = path.join(root, "resources")
  const files = {
    "package.json": "{}\n",
    "dist/main.js": "main\n",
    "dist/preload.js": "preload\n",
    "dist/server-process.js": "server process\n",
    "dist/server.js": "server\n",
    "dist/desktop-cli.mjs": "cli\n",
    "dist/ax-code-runtime-manifest.json":
      '{"schema":"ax-code.runtime-manifest.placeholder.v1","reason":"runtime-not-staged"}\n',
    "web-dist/index.html": "<html></html>\n",
    "web-dist/assets/app.js": "renderer\n",
  }
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(source, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, contents)
  }
  fs.mkdirSync(resources, { recursive: true })
  await asar.createPackage(source, path.join(resources, "app.asar"))
  return { resources, root }
}

function makeWindowsExecutable(integrityList) {
  const executablePath = path.join(makeTempDir(), "AX Code.exe")
  const executable = NtExecutable.createEmpty(false, false)
  const resources = NtExecutableResource.from(executable)
  resources.entries.push({
    type: "INTEGRITY",
    id: "ELECTRONASAR",
    lang: 1033,
    codepage: 65001,
    bin: Buffer.from(JSON.stringify(integrityList)),
  })
  resources.outputResource(executable)
  fs.writeFileSync(executablePath, Buffer.from(executable.generate()))
  return executablePath
}

describe("packaged Electron integrity verification", () => {
  test("resolves release output paths for all supported platforms", () => {
    const electronDir = path.join(path.sep, "workspace", "desktop", "packages", "electron")
    expect(resolvePackagedTarget(["--mac", "--arm64"], { electronDir }).appPath).toBe(
      path.join(electronDir, "dist", "mac-arm64", "AX Code.app"),
    )
    expect(resolvePackagedTarget(["--win", "--x64"], { electronDir }).appPath).toBe(
      path.join(electronDir, "dist", "win-unpacked", "AX Code.exe"),
    )
    expect(resolvePackagedTarget(["--linux", "--arm64"], { electronDir }).appPath).toBe(
      path.join(electronDir, "dist", "linux-arm64-unpacked", "ax-code-desktop"),
    )
  })

  test("parses and verifies the explicit fuse policy", () => {
    const root = makeTempDir()
    const executable = path.join(root, "AX Code.exe")
    fs.writeFileSync(executable, fuseBinary())

    expect(parseFuseWires(fs.readFileSync(executable))).toHaveLength(1)
    expect(verifyElectronFuses(executable, "win32").wires).toBe(1)

    fs.writeFileSync(executable, fuseBinary({ 4: 48 }))
    expect(() => verifyElectronFuses(executable, "win32")).toThrow(
      "EnableEmbeddedAsarIntegrityValidation must be enabled",
    )
  })

  test("allows only explicitly external sidecars to contain loose JavaScript", () => {
    const resources = makeTempDir()
    fs.mkdirSync(path.join(resources, "ax-code", "lib"), { recursive: true })
    fs.writeFileSync(path.join(resources, "ax-code", "lib", "index-node-tui.js"), "sidecar\n")
    fs.mkdirSync(path.join(resources, "app.asar.unpacked"), { recursive: true })
    fs.writeFileSync(path.join(resources, "app.asar.unpacked", "wrapper.js"), "loose\n")

    expect(findLooseJavaScript(resources)).toEqual(["app.asar.unpacked/wrapper.js"])
  })

  test("allows only native binaries and helpers outside app.asar", () => {
    const resources = makeTempDir()
    const unpacked = path.join(resources, "app.asar.unpacked", "node_modules", "node-pty")
    fs.mkdirSync(unpacked, { recursive: true })
    fs.writeFileSync(path.join(unpacked, "pty.node"), "native")
    fs.writeFileSync(path.join(unpacked, "spawn-helper"), "native helper")
    expect(findUnexpectedUnpackedFiles(resources)).toEqual([])

    fs.writeFileSync(path.join(unpacked, "README.md"), "unexpected")
    expect(findUnexpectedUnpackedFiles(resources)).toEqual(["node_modules/node-pty/README.md"])
  })

  test("requires renderer JavaScript and block integrity inside app.asar", async () => {
    const { resources } = await makeAsarResources()
    const result = verifyAsarLayout(resources)

    expect(result.rendererJavaScript).toBe(1)
    expect(result.javascript).toBeGreaterThanOrEqual(5)
    const header = asar.getRawHeader(path.join(resources, "app.asar"))
    expect(crypto.createHash("sha256").update(header.headerString).digest("hex")).toMatch(/^[a-f0-9]{64}$/)
  })

  test("rejects ASAR data that does not match its block integrity", async () => {
    const { resources } = await makeAsarResources()
    const archivePath = path.join(resources, "app.asar")
    const rawHeader = asar.getRawHeader(archivePath)
    const entry = rawHeader.header.files["web-dist"].files.assets.files["app.js"]
    const offset = 8 + rawHeader.headerSize + Number(entry.offset)
    const descriptor = fs.openSync(archivePath, "r+")
    try {
      const byte = Buffer.alloc(1)
      fs.readSync(descriptor, byte, 0, 1, offset)
      byte[0] ^= 0xff
      fs.writeSync(descriptor, byte, 0, 1, offset)
    } finally {
      fs.closeSync(descriptor)
    }

    expect(() => verifyAsarLayout(resources)).toThrow(
      "app.asar content does not match SHA256 integrity for web-dist/assets/app.js",
    )
  })

  test("rejects renderer assets or Electron JavaScript outside app.asar", async () => {
    const { resources } = await makeAsarResources()
    fs.mkdirSync(path.join(resources, "web-dist"), { recursive: true })
    fs.writeFileSync(path.join(resources, "web-dist", "app.js"), "loose renderer\n")

    expect(() => verifyAsarLayout(resources)).toThrow("Renderer assets must not remain outside app.asar")
  })

  test("validates macOS and Windows ASAR integrity anchors", async () => {
    const { resources } = await makeAsarResources()
    const archivePath = path.join(resources, "app.asar")
    const linux = verifyAsarIntegrityAnchor("unused", "linux", archivePath)
    expect(linux).toMatchObject({ status: "platform-unsupported" })

    const record = { algorithm: "SHA256", hash: linux.headerHash }
    expect(
      readMacAsarIntegrity("/Applications/AX Code.app", {
        execFile: () => JSON.stringify({ ElectronAsarIntegrity: { "Resources/app.asar": record } }),
      }),
    ).toEqual(record)
    expect(() => assertAsarIntegrityAnchor(record, linux.headerHash, "test anchor")).not.toThrow()
    expect(() =>
      assertAsarIntegrityAnchor({ algorithm: "sha256", hash: linux.headerHash }, linux.headerHash, "test anchor"),
    ).not.toThrow()
    expect(() => assertAsarIntegrityAnchor(record, "0".repeat(64), "test anchor")).toThrow("does not bind app.asar")

    const executablePath = makeWindowsExecutable([
      { file: "resources\\app.asar", alg: "SHA256", value: linux.headerHash },
    ])
    expect(readWindowsAsarIntegrity(executablePath)).toEqual(record)
  })
})
