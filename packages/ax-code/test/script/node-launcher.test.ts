import { afterEach, describe, expect, test } from "vitest"
import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { UNIX_BRAND_AND_EXEC_NODE, unixNodeLauncherScript } from "../../script/node-launcher"

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []
// Node's own fatal-error report, written beside the compile cache (see
// UNIX_BRAND_AND_EXEC_NODE); the launcher adds it whenever the cache home is
// a path NODE_OPTIONS can carry.
const reportFlags = (cacheHome: string) =>
  `--report-on-fatalerror --report-exclude-env --report-exclude-network --report-directory=${path.join(cacheHome, "ax-code", "crash-reports")}`

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Unix node launcher", () => {
  // Release launch arguments require the supported Node 26+ runtime.
  test.skipIf(process.platform === "win32")(
    "does not replay application work or run preload hooks during admission",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-once-"))
      temporaryRoots.push(root)
      const preload = path.join(root, "preload.cjs")
      const marker = path.join(root, "preload-calls")
      const launcher = path.join(root, "launcher")
      await writeFile(preload, `require("node:fs").appendFileSync(${JSON.stringify(marker)}, "once\\n")\n`)
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node "$1" -e 'process.stdout.write("application"); process.exitCode = 37'\n`,
        { mode: 0o755 },
      )
      const failure = await execFileAsync(launcher, [process.execPath], {
        env: {
          ...process.env,
          XDG_CACHE_HOME: path.join(root, "cache"),
          NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
        },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, stdout: "application", signal: null })
      expect(await readFile(marker, "utf8")).toBe("once\n")
    },
  )

  test.skipIf(process.platform === "win32")(
    "falls back before application execution when branding is rejected",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-rejected-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          'case "$0" in */AX-Code) kill -KILL "$$" ;; esac',
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `printf '%s\\n' "$*" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} "$@"\n`,
        { mode: 0o755 },
      )
      const failure = await execFileAsync(launcher, ["application", "literal argument"], {
        env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache") },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, signal: null })
      expect(await readFile(calls, "utf8")).toBe(
        `--experimental-ffi --disable-warning=ExperimentalWarning ${reportFlags(path.join(root, "cache"))} application literal argument\n`,
      )
    },
  )

  test.skipIf(process.platform === "win32")(
    "omits the fatal-error report flags when the cache home has whitespace NODE_OPTIONS cannot carry",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-report-space-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `if [ "$1" = "-p" ]; then printf '%s\\n' ${quote(process.version)}; exit 0; fi`,
          `printf '%s\\n' "$*" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} "$@"\n`,
        { mode: 0o755 },
      )
      const cacheHome = path.join(root, "cache home")
      const failure = await execFileAsync(launcher, ["application"], {
        env: { ...process.env, XDG_CACHE_HOME: cacheHome },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, signal: null })
      expect(await readFile(calls, "utf8")).toBe(
        "--experimental-ffi --disable-warning=ExperimentalWarning application\n",
      )
      // The directory is still prepared for a later launch from a safe path.
      await expect(readdir(path.join(cacheHome, "ax-code", "crash-reports"))).resolves.toEqual([])
    },
  )

  test.skipIf(process.platform === "win32")(
    "omits the fatal-error report flags when the cache home has a double quote NODE_OPTIONS cannot carry",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-report-quote-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      const entry = path.join(root, "lib", "index-node-tui.js")
      await mkdir(path.dirname(entry), { recursive: true })
      await writeFile(entry, "process.stdout.write('ok')\n")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `printf 'options=[%s]\\n' "$NODE_OPTIONS" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )
      const failure = await execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: path.join(root, 'cache"home'), NODE_OPTIONS: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, signal: null })
      const options = await readFile(calls, "utf8")
      // A raw quote would make Node reject NODE_OPTIONS outright ("unterminated
      // string", exit 9) before any application code runs.
      expect(options).not.toContain("--report-directory")
      expect(options).toContain(`--import file://${entry}`)
    },
  )

  test.skipIf(process.platform === "win32")(
    "keeps the legacy argv form for entry paths NODE_OPTIONS cannot tokenize",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-space-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      const entry = path.join(root, "entry dir", "index-node-tui.js")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `if [ "$1" = "-p" ]; then printf '%s\\n' ${quote(process.version)}; exit 0; fi`,
          `printf '%s\\n' "$*" >> ${quote(calls)}`,
          `printf 'options=[%s] saved=[%s]\\n' "$NODE_OPTIONS" "$AX_CODE_LAUNCH_NODE_OPTIONS" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )
      const failure = await execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache"), NODE_OPTIONS: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, signal: null })
      expect(await readFile(calls, "utf8")).toBe(
        `--experimental-ffi --disable-warning=ExperimentalWarning ${reportFlags(path.join(root, "cache"))} ${entry} --version\noptions=[] saved=[]\n`,
      )
    },
  )

  test.skipIf(process.platform === "win32")(
    "encodes absolute --import entries so # in the path is not a URL fragment",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-hash-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      const invocations = path.join(root, "invocations")
      const entryDir = path.join(root, "C#tools")
      await mkdir(entryDir)
      const entry = path.join(entryDir, "index-node-tui.js")
      await writeFile(entry, "process.stdout.write('ok')\n")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `printf '%s\\n' "$*" >> ${quote(invocations)}`,
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `printf '%s\\n' "$*" >> ${quote(calls)}`,
          `printf 'options=[%s]\\n' "$NODE_OPTIONS" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )
      const failure = await execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache"), NODE_OPTIONS: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, signal: null })
      const invoked = await readFile(invocations, "utf8")
      expect(invoked).toContain("pathToFileURL")
      expect(invoked).toMatch(/^-e /m)
      const log = await readFile(calls, "utf8")
      expect(log).toContain("/dev/null --version")
      expect(log).toContain("file://")
      expect(log).toContain("%23")
      expect(log).not.toMatch(/--import \/.*C#tools/)
    },
  )

  test.skipIf(process.platform === "win32")(
    "uses a raw file URL for a safe absolute entry and does not run the node -e encoder",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-safe-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const invocations = path.join(root, "invocations")
      const calls = path.join(root, "calls")
      const entry = path.join(root, "lib", "index-node-tui.js")
      await mkdir(path.dirname(entry), { recursive: true })
      await writeFile(entry, "process.stdout.write('ok')\n")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `printf '%s\\n' "$*" >> ${quote(invocations)}`,
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `printf 'options=[%s]\\n' "$NODE_OPTIONS" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )
      const failure = await execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache"), NODE_OPTIONS: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, signal: null })
      const invoked = await readFile(invocations, "utf8")
      expect(invoked).not.toContain("pathToFileURL")
      const log = await readFile(calls, "utf8")
      expect(log).toContain(`--import file://${entry}`)
      expect(log).not.toContain("pathToFileURL")
      expect(log).not.toContain("%")
    },
  )

  test.skipIf(process.platform === "win32")(
    "still encodes absolute entries that contain % through the node -e encoder",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-pct-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const invocations = path.join(root, "invocations")
      const calls = path.join(root, "calls")
      const entryDir = path.join(root, "100%done")
      await mkdir(entryDir)
      const entry = path.join(entryDir, "index-node-tui.js")
      await writeFile(entry, "process.stdout.write('ok')\n")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `printf '%s\\n' "$*" >> ${quote(invocations)}`,
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `printf 'options=[%s]\\n' "$NODE_OPTIONS" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )
      const failure = await execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache"), NODE_OPTIONS: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 37, signal: null })
      const invoked = await readFile(invocations, "utf8")
      expect(invoked).toContain("pathToFileURL")
      expect(invoked).toMatch(/^-e /m)
      const log = await readFile(calls, "utf8")
      expect(log).toContain("file://")
      expect(log).toContain("%25")
      expect(log).not.toMatch(/--import \/.*100%done/)
    },
  )

  test("records the import case branches and the generated script passes sh -n", async () => {
    const encoder = `"$node_bin" -e 'process.stdout.write(require("url").pathToFileURL(process.argv[1]).href)'`
    for (const text of [UNIX_BRAND_AND_EXEC_NODE, unixNodeLauncherScript()]) {
      expect(text).toContain("*[!A-Za-z0-9._/-]*)")
      expect(text).toContain(encoder)
      expect(text).toContain('import_entry="file://$entry"')
      expect(text.indexOf(encoder)).toBeLessThan(text.indexOf('import_entry="file://$entry"'))
    }
    if (process.platform === "win32") return
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-syntax-"))
    temporaryRoots.push(root)
    const launcher = path.join(root, "launcher")
    await writeFile(launcher, unixNodeLauncherScript(), { mode: 0o755 })
    await execFileAsync("sh", ["-n", launcher])
  })

  test("resolves the bundle root when invoked through an rbenv-style symlink", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-launcher-"))
    temporaryRoots.push(root)
    const installRoot = path.join(root, ".ax-code")
    const binDir = path.join(installRoot, "bin")
    const nodeDir = path.join(installRoot, "node", "bin")
    const libEntry = path.join(installRoot, "lib", "index-node-tui.js")
    const shimDir = path.join(root, ".rbenv", "shims")
    const outputPath = path.join(root, "node-arguments.txt")
    const cacheDir = path.join(root, "cache")

    await Promise.all([
      mkdir(binDir, { recursive: true }),
      mkdir(nodeDir, { recursive: true }),
      mkdir(path.dirname(libEntry), { recursive: true }),
      mkdir(shimDir, { recursive: true }),
    ])
    const launcher = path.join(binDir, "ax-code")
    const fakeNode = path.join(nodeDir, "node")
    await writeFile(launcher, unixNodeLauncherScript())
    await writeFile(
      fakeNode,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > "${outputPath}"`,
        `printf '%s' "$NODE_OPTIONS" > "${outputPath}.node-options"`,
        `printf '%s' "$AX_CODE_LAUNCH_NODE_OPTIONS" > "${outputPath}.saved-node-options"`,
        "",
      ].join("\n"),
    )
    await writeFile(libEntry, "// Test entry point.\n")
    await chmod(launcher, 0o755)
    await chmod(fakeNode, 0o755)
    await symlink(launcher, path.join(shimDir, "ax-code"))

    await execFileAsync(path.join(shimDir, "ax-code"), ["--version"], {
      env: {
        ...process.env,
        XDG_CACHE_HOME: cacheDir,
        AX_CODE_SYSTEM_NODE: "",
        NODE_OPTIONS: "--max-old-space-size=4096",
      },
    })

    // Branding must never overwrite the user's real cached runtime.
    const runtimes = await readdir(path.join(cacheDir, "ax-code/libexec"))
    expect(runtimes).toHaveLength(1)
    expect(await readFile(path.join(cacheDir, "ax-code/libexec", runtimes[0], "bin/AX-Code"), "utf8")).toBe(
      await readFile(fakeNode, "utf8"),
    )

    // The process argv stays "AX-Code /dev/null [user args]" so macOS Terminal
    // job titles remain short; the Node flags and the entry ride in NODE_OPTIONS.
    const argumentsText = await readFile(outputPath, "utf8")
    expect(argumentsText).toBe("/dev/null\n--version\n")
    expect(argumentsText).not.toContain(path.join(root, ".rbenv", "lib"))

    const nodeOptions = await readFile(`${outputPath}.node-options`, "utf8")
    expect(nodeOptions).toContain("--experimental-ffi")
    expect(nodeOptions).toContain("--disable-warning=ExperimentalWarning")
    expect(nodeOptions).toContain(
      "--report-on-fatalerror --report-exclude-env --report-exclude-network --report-directory=",
    )
    await expect(readdir(path.join(root, "cache", "ax-code", "crash-reports"))).resolves.toEqual([])
    const entryImport = nodeOptions.split(" ").find((token) => token.includes("/lib/index-node-tui.js"))
    expect(entryImport).toBeDefined()
    // A safe absolute entry is a raw file URL. The node -e / pathToFileURL
    // encoder is only for paths that are not already a valid file URL.
    expect(entryImport!.startsWith("file://")).toBe(true)
    expect(entryImport).not.toContain("pathToFileURL")
    expect(await realpath(fileURLToPath(entryImport!))).toBe(await realpath(libEntry))
    expect(nodeOptions).not.toContain(path.join(root, ".rbenv", "lib"))
    // The caller's NODE_OPTIONS is appended for the launch and saved verbatim so
    // the entry can restore it before the CLI graph spawns Node children.
    expect(nodeOptions.endsWith("--max-old-space-size=4096")).toBe(true)
    expect(await readFile(`${outputPath}.saved-node-options`, "utf8")).toBe("--max-old-space-size=4096")
  })

  test.skipIf(process.platform !== "darwin")(
    "concurrent launches keep Homebrew Node libraries available",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-concurrent-"))
      temporaryRoots.push(root)
      // Prefer the dynamic Homebrew runtime: static Node binaries cannot expose
      // the missing-libnode startup failure even when a library link disappears.
      const node = await realpath("/opt/homebrew/bin/node").catch(() => process.execPath)
      const launcher = path.join(root, "launcher")
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node "$1" -e 'process.stdout.write("ready")'\n`,
        { mode: 0o755 },
      )
      for (let round = 0; round < 4; round++) {
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            execFileAsync(launcher, [node], {
              env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache") },
              timeout: 10_000,
            }),
          ),
        )
        expect(results.map((result) => result.stdout)).toEqual(Array(8).fill("ready"))
      }
    },
    30_000,
  )

  test.skipIf(process.platform === "win32")(
    "probes the branded runtime once and reuses the cached result",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-probe-cache-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      const entry = path.join(root, "index-node-tui.js")
      const cacheHome = path.join(root, "cache-home")
      await writeFile(entry, "// Test entry point.\n")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          // The branded binary answers the admission probe. It reports the same
          // version as the outer node so the probe accepts it.
          `if [ "$1" = "-p" ]; then printf 'probe-inner\\n' >> ${quote(calls)}; printf '%s\\n' ${quote(process.version)}; exit 0; fi`,
          `printf 'exec\\n' >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )
      const run = () =>
        execFileAsync(launcher, ["--version"], {
          env: { ...process.env, XDG_CACHE_HOME: cacheHome, NODE_OPTIONS: "" },
          timeout: 10_000,
        }).catch((error: unknown) => error)

      expect(await run()).toMatchObject({ code: 37, signal: null })
      expect(await run()).toMatchObject({ code: 37, signal: null })

      // One admission probe, two branded execs: the second launch reused the
      // recorded success instead of booting the probe again.
      expect(await readFile(calls, "utf8")).toBe("probe-inner\nexec\nexec\n")

      // Admission also depends on OS policy, so a stamp recorded under a
      // different OS build must not be trusted (e.g. after a system update).
      const runtimes = await readdir(path.join(cacheHome, "ax-code/libexec"))
      expect(runtimes).toHaveLength(1)
      const stamp = path.join(cacheHome, "ax-code/libexec", runtimes[0], "probe.ok")
      await writeFile(stamp, "stale-identity stale-os\n")

      expect(await run()).toMatchObject({ code: 37, signal: null })
      expect(await readFile(calls, "utf8")).toBe("probe-inner\nexec\nexec\nprobe-inner\nexec\n")
      expect(await readFile(stamp, "utf8")).not.toBe("stale-identity stale-os\n")
    },
  )

  test.skipIf(process.platform === "win32")("does not cache a failed admission probe", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-probe-fail-"))
    temporaryRoots.push(root)
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const original = path.join(root, "node")
    const launcher = path.join(root, "launcher")
    const calls = path.join(root, "calls")
    const entry = path.join(root, "index-node-tui.js")
    const cacheHome = path.join(root, "cache-home")
    await writeFile(entry, "// Test entry point.\n")
    await writeFile(
      original,
      [
        "#!/bin/sh",
        `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
        // The branded binary is rejected: it never answers the probe.
        `if [ "$1" = "-p" ]; then printf 'probe-inner\\n' >> ${quote(calls)}; exit 37; fi`,
        `printf 'fallback\\n' >> ${quote(calls)}`,
        "exit 37",
        "",
      ].join("\n"),
      { mode: 0o755 },
    )
    await writeFile(
      launcher,
      `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
      { mode: 0o755 },
    )
    const run = () =>
      execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: cacheHome, NODE_OPTIONS: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)

    expect(await run()).toMatchObject({ code: 37, signal: null })
    expect(await run()).toMatchObject({ code: 37, signal: null })

    // A rejected runtime must be re-probed every launch and must never leave a
    // stamp behind that would let a later launch exec it unprobed.
    expect(await readFile(calls, "utf8")).toBe("probe-inner\nfallback\nprobe-inner\nfallback\n")
    const runtimes = await readdir(path.join(cacheHome, "ax-code/libexec"))
    expect(runtimes).toHaveLength(1)
    expect(await readdir(path.join(cacheHome, "ax-code/libexec", runtimes[0]))).not.toContain("probe.ok")
  })

  test.skipIf(process.platform === "win32")("re-probes when the node binary is rewritten in place", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-probe-rewrite-"))
    temporaryRoots.push(root)
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const original = path.join(root, "node")
    const launcher = path.join(root, "launcher")
    const calls = path.join(root, "calls")
    const entry = path.join(root, "index-node-tui.js")
    const cacheHome = path.join(root, "cache-home")
    const script = (tag: string) =>
      [
        "#!/bin/sh",
        `# ${tag}`,
        `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
        `if [ "$1" = "-p" ]; then printf 'probe-inner\\n' >> ${quote(calls)}; printf '%s\\n' ${quote(process.version)}; exit 0; fi`,
        `printf 'exec\\n' >> ${quote(calls)}`,
        "exit 37",
        "",
      ].join("\n")
    await writeFile(entry, "// Test entry point.\n")
    await writeFile(original, script("original"), { mode: 0o755 })
    await writeFile(
      launcher,
      `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
      { mode: 0o755 },
    )
    const run = () =>
      execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: cacheHome, NODE_OPTIONS: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)

    expect(await run()).toMatchObject({ code: 37, signal: null })
    expect(await run()).toMatchObject({ code: 37, signal: null })
    expect(await readFile(calls, "utf8")).toBe("probe-inner\nexec\nexec\n")

    // Same path and typically the same inode; a size change must still
    // invalidate the cached admission verdict so a patched runtime is re-probed.
    await writeFile(original, script("rewritten"), { mode: 0o755 })
    expect(await run()).toMatchObject({ code: 37, signal: null })
    expect(await readFile(calls, "utf8")).toBe("probe-inner\nexec\nexec\nprobe-inner\nexec\n")
  })

  test("brands the Node binary as AX-Code before exec", () => {
    const script = unixNodeLauncherScript()
    expect(script).toContain("brand_and_exec_node")
    expect(script).toContain('branded="$cache/bin/AX-Code"')
    expect(script).toContain("runtime")
    expect(script).toContain('wc -c < "$real"')
    expect(script).not.toMatch(/^exec node /m)
  })

  test.skipIf(process.platform === "win32")(
    "exports a V8 compile cache so the bundle is not recompiled on every launch",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-compile-cache-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      const entry = path.join(root, "index-node-tui.js")
      const cacheHome = path.join(root, "cache-home")
      await writeFile(entry, "// Test entry point.\n")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `if [ "$1" = "-p" ]; then printf '%s\\n' ${quote(process.version)}; exit 0; fi`,
          `printf 'compile-cache=[%s]\\n' "$NODE_COMPILE_CACHE" >> ${quote(calls)}`,
          `if [ -d "$NODE_COMPILE_CACHE" ]; then printf 'cache-dir=present\\n' >> ${quote(calls)}; else printf 'cache-dir=absent\\n' >> ${quote(calls)}; fi`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )

      const failure = await execFileAsync(launcher, ["--version"], {
        env: { ...process.env, XDG_CACHE_HOME: cacheHome, NODE_OPTIONS: "", NODE_COMPILE_CACHE: "" },
        timeout: 10_000,
      }).catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: 37, signal: null })
      expect(await readFile(calls, "utf8")).toBe(
        `compile-cache=[${path.join(cacheHome, "ax-code/compile-cache")}]\ncache-dir=present\n`,
      )
    },
  )

  test.skipIf(process.platform === "win32")("never overrides an explicit NODE_COMPILE_CACHE", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-compile-cache-explicit-"))
    temporaryRoots.push(root)
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const original = path.join(root, "node")
    const launcher = path.join(root, "launcher")
    const calls = path.join(root, "calls")
    const entry = path.join(root, "index-node-tui.js")
    await writeFile(entry, "// Test entry point.\n")
    await writeFile(
      original,
      [
        "#!/bin/sh",
        `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
        `if [ "$1" = "-p" ]; then printf '%s\\n' ${quote(process.version)}; exit 0; fi`,
        `printf 'compile-cache=[%s]\\n' "$NODE_COMPILE_CACHE" >> ${quote(calls)}`,
        "exit 37",
        "",
      ].join("\n"),
      { mode: 0o755 },
    )
    await writeFile(
      launcher,
      `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
      { mode: 0o755 },
    )

    const failure = await execFileAsync(launcher, ["--version"], {
      env: {
        ...process.env,
        XDG_CACHE_HOME: path.join(root, "cache-home"),
        NODE_OPTIONS: "",
        NODE_COMPILE_CACHE: "/tmp/user-chosen-compile-cache",
      },
      timeout: 10_000,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 37, signal: null })
    expect(await readFile(calls, "utf8")).toBe("compile-cache=[/tmp/user-chosen-compile-cache]\n")
  })

  test.skipIf(process.platform === "win32")(
    "keeps the compile cache under ~/.cache when XDG_CACHE_HOME is unset",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-compile-cache-home-"))
      temporaryRoots.push(root)
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const original = path.join(root, "node")
      const launcher = path.join(root, "launcher")
      const calls = path.join(root, "calls")
      const entry = path.join(root, "index-node-tui.js")
      const home = path.join(root, "home")
      await mkdir(home, { recursive: true })
      await writeFile(entry, "// Test entry point.\n")
      await writeFile(
        original,
        [
          "#!/bin/sh",
          `if [ "$1" = "-e" ]; then exec ${quote(process.execPath)} "$@"; fi`,
          `if [ "$1" = "-p" ]; then printf '%s\\n' ${quote(process.version)}; exit 0; fi`,
          `printf 'compile-cache=[%s]\\n' "$NODE_COMPILE_CACHE" >> ${quote(calls)}`,
          "exit 37",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node ${quote(original)} ${quote(entry)} "$@"\n`,
        { mode: 0o755 },
      )

      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, NODE_OPTIONS: "", NODE_COMPILE_CACHE: "" }
      delete env.XDG_CACHE_HOME
      const failure = await execFileAsync(launcher, ["--version"], { env, timeout: 10_000 }).catch(
        (error: unknown) => error,
      )

      expect(failure).toMatchObject({ code: 37, signal: null })
      // Must not land in a visible ~/ax-code. It stays under ~/.cache, matching
      // the launcher's own libexec cache, the standalone installer, and
      // script/node-ffi-runner-args.mjs withCompileCache().
      expect(await readFile(calls, "utf8")).toBe(`compile-cache=[${path.join(home, ".cache/ax-code/compile-cache")}]\n`)
    },
  )
})
