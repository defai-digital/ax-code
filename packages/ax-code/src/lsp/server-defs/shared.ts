import path from "node:path"
import { Filesystem } from "../../util/filesystem"
import { Instance } from "../../project/instance"

// ─── Shared Constants ──────────────────────────────────────────────────────────

export const JS_RUNTIME_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"]
export const JS_PROJECT_EXTENSIONS = [...JS_RUNTIME_EXTENSIONS, ".cjs", ".mts", ".cts"]
export const JS_FRAMEWORK_EXTENSIONS = [...JS_PROJECT_EXTENSIONS, ".vue", ".astro", ".svelte"]
export const PYTHON_EXTENSIONS = [".py", ".pyi"]
export const SQL_EXTENSIONS = [".sql"]
export const ANSIBLE_EXTENSIONS = [".yaml", ".yml"]

export const PYTHON_ROOT_MARKERS = [
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
  "pyrightconfig.json",
]

export const TY_ROOT_MARKERS = [
  "pyproject.toml",
  "ty.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
  "pyrightconfig.json",
]

export const ANSIBLE_ROOT_MARKERS = [
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

export const JS_LOCKFILES = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]

// ─── Shared Helpers ────────────────────────────────────────────────────────────

/**
 * Find the nearest workspace root containing one of the given marker files.
 * Returns an async function suitable for use as a server `root` resolver.
 */
export const NearestRootWithMarker = (markers: string[]) => {
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
