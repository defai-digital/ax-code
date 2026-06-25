import path from "path"
import fs from "fs/promises"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { Flag } from "../../flag/flag"
import { which } from "../../util/which"
import { Env } from "../../util/env"
import { Filesystem } from "../../util/filesystem"
import { spawn } from "../launch"
import { JdtlsDataDir } from "../jdtls-data-dir"
import {
  log,
  NearestRoot,
  globalBin,
  output,
  pathExists,
  resolveManagedToolBin,
  run,
  spawnInfo,
  toolServer,
} from "../server-helpers"
import {
  PINNED_CHECKSUM_LSP_RELEASES,
  PINNED_GITHUB_LSP_RELEASES,
  installPinnedChecksumReleaseAsset,
  installPinnedGitHubReleaseAsset,
  jdtlsAssetUrl,
  jdtlsChecksumUrl,
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
  zlsReleaseForZig,
  zlsAsset,
} from "../server-releases"
import type { ServerInfo as Info } from "../server-helpers"

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

export const ElixirLS: Info = {
  id: "elixir-ls",
  extensions: [".ex", ".exs"],
  root: NearestRoot(["mix.exs", "mix.lock"]),
  async spawn(root) {
    let binary = which("elixir-ls")
    if (binary) return spawnInfo(binary, root)

    binary = path.join(
      Global.Path.bin,
      "elixir-ls-master",
      "release",
      process.platform === "win32" ? "language_server.bat" : "language_server.sh",
    )
    if (await pathExists(binary)) {
      log.warn("using legacy unmanaged elixir-ls install; reinstall manually to replace the old runtime Mix.install path", { bin: binary })
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
    if (bin) return spawnInfo(bin, root)

    const legacyBin = globalBin("zls")
    const hasLegacyBin = await pathExists(legacyBin)
    const useLegacyBin = () => {
      log.warn("using legacy unmanaged zls install; install zls on PATH or configure lsp.zls.command to pin it", { bin: legacyBin })
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
      log.error("Automatic zls install only supports stable Zig releases with a pinned compatibility mapping", { zigVersion: zigVersion.text.trim() })
      return
    }

    const platform = process.platform
    const arch = process.arch
    const managedBin = managedToolBin("zls", zlsTag, platform, arch)
    if (await pathExists(managedBin)) return spawnInfo(managedBin, root)

    if (!Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) {
      log.info("downloading pinned zls release", { zlsTag, zigVersion: zigVersion.text.trim() })
      const assetName = zlsAsset(platform, arch)
      if (!assetName) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
        return
      }
      bin = (await installPinnedGitHubReleaseAsset({
        id: "zls", repo: "zigtools/zls", tag: zlsTag, assetName, bin: managedBin,
        installDir: path.dirname(managedBin), platform, tarArgs: ["-xf"],
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
    const sourcekit = which("sourcekit-lsp")
    if (sourcekit) return spawnInfo(sourcekit, root)
    if (!which("xcrun")) return
    const lspLoc = await output(["xcrun", "--find", "sourcekit-lsp"])
    if (lspLoc.code !== 0) return
    return spawnInfo(lspLoc.text.trim(), root)
  },
}

export const RustAnalyzer: Info = {
  id: "rust",
  root: async (root) => {
    const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(root)
    if (crateRoot === undefined) return undefined
    let currentDir = crateRoot
    while (currentDir !== path.dirname(currentDir)) {
      const cargoTomlPath = path.join(currentDir, "Cargo.toml")
      try {
        const cargoTomlContent = await Filesystem.readText(cargoTomlPath)
        if (cargoTomlContent.includes("[workspace]")) return currentDir
      } catch (err) {}
      const parentDir = path.dirname(currentDir)
      if (parentDir === currentDir) break
      currentDir = parentDir
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
        log.warn("using legacy unmanaged clangd install; remove extracted shared-bin copy to switch to pinned managed installs", { bin: candidate })
        return spawnInfo(candidate, root, args)
      }
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = llvmClangdAsset(pinned.tag, platform, arch)
    if (!assetName) {
      log.error(`Platform ${platform} and architecture ${arch} is not supported by clangd`)
      return
    }
    log.info("downloading pinned clangd release", { tag: pinned.tag })
    const bin = (await installPinnedGitHubReleaseAsset({
      id: "clangd", repo: pinned.repo, tag: pinned.tag, assetName, bin: managedBin,
      installDir: managedToolDir("clangd", version, platform, arch), platform, tarArgs: ["-xJf", "--strip-components=1"],
    })) ?? null
    if (!bin) return
    return spawnInfo(bin, root, args)
  },
}

const spawnJdtls = async (java: string, root: string, distPath: string, launcherDir: string) => {
  const jarFileName = (await fs.readdir(launcherDir).catch(() => []))
    .find((item) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(item))?.trim()
  if (!jarFileName) {
    log.error(`Failed to locate the JDTLS launcher jar in: ${launcherDir}`)
    return
  }
  const launcherJar = path.join(launcherDir, jarFileName)
  if (!(await pathExists(launcherJar))) {
    log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
    return
  }
  const configFile = path.join(distPath, (() => {
    switch (process.platform) {
      case "darwin": return "config_mac"
      case "linux": return "config_linux"
      case "win32": return "config_win"
      default: return "config_linux"
    }
  })())
  await JdtlsDataDir.cleanupStale()
  const dataDir = await JdtlsDataDir.create()
  let proc
  try {
    proc = spawn(java, [
      "-jar", launcherJar, "-configuration", configFile, "-data", dataDir,
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Dlog.level=ALL", "--add-modules=ALL-SYSTEM",
      "--add-opens java.base/java.util=ALL-UNNAMED",
      "--add-opens java.base/java.lang=ALL-UNNAMED",
    ], {
      cwd: root,
      onStderr: (chunk: Buffer | string) => {
        const message = chunk.toString().trim()
        if (!message) return
        log.debug("jdtls stderr", { root, message: message.slice(0, 500) })
      },
    })
  } catch (err) {
    await JdtlsDataDir.remove(dataDir).catch(() => {})
    throw err
  }
  void proc.exited
    .finally(() => { JdtlsDataDir.remove(dataDir).catch((err) => log.warn("failed to remove jdtls data dir", { dataDir, err })) })
    .catch((err) => { log.debug("jdtls process exited with error", { dataDir, err }) })
  return { process: proc }
}

export const JDTLS: Info = {
  id: "jdtls",
  root: async (file) => {
    const settingsMarkers = ["settings.gradle", "settings.gradle.kts"]
    const gradleMarkers = ["gradlew", "gradlew.bat"]
    const exclusionsForMonorepos = gradleMarkers.concat(settingsMarkers)
    const [projectRoot, wrapperRoot, settingsRoot] = await Promise.all([
      NearestRoot(["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"], exclusionsForMonorepos)(file),
      NearestRoot(gradleMarkers, settingsMarkers)(file),
      NearestRoot(settingsMarkers)(file),
    ])
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
        log.warn("using legacy unmanaged jdtls install; remove shared-bin copy to switch to pinned managed installs", { distPath: legacyDistPath })
        return spawnJdtls(java, root, legacyDistPath, legacyLauncherDir)
      }
      if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading pinned JDTLS LSP server.", { version: pinned.version })
      const installed = (await installPinnedChecksumReleaseAsset({
        id: "jdtls", assetName: pinned.assetName, url: jdtlsAssetUrl(pinned.assetName),
        checksumUrl: jdtlsChecksumUrl(pinned.assetName), bin: distPath, verifyPath: launcherDir,
        installDir: distPath, platform, tarArgs: ["-xzf"], skipChmod: true,
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
    const settingsRoot = await NearestRoot(["settings.gradle.kts", "settings.gradle"])(file)
    if (settingsRoot) return settingsRoot
    const wrapperRoot = await NearestRoot(["gradlew", "gradlew.bat"])(file)
    if (wrapperRoot) return wrapperRoot
    const buildRoot = await NearestRoot(["build.gradle.kts", "build.gradle"])(file)
    if (buildRoot) return buildRoot
    return NearestRoot(["pom.xml"])(file)
  },
  async spawn(root) {
    const pinned = PINNED_CHECKSUM_LSP_RELEASES.kotlinLs
    const platform = process.platform
    const arch = process.arch
    const launcherName = platform === "win32" ? "kotlin-lsp.cmd" : "kotlin-lsp.sh"
    const managedLauncher = managedToolPath("kotlin-ls", pinned.version, launcherName, platform, arch)
    const installedLauncher = which("kotlin-lsp") ?? (platform === "win32" ? which("kotlin-lsp.cmd") : which("kotlin-lsp.sh"))
    const selectedLauncher = await resolveManagedToolBin({ toolName: "kotlin-lsp", managedBin: managedLauncher, installedBin: installedLauncher })
    if (selectedLauncher) return spawnInfo(selectedLauncher, root, ["--stdio"])

    const legacyLauncher = path.join(Global.Path.bin, "kotlin-ls", launcherName)
    if (await pathExists(legacyLauncher)) {
      log.warn("using legacy unmanaged kotlin-lsp install; remove shared-bin copy to switch to pinned managed installs", { bin: legacyLauncher })
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
    log.info("downloading pinned kotlin-lsp release", { version: pinned.version })
    const launcher = (await installPinnedChecksumReleaseAsset({
      id: "kotlin-lsp", assetName, url: assetUrl, checksumUrl, bin: managedLauncher,
      installDir: managedToolDir("kotlin-ls", pinned.version, platform, arch), platform,
    })) ?? null
    if (!launcher) return
    return spawnInfo(launcher, root, ["--stdio"])
  },
}

export const LuaLS: Info = {
  id: "lua-ls",
  root: NearestRoot([".luarc.json", ".luarc.jsonc", ".luacheckrc", ".stylua.toml", "stylua.toml", "selene.toml", "selene.yml"]),
  extensions: [".lua"],
  async spawn(root) {
    const pinned = PINNED_GITHUB_LSP_RELEASES.luaLs
    const platform = process.platform
    const arch = process.arch
    const version = releaseVersion(pinned.tag)
    const managedBin = managedToolPath("lua-language-server", version, path.join("bin", "lua-language-server" + (platform === "win32" ? ".exe" : "")), platform, arch)
    const installedBin = which("lua-language-server")
    const selectedBin = await resolveManagedToolBin({ toolName: "lua-language-server", managedBin, installedBin })
    if (selectedBin) return spawnInfo(selectedBin, root)

    const target = luaLsReleaseTarget(platform, arch)
    const legacyBin = target && path.join(Global.Path.bin, `lua-language-server-${target.arch}-${target.platform}`, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))
    if (legacyBin && (await pathExists(legacyBin))) {
      log.warn("using legacy unmanaged lua-language-server install; remove shared-bin copy to switch to pinned managed installs", { bin: legacyBin })
      return spawnInfo(legacyBin, root)
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    const assetName = luaLsAsset(pinned.tag, platform, arch)
    if (!target || !assetName) {
      log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
      return
    }
    log.info("downloading pinned lua-language-server release", { tag: pinned.tag })
    const bin = (await installPinnedGitHubReleaseAsset({
      id: "lua-language-server", repo: pinned.repo, tag: pinned.tag, assetName, bin: managedBin,
      installDir: managedToolDir("lua-language-server", version, platform, arch), platform,
      tarArgs: target.ext === "zip" ? undefined : ["-xzf"],
    })) ?? null
    if (!bin) return
    return spawnInfo(bin, root)
  },
}
