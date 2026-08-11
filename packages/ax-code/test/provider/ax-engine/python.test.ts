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

  test("ignores blank or missing explicit paths and uses the venv", async () => {
    const { home, python } = await makeHomeWithVenvPython()
    expect(resolveAxEnginePython({ AX_ENGINE_PYTHON: "   " }, home)).toBe(python)
    expect(resolveAxEnginePython({ AX_ENGINE_PYTHON: path.join(home, "missing") }, home)).toBe(python)
  })

  test("returns undefined when no python is available", () => {
    expect(resolveAxEnginePython({}, path.join(os.tmpdir(), "ax-engine-no-home-" + process.pid))).toBeUndefined()
  })

  test("axEngineDownloadEnv injects AX_ENGINE_PYTHON", async () => {
    const { home, python } = await makeHomeWithVenvPython()
    const env = axEngineDownloadEnv({ PATH: "/usr/bin", FOO: "bar" }, home)
    expect(env.AX_ENGINE_PYTHON).toBe(python)
    expect(env.PATH).toBe("/usr/bin")
    expect(env.FOO).toBe("bar")
  })
})
