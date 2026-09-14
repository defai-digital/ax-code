const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")
const { createRequire } = require("node:module")

// Kill the owned process group on failure so a timed-out Go server cannot
// keep Windows executables locked or outlive the qualification job.
function runProbe(command, args, options = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = [],
      stderr = []
    let bytes = 0,
      failure,
      settled = false,
      cleanupTimer
    const finish = (status, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(cleanupTimer)
      child.stdout.destroy()
      child.stderr.destroy()
      if (failure) {
        child.unref()
        reject(failure)
      } else
        resolve({
          status,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        })
    }
    const stop = (error) => {
      if (failure || settled) return
      failure = error
      clearTimeout(timer)
      if (!child.pid) {
        finish()
        return
      }
      // Closing inherited pipes is independently bounded even if an escaped
      // descendant survives the group kill or Windows tree termination fails.
      cleanupTimer = setTimeout(() => finish(), 2000)
      try {
        if (process.platform === "win32") {
          const killed = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
            windowsHide: true,
            timeout: 10000,
            stdio: "ignore",
          })
          if (killed.status !== 0)
            failure = new Error(`${error.message}; taskkill failed (${killed.status ?? killed.error?.message})`, {
              cause: error,
            })
        } else {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch (cause) {
            if (cause.code !== "ESRCH") throw cause
          }
        }
        child.kill("SIGKILL")
      } catch (cause) {
        failure = new Error(`${error.message}; process cleanup failed: ${cause.message}`, { cause: error })
      }
    }
    const timer = setTimeout(() => stop(new Error("Native TypeScript probe timed out")), timeoutMs)
    for (const [stream, chunks] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ]) {
      stream.on("data", (chunk) => {
        bytes += chunk.length
        if (bytes > 4 * 1024 * 1024) stop(new Error("Native TypeScript probe exceeded its output limit"))
        else chunks.push(chunk)
      })
    }
    child.on("error", stop)
    child.on("close", finish)
  })
}

// Exercise a relocated distribution with its own Node and native compiler.
// No source checkout imports or project-local language server are available.
async function verifyTypescriptNative(distribution) {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-ts7-")))
  let failure
  try {
    const runtime = path.join(temporary, "relocated runtime")
    await fs.cp(path.resolve(distribution), runtime, { recursive: true, verbatimSymlinks: true })
    const fixture = path.join(temporary, "project with spaces")
    await fs.mkdir(fixture)
    await fs.writeFile(path.join(fixture, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }))
    await fs.writeFile(path.join(fixture, "package.json"), JSON.stringify({ name: "native-smoke", private: true }))
    const source = path.join(fixture, "source.ts")
    const env = { ...process.env }
    delete env.NODE_OPTIONS
    delete env.NODE_PATH
    delete env.AX_CODE_LAUNCH_NODE_OPTIONS
    delete env.AX_CODE_CONFIG
    delete env.AX_CODE_CONFIG_DIR
    for (const key of [
      "XDG_DATA_HOME",
      "XDG_CONFIG_HOME",
      "XDG_STATE_HOME",
      "XDG_CACHE_HOME",
      "AX_CODE_TEST_HOME",
      "AX_CODE_TEST_MANAGED_CONFIG_DIR",
    ]) {
      env[key] = path.join(temporary, key.toLowerCase())
    }
    Object.assign(env, {
      AX_CODE_DISABLE_LSP_DOWNLOAD: "1",
      AX_CODE_DISABLE_AUTOUPDATE: "1",
      AX_CODE_DISABLE_AUTO_INDEX: "1",
      AX_CODE_DISABLE_MODELS_FETCH: "1",
      AX_CODE_DISABLE_PROJECT_CONFIG: "1",
      AX_CODE_CONFIG_CONTENT: '{"plugin":[]}',
      AX_CODE_LSP_PREWARM: "0",
    })
    const loader = createRequire(path.join(runtime, "package.json"))
    const manifestPath = loader.resolve("@typescript/native/package.json")
    const compiler = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    assert.equal(compiler.name, "typescript")
    assert.match(compiler.version, /^7\./)
    const nativeName = `@typescript/typescript-${process.platform}-${process.arch}`
    assert.equal(compiler.optionalDependencies[nativeName], compiler.version)
    const nativeManifestPath = createRequire(manifestPath).resolve(`${nativeName}/package.json`)
    const nativeManifest = JSON.parse(await fs.readFile(nativeManifestPath, "utf8"))
    assert.equal(nativeManifest.version, compiler.version)
    assert.equal(nativeManifest.name, nativeName)
    const native = path.join(path.dirname(nativeManifestPath), "lib", process.platform === "win32" ? "tsc.exe" : "tsc")
    const node = path.join(runtime, "node", "bin", process.platform === "win32" ? "node.exe" : "node")
    const entry = path.join(runtime, "lib", "index-node-tui.js")
    for (const file of [manifestPath, nativeManifestPath, native, node, entry]) {
      const relative = path.relative(runtime, await fs.realpath(file))
      assert.ok(
        relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        `Relocated runtime escaped its distribution: ${file}`,
      )
    }
    const identity = spawnSync(node, ["-p", 'process.platform + "/" + process.arch'], {
      env,
      encoding: "utf8",
      timeout: 10000,
    })
    assert.equal(identity.status, 0, identity.stderr || identity.error?.message)
    assert.equal(
      identity.stdout.trim(),
      `${process.platform}/${process.arch}`,
      "Qualification requires a native runner",
    )
    const version = spawnSync(native, ["--version"], { env, encoding: "utf8", timeout: 10000 })
    assert.equal(version.status, 0, version.stderr || version.error?.message)
    assert.equal(version.stdout.trim(), `Version ${compiler.version}`)
    for (const wrong of [true, false]) {
      await fs.writeFile(
        source,
        wrong ? 'export const answer: number = "wrong"\n' : "export const answer: number = 42\n",
      )
      const result = await runProbe(
        node,
        ["--experimental-ffi", "--disable-warning=ExperimentalWarning", entry, "debug", "lsp", "diagnostics", source],
        {
          cwd: fixture,
          env,
        },
      )
      assert.equal(result.status, 0, result.stderr || result.error?.message)
      const diagnostics = JSON.parse(result.stdout)
      const entries = Object.values(diagnostics)
      assert.ok(entries.length > 0, "Native server did not return a document diagnostic inventory")
      assert.ok(entries.every(Array.isArray), "Invalid diagnostic inventory")
      assert.equal(
        entries.flat().some((item) => item.code === 2322),
        wrong,
        JSON.stringify(diagnostics),
      )
    }
    return {
      verified: true,
      version: compiler.version,
      platform: process.platform,
      arch: process.arch,
      relocated: true,
      coldStartErrorAndClean: true,
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      if (!failure) throw error
      console.error("Probe cleanup also failed:", error.message)
    }
  }
}

module.exports = { verifyTypescriptNative, runProbe }
if (require.main === module) {
  if (!process.argv[2]) throw new Error("Usage: node script/verify-typescript-native.cjs <distribution>")
  verifyTypescriptNative(process.argv[2]).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error)
      process.exitCode = 1
    },
  )
}
