import { expect, test } from "vitest"
import path from "path"

async function readBenchScript(name: string) {
  return Bun.file(path.join(import.meta.dirname, "../..", name)).text()
}

test("bench server processes use sanitized environments", async () => {
  for (const file of ["bench-both.ts", "bench-opencode.ts"]) {
    const src = await readBenchScript(file)
    expect(src).toContain("Env.sanitize()")
    expect(src).not.toContain("env: { ...process.env }")
  }
})

test("bench server processes are killed from finally blocks", async () => {
  for (const file of ["bench-both.ts", "bench-opencode.ts"]) {
    const src = await readBenchScript(file)
    const spawnIndex = src.indexOf('spawn("ax-code"')
    const finallyIndex = src.indexOf("} finally {", spawnIndex)
    const killIndex = src.indexOf("proc.kill()", finallyIndex)

    expect(spawnIndex).toBeGreaterThan(-1)
    expect(finallyIndex).toBeGreaterThan(spawnIndex)
    expect(killIndex).toBeGreaterThan(finallyIndex)
  }
})
