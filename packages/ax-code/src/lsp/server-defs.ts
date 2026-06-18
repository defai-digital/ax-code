import path from "path"
import { Global } from "../global"
import { BunProc } from "../bun"
import { Env } from "../util/env"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { which } from "../util/which"
import { Module } from "@ax-code/util/module"
import { spawn } from "./launch"
import { JdtlsDataDir } from "./jdtls-data-dir"
import { OxlintSupport } from "./oxlint"
import { JS_LOCKFILES } from "@/constants/lsp"
import {
  bunServerHandle,
  bunSpawnInfo,
  globalBin,
  log,
  NearestRoot,
  nodeModuleScript,
  output,
  pathExists,
  resolveManagedToolBin,
  resolveTypescriptSdk,
  resolveTypescriptServer,
  run,
  spawnInfo,
  toolServer,
  venvBin,
  venvPython,
  type ServerInfo,
} from "./server-helpers"
import {
  PINNED_CHECKSUM_LSP_RELEASES,
  PINNED_DIRECT_LSP_RELEASES,
  PINNED_GITHUB_LSP_RELEASES,
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
  managedToolBin,
  managedToolDir,
  managedToolPath,
  releaseVersion,
  terraformLsAsset,
  terraformLsAssetUrl,
  terraformLsChecksumUrl,
  texlabAsset,
  tinymistAsset,
  zlsAsset,
  zlsReleaseForZig,
} from "./server-releases"

type Info = ServerInfo

const JS_RUNTIME_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"]
const JS_PROJECT_EXTENSIONS = [...JS_RUNTIME_EXTENSIONS, ".cjs", ".mts", ".cts"]
const JS_FRAMEWORK_EXTENSIONS = [...JS_PROJECT_EXTENSIONS, ".vue", ".astro", ".svelte"]
const PYTHON_EXTENSIONS = [".py", ".pyi"]
const SQL_EXTENSIONS = [".sql"]
const ANSIBLE_EXTENSIONS = [".yaml", ".yml"]
const PYTHON_ROOT_MARKERS = [
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
  "pyrightconfig.json",
]
const TY_ROOT_MARKERS = [
  "pyproject.toml",
  "ty.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
  "pyrightconfig.json",
]
const ANSIBLE_ROOT_MARKERS = [
  "ansible.cfg",
  "galaxy.yml",
  "galaxy.yaml",
  "playbook.yml",
  "playbook.yaml",
  "site.yml",
  "site.yaml",
  "roles",
  "playbooks",
  "group_vars",
  "host_vars",
  "inventory",
  "inventories",
  path.join("collections", "requirements.yml"),
  path.join("collections", "requirements.yaml"),
  path.join("roles", "requirements.yml"),
  path.join("roles", "requirements.yaml"),
]

const NearestRootWithMarker = (markers: string[]) => {
  return async (file: string) => {
    let current = path.dirname(file)
    while (true) {
      for (const marker of markers) {
        if (await Filesystem.exists(path.join(current, marker))) return current
      }
      if (current === Instance.directory) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return undefined
  }
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
  extensions: JS_RUNTIME_EXTENSIONS,
  async spawn(root) {
    const deno = which("deno")
    if (!deno) {
      log.info("deno not found, please install deno first")
      return
    }
    return spawnInfo(deno, root, ["lsp"])
  },
}

export const Typescript: Info = {
  id: "typescript",
  root: NearestRoot([...JS_LOCKFILES], ["deno.json", "deno.jsonc"]),
  extensions: JS_PROJECT_EXTENSIONS,
  async spawn(root) {
    const tsserver = resolveTypescriptServer()
    log.info("typescript server", { tsserver })
    if (!tsserver) return
    return bunSpawnInfo(root, "x", ["typescript-language-server", "--stdio"], {
      tsserver: {
        path: tsserver,
      },
    })
  },
}

export const Vue: Info = {
  id: "vue",
  extensions: [".vue"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "vue-language-server",
      script: nodeModuleScript("@vue", "language-server", "bin", "vue-language-server.js"),
      pkg: "@vue/language-server",
      args: ["--stdio"],
      // Leave empty; the server will auto-detect workspace TypeScript.
      initialization: {},
    })
  },
}

export const ESLint: Info = {
  id: "eslint",
  semantic: false,
  root: NearestRoot([...JS_LOCKFILES]),
  extensions: [...JS_PROJECT_EXTENSIONS, ".vue"],
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
      return bunSpawnInfo(root, managedServer, ["--stdio"])
    }

    const legacyServer = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
    if (await pathExists(legacyServer)) {
      log.warn(
        "using legacy unmanaged vscode-eslint install; remove shared-bin copy to switch to pinned managed installs",
        {
          serverPath: legacyServer,
        },
      )
      return bunSpawnInfo(root, legacyServer, ["--stdio"])
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

    return bunSpawnInfo(root, serverPath, ["--stdio"])
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
  extensions: JS_FRAMEWORK_EXTENSIONS,
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
      const hasLsp = await OxlintSupport.supportsLsp(lintBin)
      if (hasLsp) {
        return spawnInfo(lintBin, root, ["--lsp"])
      }
    }

    let serverBin = await resolveBin(serverTarget)
    if (!serverBin) {
      const found = which("oxc_language_server")
      if (found) serverBin = found
    }
    if (serverBin) {
      return spawnInfo(serverBin, root)
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
    ...JS_PROJECT_EXTENSIONS,
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
  extensions: PYTHON_EXTENSIONS,
  root: NearestRoot(TY_ROOT_MARKERS),
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
  extensions: PYTHON_EXTENSIONS,
  root: NearestRoot(PYTHON_ROOT_MARKERS),
  async spawn(root) {
    const initialization: Record<string, string> = {}
    const python = await venvPython(root)
    if (python) initialization["pythonPath"] = python

    return bunServerHandle({
      root,
      binary: "pyright-langserver",
      script: nodeModuleScript("pyright", "dist", "pyright-langserver.js"),
      pkg: "pyright",
      args: ["--stdio"],
      initialization,
    })
  },
}

export const ElixirLS: Info = {
  id: "elixir-ls",
  extensions: [".ex", ".exs"],
  root: NearestRoot(["mix.exs", "mix.lock"]),
  async spawn(root) {
    let binary = which("elixir-ls")
    if (binary) {
      return spawnInfo(binary, root)
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
      return spawnInfo(binary, root)
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
      return spawnInfo(bin, root)
    }

    const legacyBin = globalBin("zls")
    const hasLegacyBin = await pathExists(legacyBin)
    const useLegacyBin = () => {
      log.warn("using legacy unmanaged zls install; install zls on PATH or configure lsp.zls.command to pin it", {
        bin: legacyBin,
      })
      return spawnInfo(legacyBin, root)
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
      return spawnInfo(managedBin, root)
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

      bin =
        (await installPinnedGitHubReleaseAsset({
          id: "zls",
          repo: "zigtools/zls",
          tag: zlsTag,
          assetName,
          bin: managedBin,
          installDir: path.dirname(managedBin),
          platform,
          tarArgs: ["-xf"],
        })) ?? null
    }

    if (!bin && hasLegacyBin) return useLegacyBin()
    if (!bin) return

    return spawnInfo(bin, root)
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
      return spawnInfo(sourcekit, root)
    }

    // If sourcekit-lsp not found, check if xcrun is available
    // This is specific to macOS where sourcekit-lsp is typically installed with Xcode
    if (!which("xcrun")) return

    const lspLoc = await output(["xcrun", "--find", "sourcekit-lsp"])

    if (lspLoc.code !== 0) return

    const bin = lspLoc.text.trim()

    return spawnInfo(bin, root)
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
    return spawnInfo(bin, root)
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
    const selectedBin = await resolveManagedToolBin({ toolName: "clangd", managedBin, installedBin })
    if (selectedBin) return spawnInfo(selectedBin, root, args)

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
        return spawnInfo(candidate, root, args)
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

    return spawnInfo(bin, root, args)
  },
}

export const Svelte: Info = {
  id: "svelte",
  extensions: [".svelte"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "svelteserver",
      script: nodeModuleScript("svelte-language-server", "bin", "server.js"),
      pkg: "svelte-language-server",
      args: ["--stdio"],
      initialization: {},
    })
  },
}

export const Astro: Info = {
  id: "astro",
  extensions: [".astro"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    const tsdk = resolveTypescriptSdk()
    if (!tsdk) {
      log.info("typescript not found, required for Astro language server")
      return
    }

    return bunServerHandle({
      root,
      binary: "astro-ls",
      script: nodeModuleScript("@astrojs", "language-server", "bin", "nodeServer.js"),
      pkg: "@astrojs/language-server",
      args: ["--stdio"],
      initialization: {
        typescript: {
          tsdk,
        },
      },
    })
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
  await JdtlsDataDir.cleanupStale()
  const dataDir = await JdtlsDataDir.create()
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
        onStderr: (chunk: Buffer | string) => {
          const message = chunk.toString().trim()
          if (!message) return
          log.debug("jdtls stderr", { root, message: message.slice(0, 500) })
        },
      },
    )
  } catch (err) {
    // Avoid leaking temp dirs when spawn fails synchronously.
    await JdtlsDataDir.remove(dataDir).catch(() => {})
    throw err
  }

  void proc.exited
    .finally(() => {
      JdtlsDataDir.remove(dataDir).catch((err) => log.warn("failed to remove jdtls data dir", { dataDir, err }))
    })
    .catch((err) => {
      log.debug("jdtls process exited with error", { dataDir, err })
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
    const selectedLauncher = await resolveManagedToolBin({
      toolName: "kotlin-lsp",
      managedBin: managedLauncher,
      installedBin: installedLauncher,
    })
    if (selectedLauncher) return spawnInfo(selectedLauncher, root, ["--stdio"])

    const legacyLauncher = path.join(Global.Path.bin, "kotlin-ls", launcherName)
    if (await pathExists(legacyLauncher)) {
      log.warn(
        "using legacy unmanaged kotlin-lsp install; remove shared-bin copy to switch to pinned managed installs",
        {
          bin: legacyLauncher,
        },
      )
      return spawnInfo(legacyLauncher, root, ["--stdio"])
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

    return spawnInfo(launcher, root, ["--stdio"])
  },
}

export const YamlLS: Info = {
  id: "yaml-ls",
  extensions: [".yaml", ".yml"],
  root: NearestRoot([...JS_LOCKFILES]),
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "yaml-language-server",
      script: nodeModuleScript("yaml-language-server", "out", "server", "src", "server.js"),
      pkg: "yaml-language-server",
      args: ["--stdio"],
    })
  },
}

export const SQLLanguageServer: Info = {
  id: "sql-language-server",
  extensions: SQL_EXTENSIONS,
  root: async () => Instance.directory,
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "sql-language-server",
      script: nodeModuleScript("sql-language-server", "npm_bin", "cli.js"),
      pkg: "sql-language-server",
      args: ["up", "--method", "stdio"],
    })
  },
}

export const AnsibleLanguageServer: Info = {
  id: "ansible-language-server",
  extensions: ANSIBLE_EXTENSIONS,
  languageId: "ansible",
  root: NearestRootWithMarker(ANSIBLE_ROOT_MARKERS),
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "ansible-language-server",
      script: nodeModuleScript("@ansible", "ansible-language-server", "dist", "cli.cjs"),
      pkg: "@ansible/ansible-language-server",
    })
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
    const selectedBin = await resolveManagedToolBin({ toolName: "lua-language-server", managedBin, installedBin })
    if (selectedBin) return spawnInfo(selectedBin, root)

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
      return spawnInfo(legacyBin, root)
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

    return spawnInfo(bin, root)
  },
}

export const PHPIntelephense: Info = {
  id: "php intelephense",
  extensions: [".php"],
  root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "intelephense",
      script: nodeModuleScript("intelephense", "lib", "intelephense.js"),
      pkg: "intelephense",
      args: ["--stdio"],
      initialization: {
        telemetry: {
          enabled: false,
        },
      },
    })
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
    return spawnInfo(prisma, root, ["language-server"])
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
    return spawnInfo(dart, root, ["language-server", "--lsp"])
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
    return spawnInfo(bin, root)
  },
}
export const BashLS: Info = {
  id: "bash",
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  root: async () => Instance.directory,
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "bash-language-server",
      script: nodeModuleScript("bash-language-server", "out", "cli.js"),
      pkg: "bash-language-server",
      args: ["start"],
    })
  },
}

const TERRAFORM_LS_INITIALIZATION = {
  experimentalFeatures: {
    prefillRequiredFields: true,
    validateOnSave: true,
  },
}

const terraformLsHandle = (bin: string, root: string) => spawnInfo(bin, root, ["serve"], TERRAFORM_LS_INITIALIZATION)

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
    const selectedBin = await resolveManagedToolBin({ toolName: "terraform-ls", managedBin, installedBin })
    if (selectedBin) return terraformLsHandle(selectedBin, root)

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

    return terraformLsHandle(bin, root)
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
    const selectedBin = await resolveManagedToolBin({ toolName: "texlab", managedBin, installedBin })
    if (selectedBin) return spawnInfo(selectedBin, root)

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

    return spawnInfo(bin, root)
  },
}

export const DockerfileLS: Info = {
  id: "dockerfile",
  extensions: [".dockerfile", "Dockerfile"],
  root: async () => Instance.directory,
  async spawn(root) {
    return bunServerHandle({
      root,
      binary: "docker-langserver",
      script: nodeModuleScript("dockerfile-language-server-nodejs", "lib", "server.js"),
      pkg: "dockerfile-language-server-nodejs",
      args: ["--stdio"],
    })
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
    return spawnInfo(gleam, root, ["lsp"])
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
    return spawnInfo(bin, root, ["listen"])
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
    return spawnInfo(nixd, root)
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
    const selectedBin = await resolveManagedToolBin({ toolName: "tinymist", managedBin, installedBin })
    if (selectedBin) return spawnInfo(selectedBin, root)

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

    return spawnInfo(bin, root)
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
    return spawnInfo(bin, root, ["--lsp"])
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
    return spawnInfo(julia, root, ["--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"])
  },
}
