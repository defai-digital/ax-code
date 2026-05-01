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
import { Process } from "../util/process"
import { which } from "../util/which"
import { Module } from "@ax-code/util/module"
import { spawn } from "./launch"
import { withTimeout } from "../util/timeout"
import { JS_LOCKFILES } from "@/constants/lsp"
import {
  PINNED_CHECKSUM_LSP_RELEASES,
  PINNED_DIRECT_LSP_RELEASES,
  PINNED_GITHUB_LSP_RELEASES,
  bunServer,
  ensureTool,
  fetchGitHubReleaseByTag,
  globalBin,
  globalTool,
  jdtlsAssetUrl,
  jdtlsChecksumUrl,
  installReleaseBin,
  installPinnedChecksumReleaseAsset,
  installPinnedGitHubReleaseAsset,
  kotlinLsAsset,
  kotlinLsAssetUrl,
  kotlinLsChecksumUrl,
  llvmClangdAsset,
  llvmReleaseVersion,
  luaLsAsset,
  luaLsReleaseTarget,
  log,
  managedToolBin,
  managedToolDir,
  managedToolPath,
  NearestRoot,
  output,
  pathExists,
  releaseAsset,
  releaseAssetSha256,
  releaseVersion,
  run,
  spawnInfo,
  terraformLsAsset,
  terraformLsAssetUrl,
  terraformLsChecksumUrl,
  texlabAsset,
  tinymistAsset,
  toolServer,
  toolBin,
  venvBin,
  venvPython,
  zlsAsset,
  zlsReleaseForZig,
  type ServerInfo,
} from "./server-helpers"

type Info = ServerInfo

const OXLINT_LSP_SUPPORT_CACHE_MAX = 64
const oxlintLspSupportCache = new Map<string, boolean | Promise<boolean>>()

function setOxlintSupportCache(lintBin: string, value: boolean | Promise<boolean>) {
  if (oxlintLspSupportCache.has(lintBin)) {
    oxlintLspSupportCache.delete(lintBin)
  }
  oxlintLspSupportCache.set(lintBin, value)
  while (oxlintLspSupportCache.size > OXLINT_LSP_SUPPORT_CACHE_MAX) {
    const oldest = oxlintLspSupportCache.keys().next().value
    if (!oldest) break
    oxlintLspSupportCache.delete(oldest)
  }
}

async function oxlintSupportsLsp(lintBin: string): Promise<boolean> {
  const cached = oxlintLspSupportCache.get(lintBin)
  if (typeof cached === "boolean") return cached
  if (cached) return cached

  const pending = (async () => {
    let help = ""
    let proc: ReturnType<typeof spawn> | undefined
    try {
      proc = spawn(lintBin, ["--help"])
      const helpPromise = proc.stdout ? text(proc.stdout) : Promise.resolve("")
      ;[help] = await withTimeout(
        Promise.all([helpPromise, proc.exited]),
        5_000,
        `oxlint --help timed out for ${lintBin}`,
      )
    } catch (error) {
      if (proc) {
        proc.kill()
        await withTimeout(proc.exited, 500, `oxlint process cleanup timed out`).catch(() => {})
      }
      log.warn("oxlint --help check failed", { lintBin, error })
      setOxlintSupportCache(lintBin, false)
      return false
    }

    const supports = help.includes("--lsp")
    setOxlintSupportCache(lintBin, supports)
    return supports
  })()

  setOxlintSupportCache(lintBin, pending)
  return pending
}

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
    const pinned = PINNED_DIRECT_LSP_RELEASES.eslint
    const platform = process.platform
    const arch = process.arch
    const eslint = Module.resolve("eslint", Instance.directory)
    if (!eslint) return
    log.info("spawning eslint server")
    const managedServer = managedToolPath(
      "vscode-eslint",
      pinned.version,
      path.join("extension", "server", "out", "eslintServer.js"),
      platform,
      arch,
    )
    if (await pathExists(managedServer)) {
      return {
        process: spawn(BunProc.which(), [managedServer, "--stdio"], {
          cwd: root,
          env: {
            ...Env.sanitize(),
            BUN_BE_BUN: "1",
          },
        }),
      }
    }

    const legacyServer = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
    if (await pathExists(legacyServer)) {
      log.warn(
        "using legacy unmanaged vscode-eslint install; remove shared-bin copy to switch to pinned managed installs",
        {
          serverPath: legacyServer,
        },
      )
      return {
        process: spawn(BunProc.which(), [legacyServer, "--stdio"], {
          cwd: root,
          env: {
            ...Env.sanitize(),
            BUN_BE_BUN: "1",
          },
        }),
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    log.info("downloading pinned VS Code ESLint server", {
      version: pinned.version,
    })

    const serverPath =
      (await installReleaseBin({
        id: "vscode-eslint",
        assetName: pinned.assetName,
        url: pinned.url,
        bin: managedServer,
        installDir: managedToolDir("vscode-eslint", pinned.version, platform, arch),
        platform,
        sha256: pinned.sha256,
        archiveType: "zip",
        inflateGzip: true,
      })) ?? null
    if (!serverPath) return

    return {
      process: spawn(BunProc.which(), [serverPath, "--stdio"], {
        cwd: root,
        env: {
          ...Env.sanitize(),
          BUN_BE_BUN: "1",
        },
      }),
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
      const hasLsp = await oxlintSupportsLsp(lintBin)
      if (hasLsp) {
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
    if (binary) {
      return {
        process: spawn(binary, {
          cwd: root,
        }),
      }
    }

    binary = path.join(
      Global.Path.bin,
      "elixir-ls-master",
      "release",
      process.platform === "win32" ? "language_server.bat" : "language_server.sh",
    )
    if (await pathExists(binary)) {
      log.warn(
        "using legacy unmanaged elixir-ls install; reinstall manually to replace the old runtime Mix.install path",
        {
          bin: binary,
        },
      )
      return {
        process: spawn(binary, {
          cwd: root,
        }),
      }
    }

    log.error(
      "Automatic elixir-ls installation is disabled because the upstream release still performs runtime Mix.install from GitHub. Install elixir-ls manually or configure a custom LSP command.",
      { release: PINNED_GITHUB_LSP_RELEASES.elixirLs.tag },
    )
    return
  },
}

export const Zls: Info = {
  id: "zls",
  extensions: [".zig", ".zon"],
  root: NearestRoot(["build.zig"]),
  async spawn(root) {
    let bin = which("zls")
    if (bin) {
      return {
        process: spawn(bin, {
          cwd: root,
        }),
      }
    }

    const legacyBin = globalBin("zls")
    const hasLegacyBin = await pathExists(legacyBin)
    const useLegacyBin = () => {
      log.warn("using legacy unmanaged zls install; install zls on PATH or configure lsp.zls.command to pin it", {
        bin: legacyBin,
      })
      return {
        process: spawn(legacyBin, {
          cwd: root,
        }),
      }
    }

    const zig = which("zig")
    if (!zig) {
      if (hasLegacyBin) return useLegacyBin()
      log.error("Zig is required to use zls. Please install Zig first.")
      return
    }

    const zigVersion = await output([zig, "version"])
    if (zigVersion.code !== 0) {
      if (hasLegacyBin) return useLegacyBin()
      log.error("Failed to determine Zig version for zls compatibility")
      return
    }

    const zlsTag = zlsReleaseForZig(zigVersion.text)
    if (!zlsTag) {
      if (hasLegacyBin) return useLegacyBin()
      log.error("Automatic zls install only supports stable Zig releases with a pinned compatibility mapping", {
        zigVersion: zigVersion.text.trim(),
      })
      return
    }

    const platform = process.platform
    const arch = process.arch
    const managedBin = managedToolBin("zls", zlsTag, platform, arch)
    if (await pathExists(managedBin)) {
      return {
        process: spawn(managedBin, {
          cwd: root,
        }),
      }
    }

    if (!Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) {
      log.info("downloading pinned zls release", {
        zlsTag,
        zigVersion: zigVersion.text.trim(),
      })

      const assetName = zlsAsset(platform, arch)
      if (!assetName) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
        return
      }

      const release = await fetchGitHubReleaseByTag({
        repo: "zigtools/zls",
        tag: zlsTag,
      })
      if (!release) {
        log.error("Failed to fetch zls release info", { zlsTag })
      } else {
        const asset = releaseAsset(release.assets ?? [], assetName)
        const sha256 = asset ? releaseAssetSha256(asset) : undefined
        if (!asset?.browser_download_url || !sha256) {
          log.error(`Could not find a verifiable ${assetName} asset in zls release ${zlsTag}`)
        } else {
          bin =
            (await installReleaseBin({
              id: "zls",
              assetName,
              url: asset.browser_download_url,
              bin: managedBin,
              installDir: path.dirname(managedBin),
              platform,
              sha256,
              tarArgs: ["-xf"],
            })) ?? null
        }
      }
    }

    if (!bin && hasLegacyBin) return useLegacyBin()
    if (!bin) return

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
    const pinned = PINNED_GITHUB_LSP_RELEASES.clangd
    const platform = process.platform
    const arch = process.arch
    const args = ["--background-index", "--clang-tidy"]
    const ext = platform === "win32" ? ".exe" : ""
    const version = llvmReleaseVersion(pinned.tag)
    const managedBin = managedToolPath("clangd", version, path.join("bin", "clangd" + ext), platform, arch)
    const installedBin = which("clangd")
    if (installedBin && !installedBin.startsWith(Global.Path.bin)) {
      return {
        process: spawn(installedBin, args, {
          cwd: root,
        }),
      }
    }

    if (await pathExists(managedBin)) {
      return {
        process: spawn(managedBin, args, {
          cwd: root,
        }),
      }
    }

    if (installedBin) {
      log.warn("using legacy unmanaged clangd install; remove shared-bin copy to switch to pinned managed installs", {
        bin: installedBin,
      })
      return {
        process: spawn(installedBin, args, {
          cwd: root,
        }),
      }
    }

    const entries = await fs.readdir(Global.Path.bin, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith("clangd_")) continue
      const candidate = path.join(Global.Path.bin, entry.name, "bin", "clangd" + ext)
      if (await pathExists(candidate)) {
        log.warn(
          "using legacy unmanaged clangd install; remove extracted shared-bin copy to switch to pinned managed installs",
          {
            bin: candidate,
          },
        )
        return {
          process: spawn(candidate, args, {
            cwd: root,
          }),
        }
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = llvmClangdAsset(pinned.tag, platform, arch)
    if (!assetName) {
      log.error(`Platform ${platform} and architecture ${arch} is not supported by clangd`)
      return
    }

    log.info("downloading pinned clangd release", {
      tag: pinned.tag,
    })

    const bin =
      (await installPinnedGitHubReleaseAsset({
        id: "clangd",
        repo: pinned.repo,
        tag: pinned.tag,
        assetName,
        bin: managedBin,
        installDir: managedToolDir("clangd", version, platform, arch),
        platform,
        tarArgs: ["-xJf", "--strip-components=1"],
      })) ?? null
    if (!bin) return

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

const spawnJdtls = async (java: string, root: string, distPath: string, launcherDir: string) => {
  const jarFileName = (await fs.readdir(launcherDir).catch(() => []))
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
    // Avoid leaking temp dirs when spawn fails synchronously.
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }

  void proc.exited.finally(() => {
    fs.rm(dataDir, { recursive: true, force: true }).catch((err) =>
      log.warn("failed to remove jdtls data dir", { dataDir, err }),
    )
  })
  proc.stderr.on("data", (chunk: Buffer | string) => {
    const message = chunk.toString().trim()
    if (!message) return
    log.debug("jdtls stderr", { root, message: message.slice(0, 500) })
  })

  return { process: proc }
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
    const pinned = PINNED_CHECKSUM_LSP_RELEASES.jdtls
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

    const platform = process.platform
    const arch = process.arch
    const distPath = managedToolDir("jdtls", pinned.version, platform, arch)
    const launcherDir = path.join(distPath, "plugins")
    if (!(await pathExists(launcherDir))) {
      const legacyDistPath = path.join(Global.Path.bin, "jdtls")
      const legacyLauncherDir = path.join(legacyDistPath, "plugins")
      if (await pathExists(legacyLauncherDir)) {
        log.warn("using legacy unmanaged jdtls install; remove shared-bin copy to switch to pinned managed installs", {
          distPath: legacyDistPath,
        })
        return spawnJdtls(java, root, legacyDistPath, legacyLauncherDir)
      }

      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading pinned JDTLS LSP server.", {
        version: pinned.version,
      })

      const installed =
        (await installPinnedChecksumReleaseAsset({
          id: "jdtls",
          assetName: pinned.assetName,
          url: jdtlsAssetUrl(pinned.assetName),
          checksumUrl: jdtlsChecksumUrl(pinned.assetName),
          bin: distPath,
          verifyPath: launcherDir,
          installDir: distPath,
          platform,
          tarArgs: ["-xzf"],
          skipChmod: true,
        })) ?? null
      if (!installed) return
    }

    return spawnJdtls(java, root, distPath, launcherDir)
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
    const pinned = PINNED_CHECKSUM_LSP_RELEASES.kotlinLs
    const platform = process.platform
    const arch = process.arch
    const launcherName = platform === "win32" ? "kotlin-lsp.cmd" : "kotlin-lsp.sh"
    const managedLauncher = managedToolPath("kotlin-ls", pinned.version, launcherName, platform, arch)
    const installedLauncher =
      which("kotlin-lsp") ?? (platform === "win32" ? which("kotlin-lsp.cmd") : which("kotlin-lsp.sh"))
    if (installedLauncher && !installedLauncher.startsWith(Global.Path.bin)) {
      return {
        process: spawn(installedLauncher, ["--stdio"], {
          cwd: root,
        }),
      }
    }

    if (await pathExists(managedLauncher)) {
      return {
        process: spawn(managedLauncher, ["--stdio"], {
          cwd: root,
        }),
      }
    }

    if (installedLauncher) {
      log.warn(
        "using legacy unmanaged kotlin-lsp install; remove shared-bin copy to switch to pinned managed installs",
        {
          bin: installedLauncher,
        },
      )
      return {
        process: spawn(installedLauncher, ["--stdio"], {
          cwd: root,
        }),
      }
    }

    const legacyLauncher = path.join(Global.Path.bin, "kotlin-ls", launcherName)
    if (await pathExists(legacyLauncher)) {
      log.warn(
        "using legacy unmanaged kotlin-lsp install; remove shared-bin copy to switch to pinned managed installs",
        {
          bin: legacyLauncher,
        },
      )
      return {
        process: spawn(legacyLauncher, ["--stdio"], {
          cwd: root,
        }),
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = kotlinLsAsset(pinned.version, platform, arch)
    const assetUrl = kotlinLsAssetUrl(pinned.version, platform, arch)
    const checksumUrl = kotlinLsChecksumUrl(pinned.version, platform, arch)
    if (!assetName || !assetUrl || !checksumUrl) {
      log.error(`Platform ${platform}/${arch} is not supported by Kotlin LSP`)
      return
    }

    log.info("downloading pinned kotlin-lsp release", {
      version: pinned.version,
    })

    const launcher =
      (await installPinnedChecksumReleaseAsset({
        id: "kotlin-lsp",
        assetName,
        url: assetUrl,
        checksumUrl,
        bin: managedLauncher,
        installDir: managedToolDir("kotlin-ls", pinned.version, platform, arch),
        platform,
      })) ?? null
    if (!launcher) return

    return {
      process: spawn(launcher, ["--stdio"], {
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
    const pinned = PINNED_GITHUB_LSP_RELEASES.luaLs
    const platform = process.platform
    const arch = process.arch
    const version = releaseVersion(pinned.tag)
    const managedBin = managedToolPath(
      "lua-language-server",
      version,
      path.join("bin", "lua-language-server" + (platform === "win32" ? ".exe" : "")),
      platform,
      arch,
    )
    const installedBin = which("lua-language-server")
    if (installedBin && !installedBin.startsWith(Global.Path.bin)) {
      return {
        process: spawn(installedBin, {
          cwd: root,
        }),
      }
    }

    if (await pathExists(managedBin)) {
      return {
        process: spawn(managedBin, {
          cwd: root,
        }),
      }
    }

    if (installedBin) {
      log.warn(
        "using legacy unmanaged lua-language-server install; remove shared-bin copy to switch to pinned managed installs",
        { bin: installedBin },
      )
      return {
        process: spawn(installedBin, {
          cwd: root,
        }),
      }
    }

    const target = luaLsReleaseTarget(platform, arch)
    const legacyBin =
      target &&
      path.join(
        Global.Path.bin,
        `lua-language-server-${target.arch}-${target.platform}`,
        "bin",
        "lua-language-server" + (platform === "win32" ? ".exe" : ""),
      )
    if (legacyBin && (await pathExists(legacyBin))) {
      log.warn(
        "using legacy unmanaged lua-language-server install; remove shared-bin copy to switch to pinned managed installs",
        { bin: legacyBin },
      )
      return {
        process: spawn(legacyBin, {
          cwd: root,
        }),
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = luaLsAsset(pinned.tag, platform, arch)
    if (!target || !assetName) {
      log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
      return
    }

    log.info("downloading pinned lua-language-server release", {
      tag: pinned.tag,
    })

    const bin =
      (await installPinnedGitHubReleaseAsset({
        id: "lua-language-server",
        repo: pinned.repo,
        tag: pinned.tag,
        assetName,
        bin: managedBin,
        installDir: managedToolDir("lua-language-server", version, platform, arch),
        platform,
        tarArgs: target.ext === "zip" ? undefined : ["-xzf"],
      })) ?? null
    if (!bin) return

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
    const pinned = PINNED_CHECKSUM_LSP_RELEASES.terraformLs
    const platform = process.platform
    const arch = process.arch
    const managedBin = managedToolBin("terraform-ls", pinned.version, platform, arch)
    const installedBin = which("terraform-ls")
    if (installedBin && !installedBin.startsWith(Global.Path.bin)) {
      return {
        process: spawn(installedBin, ["serve"], {
          cwd: root,
        }),
        initialization: {
          experimentalFeatures: {
            prefillRequiredFields: true,
            validateOnSave: true,
          },
        },
      }
    }

    if (await pathExists(managedBin)) {
      return {
        process: spawn(managedBin, ["serve"], {
          cwd: root,
        }),
        initialization: {
          experimentalFeatures: {
            prefillRequiredFields: true,
            validateOnSave: true,
          },
        },
      }
    }

    if (installedBin) {
      log.warn(
        "using legacy unmanaged terraform-ls install; remove shared-bin copy to switch to pinned managed installs",
        {
          bin: installedBin,
        },
      )
      return {
        process: spawn(installedBin, ["serve"], {
          cwd: root,
        }),
        initialization: {
          experimentalFeatures: {
            prefillRequiredFields: true,
            validateOnSave: true,
          },
        },
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = terraformLsAsset(pinned.version, platform, arch)
    const assetUrl = terraformLsAssetUrl(pinned.version, platform, arch)
    if (!assetName || !assetUrl) {
      log.error(`Platform ${platform}/${arch} is not supported by terraform-ls`)
      return
    }

    log.info("downloading pinned terraform-ls release", {
      version: pinned.version,
    })

    const bin =
      (await installPinnedChecksumReleaseAsset({
        id: "terraform-ls",
        assetName,
        url: assetUrl,
        checksumUrl: terraformLsChecksumUrl(pinned.version),
        bin: managedBin,
        installDir: managedToolDir("terraform-ls", pinned.version, platform, arch),
        platform,
      })) ?? null
    if (!bin) return

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
    const pinned = PINNED_GITHUB_LSP_RELEASES.texlab
    const platform = process.platform
    const arch = process.arch
    const version = releaseVersion(pinned.tag)
    const managedBin = managedToolBin("texlab", version, platform, arch)
    const installedBin = which("texlab")
    if (installedBin && !installedBin.startsWith(Global.Path.bin)) {
      return {
        process: spawn(installedBin, {
          cwd: root,
        }),
      }
    }

    if (await pathExists(managedBin)) {
      return {
        process: spawn(managedBin, {
          cwd: root,
        }),
      }
    }

    if (installedBin) {
      log.warn("using legacy unmanaged texlab install; remove shared-bin copy to switch to pinned managed installs", {
        bin: installedBin,
      })
      return {
        process: spawn(installedBin, {
          cwd: root,
        }),
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = texlabAsset(platform, arch)
    if (!assetName) {
      log.error(`Platform ${platform} and architecture ${arch} is not supported by texlab`)
      return
    }

    log.info("downloading pinned texlab release", {
      tag: pinned.tag,
    })

    const bin =
      (await installPinnedGitHubReleaseAsset({
        id: "texlab",
        repo: pinned.repo,
        tag: pinned.tag,
        assetName,
        bin: managedBin,
        installDir: path.dirname(managedBin),
        platform,
        tarArgs: platform === "win32" ? undefined : ["-xzf"],
      })) ?? null
    if (!bin) return

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
    const pinned = PINNED_GITHUB_LSP_RELEASES.tinymist
    const platform = process.platform
    const arch = process.arch
    const version = releaseVersion(pinned.tag)
    const managedBin = managedToolBin("tinymist", version, platform, arch)
    const installedBin = which("tinymist")
    if (installedBin && !installedBin.startsWith(Global.Path.bin)) {
      return {
        process: spawn(installedBin, { cwd: root }),
      }
    }

    if (await pathExists(managedBin)) {
      return {
        process: spawn(managedBin, { cwd: root }),
      }
    }

    if (installedBin) {
      log.warn("using legacy unmanaged tinymist install; remove shared-bin copy to switch to pinned managed installs", {
        bin: installedBin,
      })
      return {
        process: spawn(installedBin, { cwd: root }),
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = tinymistAsset(platform, arch)
    if (!assetName) {
      log.error(`Platform ${platform} and architecture ${arch} is not supported by tinymist`)
      return
    }

    log.info("downloading pinned tinymist release", {
      tag: pinned.tag,
    })

    const bin =
      (await installPinnedGitHubReleaseAsset({
        id: "tinymist",
        repo: pinned.repo,
        tag: pinned.tag,
        assetName,
        bin: managedBin,
        installDir: path.dirname(managedBin),
        platform,
        tarArgs: platform === "win32" ? undefined : ["-xzf", "--strip-components=1"],
      })) ?? null
    if (!bin) return

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
