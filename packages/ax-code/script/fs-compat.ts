// Runtime-agnostic fs/glob helpers for build & check scripts, replacing the
// Bun-only `Bun.file`/`Bun.write`/`Bun.Glob` so the scripts run under `tsx`
// (Node) as well as `bun`. (ADR-036 P4 — porting scripts off Bun APIs.)
import { promises as fs } from "node:fs"
import path from "node:path"
import fastGlob from "fast-glob"

/** `Bun.file(file).text()` */
export const readText = (file: string) => fs.readFile(file, "utf8")

/** `Bun.write(file, content)` — creates parent dirs like Bun.write does. */
export async function writeText(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

/** `JSON.parse(await Bun.file(file).text())` */
export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readText(file)) as T
}

/** `Bun.file(file).exists()` */
export function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

/** `new Bun.Glob(pattern).scan({ cwd, absolute })` → string[] of matches. */
export function scan(pattern: string | string[], opts: { cwd: string; absolute?: boolean; dot?: boolean }) {
  return fastGlob(pattern, { cwd: opts.cwd, absolute: opts.absolute ?? false, dot: opts.dot ?? false })
}
