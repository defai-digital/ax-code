import path from "path"
import { Global } from "../../global"
import { BunProc } from "../../bun"
import { toolRunner } from "../../bun/package-manager"
import { Module } from "@ax-code/util/module"
import { JS_LOCKFILES } from "@/constants/lsp"
import {
  bunServerHandle,
  bunSpawnInfo,
  toolSpawnInfo,
  log,
  NearestRoot,
  nodeModuleScript,
  pathExists,
  resolveTypescriptSdk,
  resolveTypescriptServer,
  spawnInfo,
} from "../server-helpers"
import {
  PINNED_DIRECT_LSP_RELEASES,
  PINNED_GITHUB_LSP_RELEASES,
  installReleaseBin,
  installPinnedGitHubReleaseAsset,
  managedToolDir,
  managedToolPath,
} from "../server-releases"
import { OxlintSupport } from "../oxlint"
import { Instance } from "../../project/instance"
import { Flag } from "../../flag/flag"
import { which } from "../../util/which"
import { Env } from "../../util/env"
import { Filesystem } from "../../util/filesystem"
import { spawn } from "../launch"
import { venvPython, venvBin } from "../server-helpers"
import type { ServerInfo as Info } from "../server-helpers"
import { JS_RUNTIME_EXTENSIONS, JS_PROJECT_EXTENSIONS, JS_FRAMEWORK_EXTENSIONS, PYTHON_EXTENSIONS, SQL_EXTENSIONS, ANSIBLE_EXTENSIONS, PYTHON_ROOT_MARKERS, TY_ROOT_MARKERS, ANSIBLE_ROOT_MARKERS, NearestRootWithMarker } from "./shared"

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
    return toolSpawnInfo(root, "typescript-language-server", ["--stdio"], {
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
        { serverPath: legacyServer },
      )
      return bunSpawnInfo(root, legacyServer, ["--stdio"])
    }

    if (Flag.AX_CODE_DISABLE_LSP_DOWNLOAD) return
    log.info("downloading pinned VS Code ESLint server", { version: pinned.version })

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
      const candidates = Filesystem.up({ targets: [target], start: root, stop: Instance.worktree })
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
      if (hasLsp) return spawnInfo(lintBin, root, ["--lsp"])
    }

    let serverBin = await resolveBin(serverTarget)
    if (!serverBin) {
      const found = which("oxc_language_server")
      if (found) serverBin = found
    }
    if (serverBin) return spawnInfo(serverBin, root)

    log.info("oxlint not found, please install oxlint")
    return
  },
}

export const Biome: Info = {
  id: "biome",
  semantic: false,
  root: NearestRoot(["biome.json", "biome.jsonc", "package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  extensions: [...JS_PROJECT_EXTENSIONS, ".json", ".jsonc", ".vue", ".astro", ".svelte", ".css", ".graphql", ".gql", ".html"],
  async spawn(root) {
    const localBin = path.join(root, "node_modules", ".bin", "biome")
    let bin: string | undefined
    if (await Filesystem.exists(localBin)) bin = localBin
    if (!bin) {
      const found = which("biome")
      if (found) bin = found
    }

    let args = ["lsp-proxy", "--stdio"]
    let runnerEnv: Record<string, string> | undefined

    if (!bin) {
      const resolved = Module.resolve("biome", root)
      if (!resolved) return
      const tool = toolRunner({ bunExecutable: BunProc.which() })
      const [runner, ...runnerArgs] = tool.command
      bin = runner
      args = [...runnerArgs, "biome", "lsp-proxy", "--stdio"]
      runnerEnv = tool.environment
    }

    const proc = spawn(bin, args, { cwd: root, env: { ...Env.sanitize(), ...runnerEnv } })
    return { process: proc }
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
      initialization: { typescript: { tsdk } },
    })
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

export const Ty: Info = {
  id: "ty",
  extensions: PYTHON_EXTENSIONS,
  root: NearestRoot(TY_ROOT_MARKERS),
  async spawn(root) {
    if (!Flag.AX_CODE_EXPERIMENTAL_LSP_TY) return undefined
    let binary = which("ty")
    const initialization: Record<string, string> = {}
    const python = await venvPython(root)
    if (python) initialization["pythonPath"] = python
    if (!binary) binary = (await venvBin(root, "ty")) ?? null
    if (!binary) {
      log.error("ty not found, please install ty first")
      return
    }
    const proc = spawn(binary, ["server"], { cwd: root })
    return { process: proc, initialization }
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
      initialization: { telemetry: { enabled: false } },
    })
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
