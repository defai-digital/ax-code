import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import esbuild from "esbuild"
import { solidEsbuildPlugin } from "../../script/esbuild-solid-plugin"

let tempDir: string | undefined

afterEach(async () => {
  if (!tempDir) return
  await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe("script.esbuild-solid-plugin", () => {
  test("transforms OpenTUI Solid TSX through the stable package transform export", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ax-code-esbuild-solid-plugin."))
    const entry = path.join(tempDir, "view.tsx")
    const outfile = path.join(tempDir, "view.js")

    await writeFile(entry, "export const View = () => <text>Hello</text>\n")

    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [solidEsbuildPlugin()],
      external: ["@ax-code/opentui-solid"],
      logLevel: "silent",
    })

    const output = await readFile(outfile, "utf8")
    expect(output).toContain('from "@ax-code/opentui-solid"')
    expect(output).toContain('createElement("text")')
    expect(output).not.toContain("<text>")
  })
})
