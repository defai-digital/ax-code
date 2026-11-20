import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import * as update from "../src/lib/tree-sitter/assets/update.js"

const { downloadToPath } = vi.hoisted(() => ({
  downloadToPath: vi.fn(async () => ({ content: Buffer.from("x"), filePath: "x" })),
}))

vi.mock("../src/lib/tree-sitter/download-utils.js", () => ({
  DownloadUtils: { downloadToPath },
  fetchPinnedGrammarQuery: vi.fn(async () => ""),
}))

interface UpdateApi {
  getDefaultOptions(dirname?: string): { configPath: string; assetsDir: string; outputPath: string }
  loadConfig(configPath: string): Promise<{ parsers: unknown[] }>
  downloadLanguage(filetype: string, languageUrl: string, assetsDir: string, outputPath: string): Promise<string>
  downloadAndCombineQueries(
    filetype: string,
    sources: string[],
    assetsDir: string,
    outputPath: string,
    queryType: "highlights" | "injections",
    configPath: string,
  ): Promise<string>
  generateDefaultParsersFile(
    parsers: { filetype: string; languagePath: string; highlightsPath: string; injectionsPath?: string }[],
    outputPath: string,
  ): Promise<void>
}

const api = update as unknown as UpdateApi

const roots: string[] = []

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-update-"))
  roots.push(root)
  return root
}

beforeEach(() => {
  downloadToPath.mockClear()
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("r15 update-assets", () => {
  test("G4: getDefaultOptions maps a built lib/tree-sitter dir back to src/lib/tree-sitter", async () => {
    const root = await tmpRoot()
    const builtDir = path.join(root, "lib", "tree-sitter")
    const options = api.getDefaultOptions(builtDir)
    const sourceDir = path.join(root, "src", "lib", "tree-sitter")
    expect(options.configPath).toBe(path.join(sourceDir, "parsers-config"))
    expect(options.assetsDir).toBe(path.join(sourceDir, "assets"))
    expect(options.outputPath).toBe(path.join(sourceDir, "default-parsers.ts"))
  })

  test("G4: getDefaultOptions maps any other dir to its parent", async () => {
    const root = await tmpRoot()
    const options = api.getDefaultOptions(path.join(root, "other"))
    expect(options.configPath).toBe(path.join(root, "parsers-config"))
    expect(options.assetsDir).toBe(path.join(root, "assets"))
    expect(options.outputPath).toBe(path.join(root, "default-parsers.ts"))
  })

  test("G5: loadConfig rejects when only a .d.ts declaration matches the extensionless path", async () => {
    const root = await tmpRoot()
    await writeFile(path.join(root, "parsers-config.d.ts"), "export interface Config {}\n")
    await expect(api.loadConfig(path.join(root, "parsers-config"))).rejects.toThrow(/No config file found/)
  })

  test("G5: loadConfig prefers the real config over a sibling .d.ts declaration", async () => {
    const root = await tmpRoot()
    await writeFile(path.join(root, "parsers-config.d.ts"), "export interface Config {}\n")
    await writeFile(path.join(root, "parsers-config.json"), JSON.stringify({ parsers: [] }))
    await expect(api.loadConfig(path.join(root, "parsers-config"))).resolves.toEqual({ parsers: [] })
  })

  test("G5: loadConfig still accepts an explicit .json path", async () => {
    const root = await tmpRoot()
    const configPath = path.join(root, "parsers-config.json")
    await writeFile(configPath, JSON.stringify({ parsers: [] }))
    await expect(api.loadConfig(configPath)).resolves.toEqual({ parsers: [] })
  })

  test("G7: downloadLanguage rejects a filetype that escapes the assets directory", async () => {
    const root = await tmpRoot()
    const assetsDir = path.join(root, "level1", "assets")
    await mkdir(assetsDir, { recursive: true })
    await expect(
      api.downloadLanguage("../../outside", "https://example.com/tree-sitter-x.wasm", assetsDir, path.join(root, "out.ts")),
    ).rejects.toThrow(/escapes/)
    expect(downloadToPath).not.toHaveBeenCalled()
  })

  test("G7: downloadAndCombineQueries rejects a filetype that escapes the assets directory", async () => {
    const root = await tmpRoot()
    const assetsDir = path.join(root, "level1", "assets")
    const configDir = path.join(root, "config")
    const outsideDir = path.join(root, "outside")
    await mkdir(assetsDir, { recursive: true })
    await mkdir(configDir, { recursive: true })
    await mkdir(outsideDir, { recursive: true })
    await writeFile(path.join(configDir, "q.scm"), "(comment) @comment\n")
    await expect(
      api.downloadAndCombineQueries(
        "../../outside",
        ["./q.scm"],
        assetsDir,
        path.join(root, "out.ts"),
        "highlights",
        path.join(configDir, "parsers-config.json"),
      ),
    ).rejects.toThrow(/escapes/)
    expect(await readdir(outsideDir)).toEqual([])
  })

  test("G7: generateDefaultParsersFile JSON-escapes filetypes and asset paths", async () => {
    const root = await tmpRoot()
    const outputPath = path.join(root, "default-parsers.ts")
    const filetype = 'evil"\nname'
    const languagePath = './lang"q.wasm'
    await api.generateDefaultParsersFile([{ filetype, languagePath, highlightsPath: "./h.scm" }], outputPath)
    const content = await readFile(outputPath, "utf-8")
    expect(content).toContain(`filetype: ${JSON.stringify(filetype)},`)
    expect(content).toContain(`() => import(${JSON.stringify(languagePath)} as string`)
    expect(content).toContain(`  ${JSON.stringify(languagePath)},`)
  })
})