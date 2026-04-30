#!/usr/bin/env bun
/**
 * Smoke-test the source npm distribution from the same staged tarball layout
 * that publish-source.ts creates.
 *
 * This intentionally installs the tarball into a temporary npm prefix instead
 * of running the unpacked package directly. Direct tar extraction skips npm's
 * dependency installation and postinstall steps, which makes OpenTUI native
 * package resolution look broken even though the real user install path works.
 */
import { $ } from "bun"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "../package.json"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(dir, "../..")
const args = new Set(process.argv.slice(2))

const packageName = process.env.AX_CODE_INSTALL_SMOKE_PACKAGE ?? "@defai.digital/ax-code"
const expectedVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const keepTemp = args.has("--keep-temp") || args.has("--manual-first-prompt")
const decoder = new TextDecoder()

function commandDisplay(command: string[]) {
  return command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ")
}

async function fail(message: string): Promise<never> {
  console.error(`source-install-smoke: ${message}`)
  process.exit(1)
}

function decodeOutput(value: string | Uint8Array | undefined) {
  if (typeof value === "string") return value
  if (!value) return ""
  return decoder.decode(value)
}

function installedPackageDir(root: string, name: string) {
  return path.join(root, "node_modules", ...name.split("/"))
}

async function collectAndMirror(stream: ReadableStream<Uint8Array> | null | undefined, write: (chunk: string) => void) {
  if (!stream) return ""

  const streamDecoder = new TextDecoder()
  const reader = stream.getReader()
  let output = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = streamDecoder.decode(value, { stream: true })
    output += chunk
    write(chunk)
  }

  const finalChunk = streamDecoder.decode()
  if (finalChunk) {
    output += finalChunk
    write(finalChunk)
  }

  return output
}

async function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
) {
  console.log(`source-install-smoke: running ${commandDisplay(command)}`)
  const result = Bun.spawn(command, {
    cwd: options.cwd ?? dir,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdoutPromise = collectAndMirror(result.stdout, (chunk) => process.stdout.write(chunk))
  const stderrPromise = collectAndMirror(result.stderr, (chunk) => process.stderr.write(chunk))
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise =
    options.timeoutMs === undefined
      ? undefined
      : new Promise<"timeout">((resolve) => {
          timeout = setTimeout(() => {
            result.kill("SIGTERM")
            resolve("timeout")
          }, options.timeoutMs)
        })

  const exitOrTimeout = timeoutPromise ? await Promise.race([result.exited, timeoutPromise]) : await result.exited
  if (timeout) clearTimeout(timeout)

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  if (exitOrTimeout === "timeout") {
    await fail(`${commandDisplay(command)} timed out after ${options.timeoutMs}ms`)
  }
  const exitCode = exitOrTimeout
  if (exitCode !== 0) await fail(`${commandDisplay(command)} exited with ${exitCode}`)
  return stdout + stderr
}

const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ax-code-source-install-smoke."))
const installDir = path.join(tempRoot, "install")
const npmCache = path.join(tempRoot, "npm-cache")
const debugDir = path.join(tempRoot, "first-prompt-debug")

try {
  await fs.promises.mkdir(installDir, { recursive: true })
  await fs.promises.mkdir(npmCache, { recursive: true })

  await run(["bun", "run", "script/publish-source.ts"], {
    cwd: dir,
    env: {
      AX_CODE_DRY_RUN: "1",
      AX_CODE_SOURCE_PACKAGE_NAMES: packageName,
      NPM_CONFIG_CACHE: npmCache,
    },
  })

  const stageDir = path.join(dir, "dist-source", "package")
  const tarballs = (await fs.promises.readdir(stageDir)).filter((name) => name.endsWith(".tgz")).sort()
  if (tarballs.length !== 1) {
    await fail(`expected exactly one staged tarball in ${stageDir}, found ${tarballs.length}`)
  }

  const tarball = path.join(stageDir, tarballs[0]!)
  await run(
    [
      "npm",
      "install",
      tarball,
      "--prefix",
      installDir,
      "--foreground-scripts",
      "--loglevel=verbose",
      "--fetch-timeout=30000",
      "--fetch-retries=1",
    ],
    {
      cwd: dir,
      env: { NPM_CONFIG_CACHE: npmCache },
      timeoutMs: 120_000,
    },
  )

  const binName = process.platform === "win32" ? "ax-code.cmd" : "ax-code"
  const axCodeBin = path.join(installDir, "node_modules", ".bin", binName)
  const versionOutput = await run([axCodeBin, "--version"], { cwd: repoRoot })
  const version = versionOutput.trim().replace(/^v/, "")
  if (version !== expectedVersion) {
    await fail(`expected installed ax-code --version to be ${expectedVersion}, got ${versionOutput.trim()}`)
  }

  const bunPathFile = path.join(installedPackageDir(installDir, packageName), "bin", ".ax-code-bun-path")
  await fs.promises.writeFile(bunPathFile, path.join(tempRoot, "missing-bun") + "\n")
  const staleCacheVersionOutput = await run([axCodeBin, "--version"], { cwd: repoRoot })
  const staleCacheVersion = staleCacheVersionOutput.trim().replace(/^v/, "")
  if (staleCacheVersion !== expectedVersion) {
    await fail(
      `expected installed ax-code --version to fall back from a stale bun path and report ${expectedVersion}, got ${staleCacheVersionOutput.trim()}`,
    )
  }

  const doctorOutput = await run([axCodeBin, "doctor"], { cwd: repoRoot })
  if (!/Runtime: Bun .*\((bun-bundled|source)\)/.test(doctorOutput)) {
    await fail("installed ax-code doctor did not report bun-bundled/source runtime")
  }

  const handshake =
    await $`printf '{"type":"rpc.request","method":"health","id":1}\n' | ${axCodeBin} tui-backend --stdio`
      .cwd(repoRoot)
      .quiet()
      .nothrow()
  const handshakeOutput = decodeOutput(handshake.stdout) + decodeOutput(handshake.stderr)
  process.stdout.write(handshakeOutput)
  if (handshake.exitCode !== 0) {
    await fail(`installed backend stdio handshake exited with ${handshake.exitCode}`)
  }
  if (!/"type":"rpc.result".*"id":1/.test(handshakeOutput)) {
    await fail("installed backend did not return rpc health result")
  }
  if (!/"runtimeMode":"(bun-bundled|source)"/.test(handshakeOutput)) {
    await fail("installed backend did not report bun-bundled/source runtime")
  }

  console.log("source-install-smoke: installed source package smoke passed")

  if (args.has("--manual-first-prompt")) {
    console.log("")
    console.log("Manual first-prompt gate:")
    console.log(`  ${axCodeBin} --debug --debug-dir ${debugDir} --print-logs`)
    console.log("  Type a short prompt, wait for /prompt_async and a model reply, then press Ctrl-C.")
    console.log(`  Temp install kept at ${tempRoot}`)
  }
} finally {
  if (!keepTemp) {
    await fs.promises.rm(tempRoot, { recursive: true, force: true })
  }
}
