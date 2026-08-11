import fs from "fs"
import os from "os"
import path from "path"

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

  const candidates =
    process.platform === "win32"
      ? [
          path.join(home, ".ax-engine", "venv", "Scripts", "python.exe"),
          path.join(home, ".ax-engine", "venv", "Scripts", "python"),
        ]
      : [
          path.join(home, ".ax-engine", "venv", "bin", "python"),
          path.join(home, ".ax-engine", "venv", "bin", "python3"),
        ]

  for (const candidate of candidates) {
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
