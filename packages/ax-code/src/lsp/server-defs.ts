import path from "path"
import os from "os"
import { Global } from "../global"
import { BunProc } from "../bun"
import { Env } from "../util/env"
import { text } from "node:stream/consumers"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { Archive } from "../util/archive"
import { Process } from "../util/process"
import { which } from "../util/which"
import { Module } from "@ax-code/util/module"
import { spawn } from "./launch"
import { JS_LOCKFILES } from "@/constants/lsp"
import {
  bunServer,
  clangdAsset,
  ensureTool,
  globalTool,
  installReleaseBin,
  log,
  NearestRoot,
  output,
  pathExists,
  releaseAsset,
  run,
  spawnInfo,
  toolServer,
  toolBin,
  venvBin,
  venvPython,
  zlsAsset,
  type ServerInfo,
} from "./server-helpers"

type Info = ServerInfo

export const Deno: Info = {
  id: "deno",
  root: async (file) => {
    const files = Filesystem.up({
      targets: ["deno.json", "deno.jsonc"],
      start: path.dirname(file),
      stop: Instance.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return undefined
    return path.dirname(first.value)
  },
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  async spawn(root) {
    const deno = which("deno")
    if (!deno) {
      log.info("deno not found, please install deno first")
      return
    }
    return {
      process: spawn(deno, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Typescript: Info = {
  id: "typescript",
  root: NearestRoot([...JS_LOCKFILES], ["deno.json", "deno.jsonc"]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  async spawn(root) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", Instance.directory)
    log.info("typescript server", { tsserver })
    if (!tsserver) return
    const proc = spawn(BunProc.which(), ["x", "typescript-language-server", "--stdio"], {
      cwd: root,
      env: {
        ...Env.sanitize(),
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        tsserver: {
          path: tsserver,
        },
      },
    }
  },
}

export const Vue: Info = {
  id: "vue",
  extensions: [".vue"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    const proc = await bunServer({
      root,
      binary: "vue-language-server",
      script: path.join(Global.Path.bin, "node_modules", "@vue", "language-server", "bin", "vue-language-server.js"),
      pkg: "@vue/language-server",
      args: ["--stdio"],
    })
    if (!proc) return
    return {
      process: proc,
      initialization: {
        // Leave empty; the server will auto-detect workspace TypeScript.
      },
    }
  },
}

export const ESLint: Info = {
  id: "eslint",
  semantic: false,
  root: NearestRoot([...JS_LOCKFILES]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
  async spawn(root) {
    const eslint = Module.resolve("eslint", Instance.directory)
    if (!eslint) return
    log.info("spawning eslint server")
    const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
    if (!(await Filesystem.exists(serverPath))) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading and building VS Code ESLint server")
      const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip", { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) return

      const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
      if (response.body) await Filesystem.writeStream(zipPath, response.body)

      const ok = await Archive.extractZip(zipPath, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract vscode-eslint archive", { error })
          return false
        })
      // Always clean up the ~50MB zip, even on extraction failure.
      // Previously the cleanup only ran on the success path, so repeated
      // failed installs would exhaust disk space with orphaned archives.
      await fs.rm(zipPath, { force: true }).catch(() => {})
      if (!ok) return

      const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
      const finalPath = path.join(Global.Path.bin, "vscode-eslint")

      const stats = await fs.stat(finalPath).catch(() => undefined)
      if (stats) {
        log.info("removing old eslint installation", { path: finalPath })
        await fs.rm(finalPath, { force: true, recursive: true })
      }
      await fs.rename(extractedPath, finalPath)

      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
      await Process.run([npmCmd, "install"], { cwd: finalPath })
      await Process.run([npmCmd, "run", "compile"], { cwd: finalPath })

      log.info("installed VS Code ESLint server", { serverPath })
    }

    const proc = spawn(BunProc.which(), [serverPath, "--stdio"], {
      cwd: root,
      env: {
        ...Env.sanitize(),
        BUN_BE_BUN: "1",
      },
    })

    return {
      process: proc,
    }
  },
}

export const Oxlint: Info = {
  id: "oxlint",
  semantic: false,
  root: NearestRoot([
    ".oxlintrc.json",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package.json",
  ]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
  async spawn(root) {
    const ext = process.platform === "win32" ? ".cmd" : ""

    const serverTarget = path.join("node_modules", ".bin", "oxc_language_server" + ext)
    const lintTarget = path.join("node_modules", ".bin", "oxlint" + ext)

    const resolveBin = async (target: string) => {
      const localBin = path.join(root, target)
      if (await Filesystem.exists(localBin)) return localBin

      const candidates = Filesystem.up({
        targets: [target],
        start: root,
        stop: Instance.worktree,
      })
      const first = await candidates.next()
      await candidates.return()
      if (first.value) return first.value

      return undefined
    }

    let lintBin = await resolveBin(lintTarget)
    if (!lintBin) {
      const found = which("oxlint")
      if (found) lintBin = found
    }

    if (lintBin) {
      const proc = spawn(lintBin, ["--help"])
      // Read stdout concurrently with awaiting exit so the child cannot
      // block on a full pipe buffer. Small output in practice (typical
      // --help is <10KB), but the concurrent pattern is still safer and
      // mirrors what Promise.all([text(stream), exited]) guarantees.
      const helpPromise = proc.stdout ? text(proc.stdout) : Promise.resolve("")
      const [help] = await Promise.all([helpPromise, proc.exited])
      if (help.includes("--lsp")) {
        return {
          process: spawn(lintBin, ["--lsp"], {
            cwd: root,
          }),
        }
      }
    }

    let serverBin = await resolveBin(serverTarget)
    if (!serverBin) {
      const found = which("oxc_language_server")
      if (found) serverBin = found
    }
    if (serverBin) {
      return {
        process: spawn(serverBin, [], {
          cwd: root,
        }),
      }
    }

    log.info("oxlint not found, please install oxlint")
    return
  },
}

export const Biome: Info = {
  id: "biome",
  semantic: false,
  root: NearestRoot([
    "biome.json",
    "biome.jsonc",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
  ]),
  extensions: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".jsonc",
    ".vue",
    ".astro",
    ".svelte",
    ".css",
    ".graphql",
    ".gql",
    ".html",
  ],
  async spawn(root) {
    const localBin = path.join(root, "node_modules", ".bin", "biome")
    let bin: string | undefined
    if (await Filesystem.exists(localBin)) bin = localBin
    if (!bin) {
      const found = which("biome")
      if (found) bin = found
    }

    let args = ["lsp-proxy", "--stdio"]

    if (!bin) {
      const resolved = Module.resolve("biome", root)
      if (!resolved) return
      bin = BunProc.which()
      args = ["x", "biome", "lsp-proxy", "--stdio"]
    }

    const proc = spawn(bin, args, {
      cwd: root,
      env: {
        ...Env.sanitize(),
        BUN_BE_BUN: "1",
      },
    })

    return {
      process: proc,
    }
  },
}

export const Gopls: Info = {
  id: "gopls",
  root: async (file) => {
    const work = await NearestRoot(["go.work"])(file)
    if (work) return work
    return NearestRoot(["go.mod", "go.sum"])(file)
  },
  extensions: [".go"],
  async spawn(root) {
    return toolServer(root, {
      name: "gopls",
      install: ["go", "install", "golang.org/x/tools/gopls@latest"],
      env: { ...Env.sanitize(), GOBIN: Global.Path.bin },
      require: ["go"],
    })
  },
}

export const Rubocop: Info = {
  id: "ruby-lsp",
  root: NearestRoot(["Gemfile"]),
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async spawn(root) {
    return toolServer(root, {
      name: "rubocop",
      install: ["gem", "install", "rubocop", "--bindir", Global.Path.bin],
      require: ["ruby", "gem"],
      missing: "Ruby not found, please install Ruby first",
      missingLevel: "info",
      args: ["--lsp"],
    })
  },
}

export const Ty: Info = {
  id: "ty",
  extensions: [".py", ".pyi"],
  root: NearestRoot([
    "pyproject.toml",
    "ty.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "Pipfile",
    "pyrightconfig.json",
  ]),
  async spawn(root) {
    if (!Flag.AX_CODE_EXPERIMENTAL_LSP_TY) {
      return undefined
    }

    let binary = which("ty")

    const initialization: Record<string, string> = {}

    const python = await venvPython(root)
    if (python) initialization["pythonPath"] = python

    if (!binary) {
      binary = (await venvBin(root, "ty")) ?? null
    }

    if (!binary) {
      log.error("ty not found, please install ty first")
      return
    }

    const proc = spawn(binary, ["server"], {
      cwd: root,
    })

    return {
      process: proc,
      initialization,
    }
  },
}

export const Pyright: Info = {
  id: "pyright",
  extensions: [".py", ".pyi"],
  root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
  async spawn(root) {
    const initialization: Record<string, string> = {}
    const python = await venvPython(root)
    if (python) initialization["pythonPath"] = python

    const proc = await bunServer({
      root,
      binary: "pyright-langserver",
      script: path.join(Global.Path.bin, "node_modules", "pyright", "dist", "pyright-langserver.js"),
      pkg: "pyright",
      args: ["--stdio"],
    })
    if (!proc) return
    return {
      process: proc,
      initialization,
    }
  },
}

export const ElixirLS: Info = {
  id: "elixir-ls",
  extensions: [".ex", ".exs"],
  root: NearestRoot(["mix.exs", "mix.lock"]),
  async spawn(root) {
    let binary = which("elixir-ls")
    if (!binary) {
      const elixirLsPath = path.join(Global.Path.bin, "elixir-ls")
      binary = path.join(
        Global.Path.bin,
        "elixir-ls-master",
        "release",
        process.platform === "win32" ? "language_server.bat" : "language_server.sh",
      )

      if (!(await Filesystem.exists(binary))) {
        const elixir = which("elixir")
        if (!elixir) {
          log.error("elixir is required to run elixir-ls")
          return
        }

        if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading elixir-ls from GitHub releases")

        const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip", { signal: AbortSignal.timeout(60_000) })
        if (!response.ok) return
        const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
        if (response.body) await Filesystem.writeStream(zipPath, response.body)

        const ok = await Archive.extractZip(zipPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract elixir-ls archive", { error })
            return false
          })
        if (!ok) return

        await fs.rm(zipPath, {
          force: true,
          recursive: true,
        })

        const cwd = path.join(Global.Path.bin, "elixir-ls-master")
        const env = { MIX_ENV: "prod", ...process.env }
        await Process.run(["mix", "deps.get"], { cwd, env })
        await Process.run(["mix", "compile"], { cwd, env })
        await Process.run(["mix", "elixir_ls.release2", "-o", "release"], { cwd, env })

        log.info(`installed elixir-ls`, {
          path: elixirLsPath,
        })
      }
    }

    return {
      process: spawn(binary, {
        cwd: root,
      }),
    }
  },
}

export const Zls: Info = {
  id: "zls",
  extensions: [".zig", ".zon"],
  root: NearestRoot(["build.zig"]),
  async spawn(root) {
    let bin = which("zls", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })

    if (!bin) {
      const zig = which("zig")
      if (!zig) {
        log.error("Zig is required to use zls. Please install Zig first.")
        return
      }

      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading zls from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/zigtools/zls/releases/latest", { signal: AbortSignal.timeout(30_000) })
      if (!releaseResponse.ok) {
        log.error("Failed to fetch zls release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        tag_name: string
        assets: { name: string; browser_download_url: string }[]
      }

      const platform = process.platform
      const arch = process.arch
      const assetName = zlsAsset(platform, arch)
      if (!assetName) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
        return
      }

      const asset = release.assets.find((a) => a.name === assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in latest zls release`)
        return
      }
      bin = (await installReleaseBin({
        id: "zls",
        assetName,
        url: asset.browser_download_url,
        bin: path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : "")),
        platform,
        tarArgs: ["-xf"],
      })) ?? null
      if (!bin) return
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const CSharp: Info = {
  id: "csharp",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".cs"],
  async spawn(root) {
    return toolServer(root, {
      name: "csharp-ls",
      install: ["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin],
      require: ["dotnet"],
      missing: ".NET SDK is required to install csharp-ls",
      title: "installing csharp-ls via dotnet tool",
    })
  },
}

export const FSharp: Info = {
  id: "fsharp",
  root: NearestRoot([".slnx", ".sln", ".fsproj", "global.json"]),
  extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  async spawn(root) {
    return toolServer(root, {
      name: "fsautocomplete",
      install: ["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin],
      require: ["dotnet"],
      missing: ".NET SDK is required to install fsautocomplete",
      title: "installing fsautocomplete via dotnet tool",
    })
  },
}

export const SourceKit: Info = {
  id: "sourcekit-lsp",
  extensions: [".swift", ".m", ".mm"],
  root: NearestRoot(["Package.swift", "*.xcodeproj", "*.xcworkspace"]),
  async spawn(root) {
    // Check if sourcekit-lsp is available in the PATH
    // This is installed with the Swift toolchain
    const sourcekit = which("sourcekit-lsp")
    if (sourcekit) {
      return {
        process: spawn(sourcekit, {
          cwd: root,
        }),
      }
    }

    // If sourcekit-lsp not found, check if xcrun is available
    // This is specific to macOS where sourcekit-lsp is typically installed with Xcode
    if (!which("xcrun")) return

    const lspLoc = await output(["xcrun", "--find", "sourcekit-lsp"])

    if (lspLoc.code !== 0) return

    const bin = lspLoc.text.trim()

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const RustAnalyzer: Info = {
  id: "rust",
  root: async (root) => {
    const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(root)
    if (crateRoot === undefined) {
      return undefined
    }
    let currentDir = crateRoot

    while (currentDir !== path.dirname(currentDir)) {
      // Stop at filesystem root
      const cargoTomlPath = path.join(currentDir, "Cargo.toml")
      try {
        const cargoTomlContent = await Filesystem.readText(cargoTomlPath)
        if (cargoTomlContent.includes("[workspace]")) {
          return currentDir
        }
      } catch (err) {
        // File doesn't exist or can't be read, continue searching up
      }

      const parentDir = path.dirname(currentDir)
      if (parentDir === currentDir) break // Reached filesystem root
      currentDir = parentDir

      // Stop if we've gone above the app root
      if (!currentDir.startsWith(Instance.worktree)) break
    }

    return crateRoot
  },
  extensions: [".rs"],
  async spawn(root) {
    const bin = which("rust-analyzer")
    if (!bin) {
      log.info("rust-analyzer not found in path, please install it")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const Clangd: Info = {
  id: "clangd",
  root: NearestRoot(["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt", "Makefile"]),
  extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
  async spawn(root) {
    const args = ["--background-index", "--clang-tidy"]
    const fromPath = which("clangd")
    if (fromPath) {
      return {
        process: spawn(fromPath, args, {
          cwd: root,
        }),
      }
    }

    const ext = process.platform === "win32" ? ".exe" : ""
    const direct = path.join(Global.Path.bin, "clangd" + ext)
    if (await Filesystem.exists(direct)) {
      return {
        process: spawn(direct, args, {
          cwd: root,
        }),
      }
    }

    const entries = await fs.readdir(Global.Path.bin, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith("clangd_")) continue
      const candidate = path.join(Global.Path.bin, entry.name, "bin", "clangd" + ext)
      if (await Filesystem.exists(candidate)) {
        return {
          process: spawn(candidate, args, {
            cwd: root,
          }),
        }
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    log.info("downloading clangd from GitHub releases")

    const releaseResponse = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest", { signal: AbortSignal.timeout(30_000) })
    if (!releaseResponse.ok) {
      log.error("Failed to fetch clangd release info")
      return
    }

    const release: {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    } = await releaseResponse.json()

    const tag = release.tag_name
    if (!tag) {
      log.error("clangd release did not include a tag name")
      return
    }
    const platform = process.platform
    const assets = release.assets ?? []
    const asset = clangdAsset(assets, tag, platform)
    if (!asset) {
      log.error("clangd could not match release asset", { tag, platform })
      return
    }
    if (!asset?.name || !asset.browser_download_url) {
      log.error("clangd could not match release asset", { tag, platform })
      return
    }

    const name = asset.name
    const downloadResponse = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(60_000) })
    if (!downloadResponse.ok) {
      log.error("Failed to download clangd")
      return
    }

    const archive = path.join(Global.Path.bin, name)
    const buf = await downloadResponse.arrayBuffer()
    if (buf.byteLength === 0) {
      log.error("Failed to write clangd archive")
      return
    }
    await Filesystem.write(archive, Buffer.from(buf))

    const zip = name.endsWith(".zip")
    const tar = name.endsWith(".tar.xz")
    if (!zip && !tar) {
      log.error("clangd encountered unsupported asset", { asset: name })
      return
    }

    if (zip) {
      const ok = await Archive.extractZip(archive, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract clangd archive", { error })
          return false
        })
      if (!ok) return
    }
    if (tar) {
      await run(["tar", "-xf", archive], { cwd: Global.Path.bin })
    }
    await fs.rm(archive, { force: true })

    const bin = path.join(Global.Path.bin, "clangd_" + tag, "bin", "clangd" + ext)
    if (!(await Filesystem.exists(bin))) {
      log.error("Failed to extract clangd binary")
      return
    }

    if (platform !== "win32") {
      await fs.chmod(bin, 0o755).catch(() => {})
    }

    await fs.unlink(path.join(Global.Path.bin, "clangd")).catch(() => {})
    await fs.symlink(bin, path.join(Global.Path.bin, "clangd")).catch(() => {})

    log.info(`installed clangd`, { bin })

    return {
      process: spawn(bin, args, {
        cwd: root,
      }),
    }
  },
}

export const Svelte: Info = {
  id: "svelte",
  extensions: [".svelte"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    const proc = await bunServer({
      root,
      binary: "svelteserver",
      script: path.join(Global.Path.bin, "node_modules", "svelte-language-server", "bin", "server.js"),
      pkg: "svelte-language-server",
      args: ["--stdio"],
    })
    if (!proc) return
    return {
      process: proc,
      initialization: {},
    }
  },
}

export const Astro: Info = {
  id: "astro",
  extensions: [".astro"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", Instance.directory)
    if (!tsserver) {
      log.info("typescript not found, required for Astro language server")
      return
    }
    const tsdk = path.dirname(tsserver)

    const proc = await bunServer({
      root,
      binary: "astro-ls",
      script: path.join(Global.Path.bin, "node_modules", "@astrojs", "language-server", "bin", "nodeServer.js"),
      pkg: "@astrojs/language-server",
      args: ["--stdio"],
    })
    if (!proc) return
    return {
      process: proc,
      initialization: {
        typescript: {
          tsdk,
        },
      },
    }
  },
}

export const JDTLS: Info = {
  id: "jdtls",
  root: async (file) => {
    // Without exclusions, NearestRoot defaults to instance directory so we can't
    // distinguish between a) no project found and b) project found at instance dir.
    // So we can't choose the root from (potential) monorepo markers first.
    // Look for potential subproject markers first while excluding potential monorepo markers.
    const settingsMarkers = ["settings.gradle", "settings.gradle.kts"]
    const gradleMarkers = ["gradlew", "gradlew.bat"]
    const exclusionsForMonorepos = gradleMarkers.concat(settingsMarkers)

    const [projectRoot, wrapperRoot, settingsRoot] = await Promise.all([
      NearestRoot(
        ["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"],
        exclusionsForMonorepos,
      )(file),
      NearestRoot(gradleMarkers, settingsMarkers)(file),
      NearestRoot(settingsMarkers)(file),
    ])

    // If projectRoot is undefined we know we are in a monorepo or no project at all.
    // So can safely fall through to the other roots
    if (projectRoot) return projectRoot
    if (wrapperRoot) return wrapperRoot
    if (settingsRoot) return settingsRoot
  },
  extensions: [".java"],
  async spawn(root) {
    const java = which("java")
    if (!java) {
      log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
      return
    }
    const javaMajorVersion = await run(["java", "-version"]).then((result) => {
      const m = /"(\d+)\.\d+\.\d+"/.exec(result.stderr.toString())
      return !m ? undefined : parseInt(m[1], 10)
    })
    if (javaMajorVersion == null || javaMajorVersion < 21) {
      log.error("JDTLS requires at least Java 21.")
      return
    }
    const distPath = path.join(Global.Path.bin, "jdtls")
    const launcherDir = path.join(distPath, "plugins")
    const installed = await pathExists(launcherDir)
    if (!installed) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading JDTLS LSP server.")
      await fs.mkdir(distPath, { recursive: true })
      const releaseURL =
        "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
      const archiveName = "release.tar.gz"

      log.info("Downloading JDTLS archive", { url: releaseURL, dest: distPath })
      const download = await fetch(releaseURL, { signal: AbortSignal.timeout(60_000) })
      if (!download.ok || !download.body) {
        log.error("Failed to download JDTLS", { status: download.status, statusText: download.statusText })
        return
      }
      await Filesystem.writeStream(path.join(distPath, archiveName), download.body)

      log.info("Extracting JDTLS archive")
      const tarResult = await run(["tar", "-xzf", archiveName], { cwd: distPath })
      if (tarResult.code !== 0) {
        log.error("Failed to extract JDTLS", { exitCode: tarResult.code, stderr: tarResult.stderr.toString() })
        return
      }

      await fs.rm(path.join(distPath, archiveName), { force: true })
      log.info("JDTLS download and extraction completed")
    }
    const jarFileName =
      (await fs.readdir(launcherDir).catch(() => []))
        .find((item) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(item))
        ?.trim()
    if (!jarFileName) {
      log.error(`Failed to locate the JDTLS launcher jar in: ${launcherDir}`)
      return
    }
    const launcherJar = path.join(launcherDir, jarFileName)
    if (!(await pathExists(launcherJar))) {
      log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
      return
    }
    const configFile = path.join(
      distPath,
      (() => {
        switch (process.platform) {
          case "darwin":
            return "config_mac"
          case "linux":
            return "config_linux"
          case "win32":
            return "config_win"
          default:
            return "config_linux"
        }
      })(),
    )
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-jdtls-data"))
    let proc
    try {
      proc = spawn(
        java,
        [
          "-jar",
          launcherJar,
          "-configuration",
          configFile,
          "-data",
          dataDir,
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Dlog.level=ALL",
          "--add-modules=ALL-SYSTEM",
          "--add-opens java.base/java.util=ALL-UNNAMED",
          "--add-opens java.base/java.lang=ALL-UNNAMED",
        ],
        {
          cwd: root,
        },
      )
    } catch (err) {
      // spawn() can throw synchronously (ENOENT on missing java, EACCES,
      // etc.). Before this catch, the exit handler below was never
      // registered and the mkdtemp'd directory leaked on every failed
      // spawn — accumulating endlessly in $TMPDIR for users without
      // Java installed who keep opening Java projects.
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    // Clean up the JDTLS data directory once the language server exits.
    // Previously these directories were left behind on every shutdown and
    // accumulated indefinitely in $TMPDIR.
    proc.once("exit", () => {
      fs.rm(dataDir, { recursive: true, force: true }).catch((err) =>
        log.warn("failed to remove jdtls data dir", { dataDir, err }),
      )
    })
    return { process: proc }
  },
}

export const KotlinLS: Info = {
  id: "kotlin-ls",
  extensions: [".kt", ".kts"],
  root: async (file) => {
    // 1) Nearest Gradle root (multi-project or included build)
    const settingsRoot = await NearestRoot(["settings.gradle.kts", "settings.gradle"])(file)
    if (settingsRoot) return settingsRoot
    // 2) Gradle wrapper (strong root signal)
    const wrapperRoot = await NearestRoot(["gradlew", "gradlew.bat"])(file)
    if (wrapperRoot) return wrapperRoot
    // 3) Single-project or module-level build
    const buildRoot = await NearestRoot(["build.gradle.kts", "build.gradle"])(file)
    if (buildRoot) return buildRoot
    // 4) Maven fallback
    return NearestRoot(["pom.xml"])(file)
  },
  async spawn(root) {
    const distPath = path.join(Global.Path.bin, "kotlin-ls")
    const launcherScript =
      process.platform === "win32" ? path.join(distPath, "kotlin-lsp.cmd") : path.join(distPath, "kotlin-lsp.sh")
    const installed = await Filesystem.exists(launcherScript)
    if (!installed) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading Kotlin Language Server from GitHub.")

      const releaseResponse = await fetch("https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest", { signal: AbortSignal.timeout(30_000) })
      if (!releaseResponse.ok) {
        log.error("Failed to fetch kotlin-lsp release info")
        return
      }

      const release = await releaseResponse.json()
      const version = release.name?.replace(/^v/, "")

      if (!version) {
        log.error("Could not determine Kotlin LSP version from release")
        return
      }

      const platform = process.platform
      const arch = process.arch

      let kotlinArch: string = arch
      if (arch === "arm64") kotlinArch = "aarch64"
      else if (arch === "x64") kotlinArch = "x64"

      let kotlinPlatform: string = platform
      if (platform === "darwin") kotlinPlatform = "mac"
      else if (platform === "linux") kotlinPlatform = "linux"
      else if (platform === "win32") kotlinPlatform = "win"

      const supportedCombos = ["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"]

      const combo = `${kotlinPlatform}-${kotlinArch}`

      if (!supportedCombos.includes(combo)) {
        log.error(`Platform ${platform}/${arch} is not supported by Kotlin LSP`)
        return
      }

      const assetName = `kotlin-lsp-${version}-${kotlinPlatform}-${kotlinArch}.zip`
      const releaseURL = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${assetName}`

      await fs.mkdir(distPath, { recursive: true })
      const archivePath = path.join(distPath, "kotlin-ls.zip")
      const download = await fetch(releaseURL, { signal: AbortSignal.timeout(60_000) })
      if (!download.ok || !download.body) {
        log.error("Failed to download Kotlin Language Server", {
          status: download.status,
          statusText: download.statusText,
        })
        return
      }
      await Filesystem.writeStream(archivePath, download.body)
      try {
        const ok = await Archive.extractZip(archivePath, distPath)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract Kotlin LS archive", { error })
            return false
          })
        if (!ok) return
      } finally {
        // Always remove the downloaded archive — previously only the
        // happy path deleted it, leaving ~10-100MB stuck in the bin
        // directory after every failed extraction.
        await fs.rm(archivePath, { force: true }).catch(() => {})
      }
      if (process.platform !== "win32") {
        await fs.chmod(launcherScript, 0o755).catch(() => {})
      }
      log.info("Installed Kotlin Language Server", { path: launcherScript })
    }
    if (!(await Filesystem.exists(launcherScript))) {
      log.error(`Failed to locate the Kotlin LS launcher script in the installed directory: ${distPath}.`)
      return
    }
    return {
      process: spawn(launcherScript, ["--stdio"], {
        cwd: root,
      }),
    }
  },
}

export const YamlLS: Info = {
  id: "yaml-ls",
  extensions: [".yaml", ".yml"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    const proc = await bunServer({
      root,
      binary: "yaml-language-server",
      script: path.join(Global.Path.bin, "node_modules", "yaml-language-server", "out", "server", "src", "server.js"),
      pkg: "yaml-language-server",
      args: ["--stdio"],
    })
    if (!proc) return
    return {
      process: proc,
    }
  },
}

export const LuaLS: Info = {
  id: "lua-ls",
  root: NearestRoot([
    ".luarc.json",
    ".luarc.jsonc",
    ".luacheckrc",
    ".stylua.toml",
    "stylua.toml",
    "selene.toml",
    "selene.yml",
  ]),
  extensions: [".lua"],
  async spawn(root) {
    let bin = which("lua-language-server", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })

    if (!bin) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading lua-language-server from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/LuaLS/lua-language-server/releases/latest", { signal: AbortSignal.timeout(30_000) })
      if (!releaseResponse.ok) {
        log.error("Failed to fetch lua-language-server release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        tag_name: string
        assets: { name: string; browser_download_url: string }[]
      }

      const platform = process.platform
      const arch = process.arch
      let assetName = ""

      let lualsArch: string = arch
      if (arch === "arm64") lualsArch = "arm64"
      else if (arch === "x64") lualsArch = "x64"
      else if (arch === "ia32") lualsArch = "ia32"

      let lualsPlatform: string = platform
      if (platform === "darwin") lualsPlatform = "darwin"
      else if (platform === "linux") lualsPlatform = "linux"
      else if (platform === "win32") lualsPlatform = "win32"

      const ext = platform === "win32" ? "zip" : "tar.gz"

      assetName = `lua-language-server-${release.tag_name}-${lualsPlatform}-${lualsArch}.${ext}`

      const supportedCombos = [
        "darwin-arm64.tar.gz",
        "darwin-x64.tar.gz",
        "linux-x64.tar.gz",
        "linux-arm64.tar.gz",
        "win32-x64.zip",
        "win32-ia32.zip",
      ]

      const assetSuffix = `${lualsPlatform}-${lualsArch}.${ext}`
      if (!supportedCombos.includes(assetSuffix)) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
        return
      }

      const asset = release.assets.find((a) => a.name === assetName)
      if (!asset) {
        log.error(`Could not find asset ${assetName} in latest lua-language-server release`)
        return
      }

      const downloadUrl = asset.browser_download_url
      const downloadResponse = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) })
      if (!downloadResponse.ok) {
        log.error("Failed to download lua-language-server")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      // Unlike zls which is a single self-contained binary,
      // lua-language-server needs supporting files (meta/, locale/, etc.)
      // Extract entire archive to dedicated directory to preserve all files
      const installDir = path.join(Global.Path.bin, `lua-language-server-${lualsArch}-${lualsPlatform}`)

      // Remove old installation if exists
      const stats = await fs.stat(installDir).catch(() => undefined)
      if (stats) {
        await fs.rm(installDir, { force: true, recursive: true })
      }

      await fs.mkdir(installDir, { recursive: true })

      try {
        if (ext === "zip") {
          const ok = await Archive.extractZip(tempPath, installDir)
            .then(() => true)
            .catch((error) => {
              log.error("Failed to extract lua-language-server archive", { error })
              return false
            })
          if (!ok) return
        } else {
          const ok = await run(["tar", "-xzf", tempPath, "-C", installDir])
            .then((result) => result.code === 0)
            .catch((error: unknown) => {
              log.error("Failed to extract lua-language-server archive", { error })
              return false
            })
          if (!ok) return
        }
      } finally {
        // Always remove the archive — previously only the happy path
        // reached the rm call, leaving downloads wedged in the bin
        // dir after every failed extraction.
        await fs.rm(tempPath, { force: true }).catch(() => {})
      }

      // Binary is located in bin/ subdirectory within the extracted archive
      bin = path.join(installDir, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract lua-language-server binary")
        return
      }

      if (platform !== "win32") {
        const ok = await fs
          .chmod(bin, 0o755)
          .then(() => true)
          .catch((error: unknown) => {
            log.error("Failed to set executable permission for lua-language-server binary", {
              error,
            })
            return false
          })
        if (!ok) return
      }

      log.info(`installed lua-language-server`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const PHPIntelephense: Info = {
  id: "php intelephense",
  extensions: [".php"],
  root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
  async spawn(root) {
    const proc = await bunServer({
      root,
      binary: "intelephense",
      script: path.join(Global.Path.bin, "node_modules", "intelephense", "lib", "intelephense.js"),
      pkg: "intelephense",
      args: ["--stdio"],
    })
    if (!proc) return
    return {
      process: proc,
      initialization: {
        telemetry: {
          enabled: false,
        },
      },
    }
  },
}

export const Prisma: Info = {
  id: "prisma",
  extensions: [".prisma"],
  root: NearestRoot(["schema.prisma", "prisma/schema.prisma", "prisma"], ["package.json"]),
  async spawn(root) {
    const prisma = which("prisma")
    if (!prisma) {
      log.info("prisma not found, please install prisma")
      return
    }
    return {
      process: spawn(prisma, ["language-server"], {
        cwd: root,
      }),
    }
  },
}

export const Dart: Info = {
  id: "dart",
  extensions: [".dart"],
  root: NearestRoot(["pubspec.yaml", "analysis_options.yaml"]),
  async spawn(root) {
    const dart = which("dart")
    if (!dart) {
      log.info("dart not found, please install dart first")
      return
    }
    return {
      process: spawn(dart, ["language-server", "--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Ocaml: Info = {
  id: "ocaml-lsp",
  extensions: [".ml", ".mli"],
  root: NearestRoot(["dune-project", "dune-workspace", ".merlin", "opam"]),
  async spawn(root) {
    const bin = which("ocamllsp")
    if (!bin) {
      log.info("ocamllsp not found, please install ocaml-lsp-server")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
export const BashLS: Info = {
  id: "bash",
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  root: async () => Instance.directory,
  async spawn(root) {
    const proc = await bunServer({
      root,
      binary: "bash-language-server",
      script: path.join(Global.Path.bin, "node_modules", "bash-language-server", "out", "cli.js"),
      pkg: "bash-language-server",
      args: ["start"],
    })
    if (!proc) return
    return {
      process: proc,
    }
  },
}

export const TerraformLS: Info = {
  id: "terraform",
  extensions: [".tf", ".tfvars"],
  root: NearestRoot([".terraform.lock.hcl", "terraform.tfstate", "main.tf"]),
  async spawn(root) {
    let bin = which("terraform-ls", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })

    if (!bin) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading terraform-ls from HashiCorp releases")

      const releaseResponse = await fetch("https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest", { signal: AbortSignal.timeout(30_000) })
      if (!releaseResponse.ok) {
        log.error("Failed to fetch terraform-ls release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        version?: string
        builds?: { arch?: string; os?: string; url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch

      const tfArch = arch === "arm64" ? "arm64" : "amd64"
      const tfPlatform = platform === "win32" ? "windows" : platform

      const builds = release.builds ?? []
      const build = builds.find((b) => b.arch === tfArch && b.os === tfPlatform)
      if (!build?.url) {
        log.error(`Could not find build for ${tfPlatform}/${tfArch} terraform-ls release version ${release.version}`)
        return
      }

      const downloadResponse = await fetch(build.url, { signal: AbortSignal.timeout(60_000) })
      if (!downloadResponse.ok) {
        log.error("Failed to download terraform-ls")
        return
      }

      const tempPath = path.join(Global.Path.bin, "terraform-ls.zip")
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      try {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract terraform-ls archive", { error })
            return false
          })
        if (!ok) return
      } finally {
        // Always remove the downloaded archive — previously only the
        // happy path reached this rm, leaving stuck downloads in the
        // bin directory after every failed extraction.
        await fs.rm(tempPath, { force: true }).catch(() => {})
      }

      bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract terraform-ls binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info(`installed terraform-ls`, { bin })
    }

    return {
      process: spawn(bin, ["serve"], {
        cwd: root,
      }),
      initialization: {
        experimentalFeatures: {
          prefillRequiredFields: true,
          validateOnSave: true,
        },
      },
    }
  },
}

export const TexLab: Info = {
  id: "texlab",
  extensions: [".tex", ".bib"],
  root: NearestRoot([".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"]),
  async spawn(root) {
    let bin = which("texlab", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })

    if (!bin) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading texlab from GitHub releases")

      const response = await fetch("https://api.github.com/repos/latex-lsp/texlab/releases/latest", { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) {
        log.error("Failed to fetch texlab release info")
        return
      }

      const release = (await response.json()) as {
        tag_name?: string
        assets?: { name?: string; browser_download_url?: string }[]
      }
      const version = release.tag_name?.replace(/^v/, "")
      if (!version) {
        log.error("texlab release did not include a version tag")
        return
      }

      const platform = process.platform
      const arch = process.arch

      const texArch = arch === "arm64" ? "aarch64" : "x86_64"
      const texPlatform = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux"
      const ext = platform === "win32" ? "zip" : "tar.gz"
      const assetName = `texlab-${texArch}-${texPlatform}.${ext}`

      const assets = release.assets ?? []
      const asset = releaseAsset(assets, assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in texlab release`)
        return
      }
      bin = (await installReleaseBin({
        id: "texlab",
        assetName,
        url: asset.browser_download_url,
        bin: path.join(Global.Path.bin, "texlab" + (platform === "win32" ? ".exe" : "")),
        platform,
        tarArgs: ext === "tar.gz" ? ["-xzf"] : undefined,
      })) ?? null
      if (!bin) return
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const DockerfileLS: Info = {
  id: "dockerfile",
  extensions: [".dockerfile", "Dockerfile"],
  root: async () => Instance.directory,
  async spawn(root) {
    const proc = await bunServer({
      root,
      binary: "docker-langserver",
      script: path.join(Global.Path.bin, "node_modules", "dockerfile-language-server-nodejs", "lib", "server.js"),
      pkg: "dockerfile-language-server-nodejs",
      args: ["--stdio"],
    })
    if (!proc) return
    return {
      process: proc,
    }
  },
}

export const Gleam: Info = {
  id: "gleam",
  extensions: [".gleam"],
  root: NearestRoot(["gleam.toml"]),
  async spawn(root) {
    const gleam = which("gleam")
    if (!gleam) {
      log.info("gleam not found, please install gleam first")
      return
    }
    return {
      process: spawn(gleam, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Clojure: Info = {
  id: "clojure-lsp",
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  root: NearestRoot(["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]),
  async spawn(root) {
    let bin = which("clojure-lsp")
    if (!bin && process.platform === "win32") {
      bin = which("clojure-lsp.exe")
    }
    if (!bin) {
      log.info("clojure-lsp not found, please install clojure-lsp first")
      return
    }
    return {
      process: spawn(bin, ["listen"], {
        cwd: root,
      }),
    }
  },
}

export const Nixd: Info = {
  id: "nixd",
  extensions: [".nix"],
  root: async (file) => {
    // First, look for flake.nix - the most reliable Nix project root indicator
    const flakeRoot = await NearestRoot(["flake.nix"])(file)
    if (flakeRoot && flakeRoot !== Instance.directory) return flakeRoot

    // If no flake.nix, fall back to git repository root
    if (Instance.worktree && Instance.worktree !== Instance.directory) return Instance.worktree

    // Finally, use the instance directory as fallback
    return Instance.directory
  },
  async spawn(root) {
    const nixd = which("nixd")
    if (!nixd) {
      log.info("nixd not found, please install nixd first")
      return
    }
    return {
      process: spawn(nixd, [], {
        cwd: root,
        env: {
          ...Env.sanitize(),
        },
      }),
    }
  },
}

export const Tinymist: Info = {
  id: "tinymist",
  extensions: [".typ", ".typc"],
  root: NearestRoot(["typst.toml"]),
  async spawn(root) {
    let bin = which("tinymist", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })

    if (!bin) {
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading tinymist from GitHub releases")

      const response = await fetch("https://api.github.com/repos/Myriad-Dreamin/tinymist/releases/latest", { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) {
        log.error("Failed to fetch tinymist release info")
        return
      }

      const release = (await response.json()) as {
        tag_name?: string
        assets?: { name?: string; browser_download_url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch

      const tinymistArch = arch === "arm64" ? "aarch64" : "x86_64"
      let tinymistPlatform: string
      let ext: string

      if (platform === "darwin") {
        tinymistPlatform = "apple-darwin"
        ext = "tar.gz"
      } else if (platform === "win32") {
        tinymistPlatform = "pc-windows-msvc"
        ext = "zip"
      } else {
        tinymistPlatform = "unknown-linux-gnu"
        ext = "tar.gz"
      }

      const assetName = `tinymist-${tinymistArch}-${tinymistPlatform}.${ext}`

      const assets = release.assets ?? []
      const asset = releaseAsset(assets, assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in tinymist release`)
        return
      }
      bin = (await installReleaseBin({
        id: "tinymist",
        assetName,
        url: asset.browser_download_url,
        bin: path.join(Global.Path.bin, "tinymist" + (platform === "win32" ? ".exe" : "")),
        platform,
        tarArgs: ext === "zip" ? undefined : ["-xzf", "--strip-components=1"],
      })) ?? null
      if (!bin) return
    }

    return {
      process: spawn(bin, { cwd: root }),
    }
  },
}

export const HLS: Info = {
  id: "haskell-language-server",
  extensions: [".hs", ".lhs"],
  root: NearestRoot(["stack.yaml", "cabal.project", "hie.yaml", "package.cabal"]),
  async spawn(root) {
    const bin = which("haskell-language-server-wrapper")
    if (!bin) {
      log.info("haskell-language-server-wrapper not found, please install haskell-language-server")
      return
    }
    return {
      process: spawn(bin, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const JuliaLS: Info = {
  id: "julials",
  extensions: [".jl"],
  root: NearestRoot(["Project.toml", "Manifest.toml"]),
  async spawn(root) {
    const julia = which("julia")
    if (!julia) {
      log.info("julia not found, please install julia first (https://julialang.org/downloads/)")
      return
    }
    return {
      process: spawn(julia, ["--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"], {
        cwd: root,
      }),
    }
  },
}
