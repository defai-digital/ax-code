import path from "path"
import { Instance } from "../../project/instance"
import { Flag } from "../../flag/flag"
import { which } from "../../util/which"
import {
  log,
  NearestRoot,
  resolveManagedToolBin,
  spawnInfo,
} from "../server-helpers"
import {
  PINNED_CHECKSUM_LSP_RELEASES,
  PINNED_GITHUB_LSP_RELEASES,
  installPinnedChecksumReleaseAsset,
  installPinnedGitHubReleaseAsset,
  managedToolBin,
  managedToolDir,
  releaseVersion,
  terraformLsAsset,
  terraformLsAssetUrl,
  terraformLsChecksumUrl,
  texlabAsset,
  tinymistAsset,
} from "../server-releases"
import type { ServerInfo as Info } from "../server-helpers"

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
    log.info("downloading pinned terraform-ls release", { version: pinned.version })
    const bin = (await installPinnedChecksumReleaseAsset({
      id: "terraform-ls", assetName, url: assetUrl,
      checksumUrl: terraformLsChecksumUrl(pinned.version),
      bin: managedBin, installDir: managedToolDir("terraform-ls", pinned.version, platform, arch), platform,
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
    log.info("downloading pinned texlab release", { tag: pinned.tag })
    const bin = (await installPinnedGitHubReleaseAsset({
      id: "texlab", repo: pinned.repo, tag: pinned.tag, assetName, bin: managedBin,
      installDir: path.dirname(managedBin), platform,
      tarArgs: platform === "win32" ? undefined : ["-xzf"],
    })) ?? null
    if (!bin) return
    return spawnInfo(bin, root)
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
    if (!bin && process.platform === "win32") bin = which("clojure-lsp.exe")
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
    const flakeRoot = await NearestRoot(["flake.nix"])(file)
    if (flakeRoot && flakeRoot !== Instance.directory) return flakeRoot
    if (Instance.worktree && Instance.worktree !== Instance.directory) return Instance.worktree
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
    log.info("downloading pinned tinymist release", { tag: pinned.tag })
    const bin = (await installPinnedGitHubReleaseAsset({
      id: "tinymist", repo: pinned.repo, tag: pinned.tag, assetName, bin: managedBin,
      installDir: path.dirname(managedBin), platform,
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
