import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import {
  fetchGitHubReleaseByTag,
  installPinnedGitHubReleaseAsset,
  NearestRoot,
  PINNED_GITHUB_LSP_RELEASES,
  bunServerArgs,
  clangdAsset,
  globalBin,
  globalPath,
  installReleaseBin,
  luaLsAsset,
  luaLsReleaseTarget,
  managedToolBin,
  managedToolPath,
  releaseAsset,
  releaseAssetSha256,
  releaseVersion,
  spawnInfo,
  texlabAsset,
  tinymistAsset,
  toolBin,
  toolServer,
  venvBin,
  venvPaths,
  venvPython,
  zlsAsset,
  zlsReleaseForZig,
} from "../../src/lsp/server-helpers"

describe("lsp server helpers", () => {
  test("lists default venv search paths", async () => {
    await using tmp = await tmpdir()
    expect(venvPaths(tmp.path)).toEqual([
      ...(process.env["VIRTUAL_ENV"] ? [process.env["VIRTUAL_ENV"]] : []),
      path.join(tmp.path, ".venv"),
      path.join(tmp.path, "venv"),
    ])
  })

  test("finds python inside a local virtualenv", async () => {
    await using tmp = await tmpdir()
    const bin =
      process.platform === "win32" ? path.join(tmp.path, ".venv", "Scripts") : path.join(tmp.path, ".venv", "bin")
    const python = process.platform === "win32" ? path.join(bin, "python.exe") : path.join(bin, "python")
    await fs.mkdir(bin, { recursive: true })
    await fs.writeFile(python, "")

    expect(await venvPython(tmp.path)).toBe(python)
  })

  test("finds named binary inside a local virtualenv", async () => {
    await using tmp = await tmpdir()
    const bin =
      process.platform === "win32" ? path.join(tmp.path, "venv", "Scripts") : path.join(tmp.path, "venv", "bin")
    const ty = process.platform === "win32" ? path.join(bin, "ty.exe") : path.join(bin, "ty")
    await fs.mkdir(bin, { recursive: true })
    await fs.writeFile(ty, "")

    expect(await venvBin(tmp.path, "ty")).toBe(ty)
  })

  test("maps supported zls targets", () => {
    expect(zlsAsset("darwin", "arm64")).toBe("zls-aarch64-macos.tar.xz")
    expect(zlsAsset("linux", "x64")).toBe("zls-x86_64-linux.tar.xz")
    expect(zlsAsset("win32", "ia32")).toBe("zls-x86-windows.zip")
  })

  test("rejects unsupported zls targets", () => {
    expect(zlsAsset("freebsd", "x64")).toBeUndefined()
    expect(zlsAsset("linux", "s390x")).toBeUndefined()
  })

  test("maps stable zig versions to pinned zls releases", () => {
    expect(zlsReleaseForZig("0.16.0")).toBe("0.16.0")
    expect(zlsReleaseForZig("0.15.1")).toBe("0.15.1")
    expect(zlsReleaseForZig("0.16.0-dev.99+abcd")).toBeUndefined()
  })

  test("builds versioned managed tool paths without colliding with flat binaries", () => {
    expect(managedToolBin("zls", "0.16.0", "darwin", "arm64")).toBe(
      path.join(Global.Path.bin, ".managed", "zls", "0.16.0", "darwin-arm64", "zls"),
    )
    expect(managedToolBin("zls", "0.16.0", "win32", "x64")).toBe(
      path.join(Global.Path.bin, ".managed", "zls", "0.16.0", "win32-x64", "zls.exe"),
    )
  })

  test("builds nested managed tool paths for directory-based installs", () => {
    expect(managedToolPath("lua-language-server", "3.15.0", path.join("bin", "lua-language-server"), "darwin", "arm64")).toBe(
      path.join(Global.Path.bin, ".managed", "lua-language-server", "3.15.0", "darwin-arm64", "bin", "lua-language-server"),
    )
  })

  test("normalizes release tags into install versions", () => {
    expect(releaseVersion("v5.24.0")).toBe("5.24.0")
    expect(releaseVersion("3.15.0")).toBe("3.15.0")
  })

  test("maps pinned GitHub LSP releases explicitly", () => {
    expect(PINNED_GITHUB_LSP_RELEASES.texlab.tag).toBe("v5.24.0")
    expect(PINNED_GITHUB_LSP_RELEASES.tinymist.tag).toBe("v0.14.0")
    expect(PINNED_GITHUB_LSP_RELEASES.luaLs.tag).toBe("3.15.0")
  })

  test("maps texlab assets for supported targets", () => {
    expect(texlabAsset("darwin", "arm64")).toBe("texlab-aarch64-macos.tar.gz")
    expect(texlabAsset("linux", "x64")).toBe("texlab-x86_64-linux.tar.gz")
    expect(texlabAsset("win32", "x64")).toBe("texlab-x86_64-windows.zip")
    expect(texlabAsset("linux", "ia32")).toBeUndefined()
  })

  test("maps tinymist assets for supported targets", () => {
    expect(tinymistAsset("darwin", "arm64")).toBe("tinymist-aarch64-apple-darwin.tar.gz")
    expect(tinymistAsset("linux", "x64")).toBe("tinymist-x86_64-unknown-linux-gnu.tar.gz")
    expect(tinymistAsset("win32", "x64")).toBe("tinymist-x86_64-pc-windows-msvc.zip")
    expect(tinymistAsset("linux", "ia32")).toBeUndefined()
  })

  test("maps lua-language-server targets and assets for supported platforms", () => {
    expect(luaLsReleaseTarget("darwin", "arm64")).toEqual({
      arch: "arm64",
      ext: "tar.gz",
      platform: "darwin",
    })
    expect(luaLsAsset("3.15.0", "linux", "x64")).toBe("lua-language-server-3.15.0-linux-x64.tar.gz")
    expect(luaLsAsset("3.15.0", "win32", "ia32")).toBe("lua-language-server-3.15.0-win32-ia32.zip")
    expect(luaLsReleaseTarget("linux", "ia32")).toBeUndefined()
  })

  test("prefers zip clangd asset when multiple valid assets exist", () => {
    expect(
      clangdAsset(
        [
          { name: "clangd-linux-20.1.0.tar.xz", browser_download_url: "https://example.com/tar" },
          { name: "clangd-linux-20.1.0.zip", browser_download_url: "https://example.com/zip" },
        ],
        "20.1.0",
        "linux",
      ),
    ).toEqual({
      name: "clangd-linux-20.1.0.zip",
      browser_download_url: "https://example.com/zip",
    })
  })

  test("filters clangd assets by platform and tag", () => {
    expect(
      clangdAsset(
        [
          { name: "clangd-mac-20.1.0.zip", browser_download_url: "https://example.com/mac" },
          { name: "clangd-linux-19.0.0.zip", browser_download_url: "https://example.com/old" },
        ],
        "20.1.0",
        "linux",
      ),
    ).toBeUndefined()
  })

  test("finds a release asset by exact name", () => {
    expect(
      releaseAsset(
        [
          { name: "a.zip", browser_download_url: "https://example.com/a" },
          { name: "b.zip", browser_download_url: "https://example.com/b" },
        ],
        "b.zip",
      ),
    ).toEqual({ name: "b.zip", browser_download_url: "https://example.com/b" })
  })

  test("parses sha256 release digests from GitHub asset metadata", () => {
    expect(
      releaseAssetSha256({
        name: "zls-aarch64-macos.tar.xz",
        digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    ).toBe("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    expect(releaseAssetSha256({ name: "zls-aarch64-macos.tar.xz", digest: "md5:deadbeef" })).toBeUndefined()
  })

  test("fetches an exact GitHub release by tag", async () => {
    const calls: string[] = []
    const release = await fetchGitHubReleaseByTag({
      repo: "zigtools/zls",
      tag: "0.16.0",
      fetcher: async (url) => {
        calls.push(url)
        return {
          ok: true,
          json: async () => ({
            tag_name: "0.16.0",
            assets: [{ name: "zls-aarch64-macos.tar.xz", browser_download_url: "https://example.com/zls.tar.xz" }],
          }),
        }
      },
    })

    expect(calls).toEqual(["https://api.github.com/repos/zigtools/zls/releases/tags/0.16.0"])
    expect(release?.tag_name).toBe("0.16.0")
    expect(release?.assets?.[0]?.name).toBe("zls-aarch64-macos.tar.xz")
  })

  test("installs pinned GitHub release assets with verified digests", async () => {
    const installs: Record<string, unknown>[] = []
    const bin = await installPinnedGitHubReleaseAsset({
      id: "texlab",
      repo: "latex-lsp/texlab",
      tag: "v5.24.0",
      assetName: "texlab-aarch64-macos.tar.gz",
      bin: "/tmp/texlab",
      installDir: "/tmp/texlab-dir",
      platform: "darwin",
      tarArgs: ["-xzf"],
      fetchRelease: async () => ({
        tag_name: "v5.24.0",
        assets: [
          {
            name: "texlab-aarch64-macos.tar.gz",
            browser_download_url: "https://example.com/texlab.tar.gz",
            digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        ],
      }),
      installRelease: async (input) => {
        installs.push(input)
        return input.bin
      },
    })

    expect(bin).toBe("/tmp/texlab")
    expect(installs).toEqual([
      expect.objectContaining({
        assetName: "texlab-aarch64-macos.tar.gz",
        bin: "/tmp/texlab",
        id: "texlab",
        installDir: "/tmp/texlab-dir",
        platform: "darwin",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        tarArgs: ["-xzf"],
        url: "https://example.com/texlab.tar.gz",
      }),
    ])
  })

  test("builds bun run args for js-backed servers", () => {
    expect(bunServerArgs("/tmp/server.js", ["--stdio"])).toEqual(["run", "/tmp/server.js", "--stdio"])
    expect(bunServerArgs("/tmp/cli.js", ["start"])).toEqual(["run", "/tmp/cli.js", "start"])
  })

  test("builds global binary paths by platform", () => {
    expect(globalBin("gopls", "darwin")).toBe(path.join(Global.Path.bin, "gopls"))
    expect(globalBin("gopls", "win32")).toBe(path.join(Global.Path.bin, "gopls.exe"))
  })

  test("includes the shared bin directory in PATH lookups", () => {
    expect(globalPath()).toContain(Global.Path.bin)
  })

  test("prefers an already installed global tool before install fallback", async () => {
    const bin = await toolBin({
      name: "gopls",
      install: ["go", "install", "gopls"],
      global: () => "/tmp/gopls",
      ensure: async () => "/tmp/fallback",
    })

    expect(bin).toBe("/tmp/gopls")
  })

  test("falls back to installer when global tool is missing", async () => {
    const bin = await toolBin({
      name: "rubocop",
      install: ["gem", "install", "rubocop"],
      global: () => undefined,
      ensure: async (input) => `${input.name}-bin`,
    })

    expect(bin).toBe("rubocop-bin")
  })

  test("builds spawn info with cwd and args", () => {
    const info = spawnInfo("/tmp/server", "/tmp/root", ["--stdio"])

    expect(info.process.spawnfile).toBe("/tmp/server")
    expect(info.process.spawnargs.slice(1)).toEqual(["--stdio"])
  })

  test("builds tool-backed server info from the installed binary", async () => {
    const info = await toolServer("/tmp/root", {
      name: "gopls",
      install: ["go", "install", "gopls"],
      args: ["--stdio"],
      global: () => "/tmp/gopls",
    })

    expect(info?.process.spawnfile).toBe("/tmp/gopls")
    expect(info?.process.spawnargs.slice(1)).toEqual(["--stdio"])
  })

  test("skips tool-backed server info when the tool is unavailable", async () => {
    const info = await toolServer("/tmp/root", {
      name: "gopls",
      install: ["go", "install", "gopls"],
      global: () => undefined,
      ensure: async () => undefined,
    })

    expect(info).toBeUndefined()
  })

  test("installs a zip release binary", async () => {
    const calls: string[] = []
    const bin = await installReleaseBin({
      id: "texlab",
      assetName: "texlab.zip",
      url: "https://example.com/texlab.zip",
      bin: "/tmp/texlab",
      platform: "darwin",
      fetcher: async () => ({ ok: true, body: "zip-stream" }),
      writeStream: async (file) => void calls.push(`write:${file}`),
      extractZip: async (from, to) => void calls.push(`zip:${from}:${to}`),
      remove: async (file) => void calls.push(`rm:${file}`),
      exists: async () => true,
      chmod: async (file, mode) => void calls.push(`chmod:${file}:${mode}`),
    })

    expect(bin).toBe("/tmp/texlab")
    expect(calls.some((item) => item.startsWith("write:"))).toBe(true)
    expect(calls.some((item) => item.startsWith("zip:"))).toBe(true)
    expect(calls.some((item) => item.startsWith("rm:"))).toBe(true)
    expect(calls.some((item) => item.startsWith("chmod:/tmp/texlab:"))).toBe(true)
  })

  test("installs a tar release binary with custom args", async () => {
    const calls: string[][] = []
    const bin = await installReleaseBin({
      id: "tinymist",
      assetName: "tinymist.tar.gz",
      url: "https://example.com/tinymist.tar.gz",
      bin: "/tmp/tinymist",
      platform: "linux",
      fetcher: async () => ({ ok: true, body: "tar-stream" }),
      writeStream: async () => {},
      run: async (cmd) => {
        calls.push(cmd)
        return {} as any
      },
      remove: async () => {},
      exists: async () => true,
      chmod: async () => {},
      tarArgs: ["-xzf", "--strip-components=1"],
    })

    expect(bin).toBe("/tmp/tinymist")
    expect(calls).toEqual([["tar", "-xzf", "--strip-components=1", path.join("/tmp", "tinymist.tar.gz")]])
  })

  test("rejects release installs when sha256 verification fails", async () => {
    const writes: string[] = []
    const archive = Buffer.from("bad-archive")
    const bin = await installReleaseBin({
      id: "zls",
      assetName: "zls.tar.xz",
      url: "https://example.com/zls.tar.xz",
      bin: "/tmp/zls",
      sha256: "f".repeat(64),
      fetcher: async () => ({
        ok: true,
        arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
      }),
      write: async (file) => void writes.push(file),
      exists: async () => false,
    })

    expect(bin).toBeUndefined()
    expect(writes).toEqual([])
  })

  test("matches nearest root for glob patterns", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = path.join(tmp.path, "ios")
    const file = path.join(root, "src", "main.swift")
    await fs.mkdir(path.join(root, "App.xcodeproj"), { recursive: true })
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await NearestRoot(["*.xcodeproj"])(file)).toBe(root)
      },
    })
  })
})
