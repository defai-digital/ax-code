import fs from "fs"
import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"

/**
 * Resolve the Python interpreter ax-engine should use for Hugging Face Hub
 * downloads (`huggingface_hub`). Prefer an explicit `AX_ENGINE_PYTHON`, then
 * the conventional managed venv at `~/.ax-engine/venv`.
 *
 * Desktop/dev launchers also inject this env, but CLI/server download paths
 * must resolve it themselves so downloads work even when the parent process
 * was started without the variable set.
 */
export function resolveAxEnginePython(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string | undefined {
  const explicit = typeof env.AX_ENGINE_PYTHON === "string" ? env.AX_ENGINE_PYTHON.trim() : ""
  if (explicit && isExecutablePython(explicit)) return explicit

  // Resolve under $HOME only — containment check keeps managed venv paths
  // from escaping home even if home resolution is unexpected.
  const managedRoot = path.resolve(home, ".ax-engine", "venv")
  if (!Filesystem.contains(home, managedRoot)) return undefined

  const relativeBins =
    process.platform === "win32"
      ? (["Scripts/python.exe", "Scripts/python"] as const)
      : (["bin/python", "bin/python3"] as const)

  for (const rel of relativeBins) {
    const candidate = path.resolve(managedRoot, rel)
    if (!Filesystem.contains(managedRoot, candidate)) continue
    if (isExecutablePython(candidate)) return candidate
  }
  return undefined
}

/**
 * Env map for spawning `ax-engine download` / `download-mtp` so the child
 * always sees a Python that has `huggingface_hub` when one is available.
 */
export function axEngineDownloadEnv(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): NodeJS.ProcessEnv {
  const python = resolveAxEnginePython(env, home)
  if (!python) return { ...env }
  return {
    ...env,
    AX_ENGINE_PYTHON: python,
  }
}

function isExecutablePython(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.F_OK)
    // Follow symlinks (e.g. venv/bin/python -> python3.14) and require a real file.
    const stat = fs.statSync(candidate)
    return stat.isFile()
  } catch {
    return false
  }
}
