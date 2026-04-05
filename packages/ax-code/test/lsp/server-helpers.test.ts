import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { clangdAsset, venvBin, venvPaths, venvPython, zlsAsset } from "../../src/lsp/server-helpers"

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
})
