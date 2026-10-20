import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { axEngineDownloadEnv, resolveAxEnginePython } from "../../../src/provider/ax-engine/python"

describe("resolveAxEnginePython", () => {
  const tempRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    )
  })

  async function makeHomeWithVenvPython() {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "ax-engine-python-"))
    tempRoots.push(home)
    const bin = path.join(home, ".ax-engine", "venv", process.platform === "win32" ? "Scripts" : "bin")
    await fs.mkdir(bin, { recursive: true })
    const python = path.join(bin, process.platform === "win32" ? "python.exe" : "python")
    await fs.writeFile(python, "#!/bin/sh\n")
    await fs.chmod(python, 0o755).catch(() => undefined)
    return { home, python }
  }

  test("prefers explicit AX_ENGINE_PYTHON when the path exists", async () => {
    const { home, python } = await makeHomeWithVenvPython()
    const explicitHome = await fs.mkdtemp(path.join(os.tmpdir(), "ax-engine-python-explicit-"))
    tempRoots.push(explicitHome)
    const explicit = path.join(explicitHome, "custom-python")
    await fs.writeFile(explicit, "#!/bin/sh\n")
    await fs.chmod(explicit, 0o755).catch(() => undefined)

    expect(
      resolveAxEnginePython(
        {
          AX_ENGINE_PYTHON: explicit,
        },
        home,
      ),
    ).toBe(explicit)
    expect(python).toBeTruthy()
  })

  test("falls back to ~/.ax-engine/venv python when env is unset", async () => {
    const { home, python } = await makeHomeWithVenvPython()
    expect(resolveAxEnginePython({}, home)).toBe(python)
  })

  test("finds the documented ~/.local/share/ax-engine/download-env venv and prefers it over the legacy one", async () => {
    const { home, python: legacy } = await makeHomeWithVenvPython()
    const bin = path.join(
      home,
      ".local",
      "share",
      "ax-engine",
      "download-env",
      process.platform === "win32" ? "Scripts" : "bin",
    )
    await fs.mkdir(bin, { recursive: true })
    const documented = path.join(bin, process.platform === "win32" ? "python.exe" : "python")
    await fs.writeFile(documented, "#!/bin/sh\n")
    await fs.chmod(documented, 0o755).catch(() => undefined)
    expect(resolveAxEnginePython({}, home)).toBe(documented)
    expect(legacy).not.toBe(documented)
    await fs.rm(path.join(home, ".local"), { recursive: true, force: true })
    expect(resolveAxEnginePython({}, home)).toBe(legacy)
  })

  test("ignores blank or missing explicit paths and uses the venv", async () => {
    const { home, python } = await makeHomeWithVenvPython()
    expect(resolveAxEnginePython({ AX_ENGINE_PYTHON: "   " }, home)).toBe(python)
    expect(resolveAxEnginePython({ AX_ENGINE_PYTHON: path.join(home, "missing") }, home)).toBe(python)
  })

  test("skips a non-executable explicit interpreter", async () => {
    if (process.platform === "win32") return
    const { home, python } = await makeHomeWithVenvPython()
    const explicit = path.join(home, "disabled-python")
    await fs.writeFile(explicit, "#!/bin/sh\n", { mode: 0o644 })
    expect(resolveAxEnginePython({ AX_ENGINE_PYTHON: explicit }, home)).toBe(python)
    expect(axEngineDownloadEnv({ AX_ENGINE_PYTHON: explicit }, home).AX_ENGINE_PYTHON).toBe(python)
  })

  test("skips a non-executable documented interpreter and uses the legacy environment", async () => {
    if (process.platform === "win32") return
    const { home, python } = await makeHomeWithVenvPython()
    const bin = path.join(home, ".local", "share", "ax-engine", "download-env", "bin")
    await fs.mkdir(bin, { recursive: true })
    await fs.writeFile(path.join(bin, "python"), "#!/bin/sh\n", { mode: 0o644 })
    expect(resolveAxEnginePython({}, home)).toBe(python)
  })

  test("does not select a managed interpreter that lost executable permission", async () => {
    if (process.platform === "win32") return
    const { home, python } = await makeHomeWithVenvPython()
    await fs.chmod(python, 0o644)
    expect(resolveAxEnginePython({}, home)).toBeUndefined()
  })

  test("returns undefined when no python is available", () => {
    expect(resolveAxEnginePython({}, path.join(os.tmpdir(), "ax-engine-no-home-" + process.pid))).toBeUndefined()
  })

  test("does not forward a missing explicit interpreter when no fallback exists", async () => {
    const { home, python } = await makeHomeWithVenvPython()
    await fs.rm(python)
    const env = { AX_ENGINE_PYTHON: path.join(home, "missing-python"), PATH: "/usr/bin" }
    const download = axEngineDownloadEnv(env, home)
    expect(download.AX_ENGINE_PYTHON).toBeUndefined()
    expect(download.PATH).toBe(env.PATH)
    expect(env.AX_ENGINE_PYTHON).toBe(path.join(home, "missing-python"))
  })

  test("does not forward a disabled explicit interpreter when no fallback exists", async () => {
    if (process.platform === "win32") return
    const { home, python } = await makeHomeWithVenvPython()
    await fs.chmod(python, 0o644)
    expect(axEngineDownloadEnv({ AX_ENGINE_PYTHON: python }, home).AX_ENGINE_PYTHON).toBeUndefined()
  })

  test("axEngineDownloadEnv injects AX_ENGINE_PYTHON", async () => {
    const { home, python } = await makeHomeWithVenvPython()
    const env = axEngineDownloadEnv({ PATH: "/usr/bin", FOO: "bar" }, home)
    expect(env.AX_ENGINE_PYTHON).toBe(python)
    expect(env.PATH).toBe("/usr/bin")
    expect(env.FOO).toBe("bar")
  })
})

describe("HF download credential boundary", () => {
  const credential = "synthetic-hub-credential"
  const home = path.join(os.tmpdir(), "ax-engine-no-home-" + process.pid)

  test.each([undefined, "https://huggingface.co", "https://huggingface.co/", "https://HUGGINGFACE.CO:443/"])(
    "forwards only HF credentials to the official Hub: %s",
    (HF_ENDPOINT) => {
      const input = {
        HF_ENDPOINT,
        HF_TOKEN: credential,
        HUGGING_FACE_HUB_TOKEN: credential,
        HF_TOKEN_PATH: "/custom/hf-token",
        HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
        OPENAI_API_KEY: "fixture-secret",
        NODE_OPTIONS: "--inspect",
        HF_HOME: "/custom/hf",
      }
      const env = axEngineDownloadEnv(input, home)
      expect(env.HF_TOKEN).toBe(credential)
      expect(env.HUGGING_FACE_HUB_TOKEN).toBe(credential)
      expect(env.HF_TOKEN_PATH).toBe(input.HF_TOKEN_PATH)
      expect(env.HF_HUB_DISABLE_IMPLICIT_TOKEN).toBe("1")
      expect(env.HF_HOME).toBe(input.HF_HOME)
      expect(env.OPENAI_API_KEY).toBeUndefined()
      expect(env.NODE_OPTIONS).toBeUndefined()
      expect(input.HF_TOKEN).toBe(credential)
    },
  )

  test.each([
    "https://mirror.example",
    "http://huggingface.co",
    "https://huggingface.co.evil.example",
    "https://huggingface.co/path",
    "https://user:password@huggingface.co",
    "https://huggingface.co?x=1",
  ])("never forwards Hub credentials or implicit login to custom endpoints: %s", (HF_ENDPOINT) => {
    const env = axEngineDownloadEnv(
      {
        HF_ENDPOINT,
        HF_TOKEN: credential,
        HUGGING_FACE_HUB_TOKEN: credential,
        HF_TOKEN_PATH: "/custom/token",
        HF_HUB_DISABLE_IMPLICIT_TOKEN: "0",
        HF_HUB_CACHE: "/custom/cache",
      },
      home,
    )
    expect(env.HF_TOKEN).toBeUndefined()
    expect(env.HUGGING_FACE_HUB_TOKEN).toBeUndefined()
    expect(env.HF_TOKEN_PATH).toBeUndefined()
    expect(env.HF_HUB_DISABLE_IMPLICIT_TOKEN).toBe("1")
    expect(env.HF_HUB_CACHE).toBe("/custom/cache")
  })
})
