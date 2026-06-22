import fs from "fs/promises"
import os from "os"
import path from "path"

// Resolve the Hugging Face Hub cache the way ax-engine's downloader does
// (scripts/download_model.py): HF_HUB_CACHE, then HF_HOME/hub, then
// $XDG_CACHE_HOME/huggingface/hub, then ~/.cache/huggingface/hub. Keeping this
// in lockstep with the engine lets ax-code resolve a model the engine already
// downloaded — and the weights stay in one shared, standard location instead of
// a duplicate copy under ax-code's own (auto-wiped) cache.
export namespace HfCache {
  export function root(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
    if (env.HF_HUB_CACHE && env.HF_HUB_CACHE.trim()) return env.HF_HUB_CACHE.trim()
    if (env.HF_HOME && env.HF_HOME.trim()) return path.join(env.HF_HOME.trim(), "hub")
    const cacheHome =
      env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.trim() ? env.XDG_CACHE_HOME.trim() : path.join(home, ".cache")
    return path.join(cacheHome, "huggingface", "hub")
  }

  // "mlx-community/Qwen3-Coder-Next-4bit" -> "models--mlx-community--Qwen3-Coder-Next-4bit"
  export function repoDir(repo: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
    return path.join(root(env, home), `models--${repo.replace(/\//g, "--")}`)
  }

  // Resolve the snapshot directory for a repo: prefer the commit pinned by
  // refs/main, else fall back to the most recently modified snapshot dir.
  // Returns undefined when the repo is not in the cache.
  export async function snapshotDir(
    repo: string,
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
  ): Promise<string | undefined> {
    return (await snapshotDirs(repo, env, home))[0]
  }

  // Resolve the first complete snapshot, preferring refs/main but falling back
  // to another cached snapshot when the pinned one is partial or stale.
  export async function completeSnapshotDir(
    repo: string,
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
  ): Promise<string | undefined> {
    for (const dir of await snapshotDirs(repo, env, home)) {
      if (await isCompleteSnapshot(dir)) return dir
    }
    return undefined
  }

  async function snapshotDirs(repo: string, env: NodeJS.ProcessEnv, home: string): Promise<string[]> {
    const base = repoDir(repo, env, home)
    const snapshots = path.join(base, "snapshots")
    const ordered: string[] = []
    const seen = new Set<string>()

    const ref = await fs
      .readFile(path.join(base, "refs", "main"), "utf8")
      .then((s) => s.trim())
      .catch(() => undefined)
    if (ref) {
      const pinned = path.join(snapshots, ref)
      if (await isDir(pinned)) {
        ordered.push(pinned)
        seen.add(pinned)
      }
    }

    const entries = await fs.readdir(snapshots, { withFileTypes: true }).catch(() => [])
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(snapshots, entry.name))
      .filter((dir) => !seen.has(dir))
    if (dirs.length === 0) return ordered
    if (dirs.length === 1) return [...ordered, dirs[0]]
    const withMtime = await Promise.all(
      dirs.map(async (dir) => ({
        dir,
        mtime: await fs
          .stat(dir)
          .then((s) => s.mtimeMs)
          .catch(() => 0),
      })),
    )
    withMtime.sort((a, b) => b.mtime - a.mtime)
    return [...ordered, ...withMtime.map((item) => item.dir)]
  }

  // A snapshot is usable by ax-engine only when it carries MLX weights and the
  // AX model-manifest.json the engine generates after download.
  export async function isCompleteSnapshot(dir: string): Promise<boolean> {
    if (!(await isDir(dir))) return false
    if (!(await fileExists(path.join(dir, "model-manifest.json")))) return false
    const entries = await fs.readdir(dir).catch(() => [] as string[])
    return entries.some((name) => name.endsWith(".safetensors"))
  }

  // True when a path lives inside the Hugging Face Hub cache, so callers can
  // avoid mutating or deleting shared cache entries.
  export function isInside(target: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): boolean {
    const rel = path.relative(root(env, home), path.resolve(target))
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }
}

async function isDir(target: string): Promise<boolean> {
  return fs
    .stat(target)
    .then((s) => s.isDirectory())
    .catch(() => false)
}

async function fileExists(target: string): Promise<boolean> {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}
