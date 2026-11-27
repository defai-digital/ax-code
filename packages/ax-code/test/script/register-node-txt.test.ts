import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(import.meta.dirname, "../..")
const registerNode = path.join(packageRoot, "script/register-node.ts")

// Non-ASCII plus a backtick: the load hook must round-trip the exact UTF-8
// contents through JSON.stringify, so a template-literal bug would show up here.
const FIXTURE = "Initialize the repository.\nUnicode: — 你好 λ\nBacktick: `\n"

function childEnv() {
  const env = { ...process.env }
  // NODE_OPTIONS could inject loaders (or a conflicting resolve) into the child.
  delete env.NODE_OPTIONS
  return env
}

describe("script/register-node .txt loading", () => {
  test("serves .txt files as raw-text ES modules under Node", async () => {
    await using tmp = await tmpdir()
    const txtPath = path.join(tmp.path, "description.txt")
    const entryPath = path.join(tmp.path, "entry.mjs")
    await writeFile(txtPath, FIXTURE)
    await writeFile(
      entryPath,
      `import text from ${JSON.stringify(pathToFileURL(txtPath).href)}\nprocess.stdout.write(text)\n`,
    )

    const result = spawnSync(process.execPath, ["--import", "tsx", "--import", registerNode, entryPath], {
      cwd: packageRoot,
      env: childEnv(),
      encoding: "utf8",
    })

    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(FIXTURE)
  })

  test("plain Node rejects the same .txt import without the load hook", async () => {
    await using tmp = await tmpdir()
    const txtPath = path.join(tmp.path, "description.txt")
    const entryPath = path.join(tmp.path, "entry.mjs")
    await writeFile(txtPath, FIXTURE)
    await writeFile(
      entryPath,
      `import text from ${JSON.stringify(pathToFileURL(txtPath).href)}\nprocess.stdout.write(text)\n`,
    )

    const result = spawnSync(process.execPath, [entryPath], { env: childEnv(), encoding: "utf8" })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION/)
  })
})
