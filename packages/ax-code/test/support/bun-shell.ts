// Node stand-in for Bun's `$` shell, aliased to the bare "bun" specifier for
// tests that import `{ $ }` directly. Supports the chained API the suite uses:
// `$`cmd`.cwd(d).quiet().nothrow()` plus `.text()` / `.json()` and awaiting
// (returns { exitCode, stdout, stderr }).
import { spawnSync } from "node:child_process"

class Sh implements PromiseLike<{ exitCode: number; stdout: string; stderr: string }> {
  private _cwd?: string
  private _nothrow = false
  constructor(private readonly cmd: string) {}
  cwd(d: string) {
    this._cwd = d
    return this
  }
  quiet() {
    return this
  }
  nothrow() {
    this._nothrow = true
    return this
  }
  private exec() {
    const r = spawnSync(this.cmd, { cwd: this._cwd, shell: true, encoding: "utf8" })
    const exitCode = r.status ?? (r.signal ? 1 : 0)
    if (exitCode !== 0 && !this._nothrow) {
      throw new Error(`command failed (${exitCode}): ${this.cmd}\n${r.stderr ?? ""}`)
    }
    return { exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  }
  async text() {
    return this.exec().stdout
  }
  async json() {
    return JSON.parse(this.exec().stdout)
  }
  then<R1 = { exitCode: number; stdout: string; stderr: string }, R2 = never>(
    onF?: ((v: { exitCode: number; stdout: string; stderr: string }) => R1 | PromiseLike<R1>) | null,
    onR?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.exec())
      .then(onF, onR)
  }
}

export function $(strings: TemplateStringsArray, ...values: unknown[]) {
  let cmd = ""
  strings.forEach((s, i) => {
    cmd += s
    if (i < values.length) cmd += `'${String(values[i]).replace(/'/g, "'\\''")}'`
  })
  return new Sh(cmd)
}
