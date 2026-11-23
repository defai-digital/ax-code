#!/usr/bin/env bun

import { readFile, writeFile, mkdir, readdir } from "fs/promises"
import * as path from "path"
import { DownloadUtils, fetchPinnedGrammarQuery, type PinnedGrammarQuery } from "../download-utils.js"
import { parseArgs } from "util"
import type { FiletypeParserOptions } from "../types.js"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type QuerySource = string | PinnedGrammarQuery

interface ParsersConfig {
  parsers: (Omit<FiletypeParserOptions, "queries"> & {
    queries: { highlights: QuerySource[]; injections?: QuerySource[] }
  })[]
}

interface GeneratedParser {
  filetype: string
  aliases?: string[]
  languagePath: string
  highlightsPath: string
  injectionsPath?: string
  injectionMapping?: any
}

export interface UpdateOptions {
  /** Path to parsers-config.json */
  configPath: string
  /** Directory where .wasm and .scm files will be downloaded */
  assetsDir: string
  /** Path where the generated TypeScript file will be written */
  outputPath: string
}

export function getDefaultOptions(dirname: string = __dirname): UpdateOptions {
  // When invoked from the built lib/tree-sitter output, map back to the source tree so the
  // config, assets, and generated file land where the source build expects them.
  const sourceDir =
    path.basename(dirname) === "tree-sitter" && path.basename(path.dirname(dirname)) === "lib"
      ? path.resolve(dirname, "../../src/lib/tree-sitter")
      : path.resolve(dirname, "..")
  return {
    configPath: path.join(sourceDir, "parsers-config"),
    assetsDir: path.join(sourceDir, "assets"),
    outputPath: path.join(sourceDir, "default-parsers.ts"),
  }
}

export async function loadConfig(configPath: string): Promise<ParsersConfig> {
  let ext = path.extname(configPath)
  let resolvedConfigPath = configPath

  if (ext === "") {
    const files = await readdir(path.dirname(configPath))
    const basename = path.basename(configPath)
    // Declaration files are not configs; prefer an exact basename match over prefix matches.
    const candidates = files.filter(
      (file) =>
        file.startsWith(basename) &&
        !file.endsWith(".d.ts") &&
        (file.endsWith(".json") || file.endsWith(".ts") || file.endsWith(".js")),
    )
    const file =
      candidates.find((candidate) => [".json", ".ts", ".js"].some((suffix) => candidate === `${basename}${suffix}`)) ??
      candidates[0]
    if (!file) {
      throw new Error(`No config file found for ${configPath}`)
    }
    resolvedConfigPath = path.join(path.dirname(configPath), file)
    ext = path.extname(resolvedConfigPath)
  }

  if (ext === ".json") {
    const configContent = await readFile(resolvedConfigPath, "utf-8")
    return JSON.parse(configContent)
  } else if (ext === ".ts" || ext === ".js") {
    const { default: configContent } = await import(resolvedConfigPath)
    return configContent
  }
  throw new Error(`Unsupported config file extension: ${ext}`)
}

function resolveFiletypeDir(assetsDir: string, filetype: string): string {
  const assetsRoot = path.resolve(assetsDir)
  const dir = path.resolve(assetsRoot, filetype)
  if (!dir.startsWith(assetsRoot + path.sep)) {
    throw new Error(`Filetype ${filetype} escapes the assets directory`)
  }
  return dir
}

export async function downloadLanguage(
  filetype: string,
  languageUrl: string,
  assetsDir: string,
  outputPath: string,
): Promise<string> {
  const languageDir = resolveFiletypeDir(assetsDir, filetype)
  const languageFilename = path.basename(languageUrl)
  const languagePath = path.join(languageDir, languageFilename)

  const result = await DownloadUtils.downloadToPath(languageUrl, languagePath)

  if (result.error) {
    throw new Error(`Failed to download language for ${filetype}: ${result.error}`)
  }

  return "./" + path.relative(path.dirname(outputPath), languagePath)
}

export async function downloadAndCombineQueries(
  filetype: string,
  sources: QuerySource[],
  assetsDir: string,
  outputPath: string,
  queryType: "highlights" | "injections",
  configPath: string,
): Promise<string> {
  const queriesDir = resolveFiletypeDir(assetsDir, filetype)
  const queryPath = path.join(queriesDir, `${queryType}.scm`)

  const queryContents: string[] = []

  for (const source of sources) {
    if (typeof source === "string") {
      if (!source.startsWith("./")) throw new Error("Use { url, sha256 } for remote grammar queries")
      console.log(`    Using local query: ${source}`)
      const content = await readFile(path.resolve(path.dirname(configPath), source), "utf-8")
      if (content.trim()) queryContents.push(content)
      continue
    }

    console.log("    Downloading pinned query...")
    const content = await fetchPinnedGrammarQuery(source)
    if (content.trim()) queryContents.push(`; Query from: ${source.url}\n${content}`)
  }

  const combinedContent = queryContents.join("\n\n")
  // Remote query bytes have been verified against the digest in the local parser config.
  await writeFile(queryPath, combinedContent, "utf-8")

  console.log(`  Combined ${queryContents.length} queries into ${queryPath}`)

  return "./" + path.relative(path.dirname(outputPath), queryPath)
}

function quoteImportPath(value: string): string {
  // Keep markup characters and Unicode line separators escaped in generated source.
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  })
}

export async function generateDefaultParsersFile(parsers: GeneratedParser[], outputPath: string): Promise<void> {
  const assetPaths = parsers
    .map((parser) => {
      const safeFiletype = parser.filetype.replace(/[^a-zA-Z0-9]/g, "_")
      const lines = [
        `const ${safeFiletype}_highlights = await resolveBundledFilePath(`,
        `  () => import(${quoteImportPath(parser.highlightsPath)} as string, { with: { type: "file" } }),`,
        `  ${quoteImportPath(parser.highlightsPath)},`,
        `  import.meta.url,`,
        `)`,
        `const ${safeFiletype}_language = await resolveBundledFilePath(`,
        `  () => import(${quoteImportPath(parser.languagePath)} as string, { with: { type: "file" } }),`,
        `  ${quoteImportPath(parser.languagePath)},`,
        `  import.meta.url,`,
        `)`,
      ]

      if (parser.injectionsPath) {
        lines.push(
          `const ${safeFiletype}_injections = await resolveBundledFilePath(`,
          `  () => import(${quoteImportPath(parser.injectionsPath)} as string, { with: { type: "file" } }),`,
          `  ${quoteImportPath(parser.injectionsPath)},`,
          `  import.meta.url,`,
          `)`,
        )
      }

      return lines.join("\n")
    })
    .join("\n")

  const parserDefinitions = parsers
    .map((parser) => {
      const safeFiletype = parser.filetype.replace(/[^a-zA-Z0-9]/g, "_")
      const queriesLines = [`          highlights: [${safeFiletype}_highlights],`]

      if (parser.injectionsPath) {
        queriesLines.push(`          injections: [${safeFiletype}_injections],`)
      }

      const injectionMappingLine = parser.injectionMapping
        ? `        injectionMapping: ${JSON.stringify(parser.injectionMapping, null, 10)},`
        : ""
      const aliasesLine = parser.aliases?.length ? `        aliases: ${JSON.stringify(parser.aliases)},` : ""

      return `      {
        filetype: ${JSON.stringify(parser.filetype)},
${aliasesLine ? aliasesLine + "\n" : ""}        queries: {
${queriesLines.join("\n")}
        },
        wasm: ${safeFiletype}_language,${injectionMappingLine ? "\n" + injectionMappingLine : ""}
      }`
    })
    .join(",\n")

  const fileContent = `// This file is generated by assets/update.ts - DO NOT EDIT MANUALLY
// Run 'bun assets/update.ts' to regenerate this file
// Last generated: ${new Date().toISOString()}

import type { FiletypeParserOptions } from "./types.js"
import { resolveBundledFilePath } from "../../platform/runtime.js"

// Cached parsers to avoid re-resolving paths on every call
let _cachedParsers: Promise<FiletypeParserOptions[]> | undefined

export function getParsers(): Promise<FiletypeParserOptions[]> {
  if (!_cachedParsers) {
    _cachedParsers = loadParsers().catch((error) => {
      _cachedParsers = undefined
      throw error
    })
  }
  return _cachedParsers
}

async function loadParsers(): Promise<FiletypeParserOptions[]> {
${assetPaths}

  return [
${parserDefinitions},
  ]
}
`

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, fileContent, "utf-8")
  console.log(`Generated ${path.basename(outputPath)} with ${parsers.length} parsers`)
}

async function main(options?: Partial<UpdateOptions>): Promise<void> {
  const opts = { ...getDefaultOptions(), ...options }

  try {
    console.log("Loading parsers configuration...")
    console.log(`  Config: ${opts.configPath}`)
    console.log(`  Assets Dir: ${opts.assetsDir}`)
    console.log(`  Output: ${opts.outputPath}`)

    const config = await loadConfig(opts.configPath)

    console.log(`Found ${config.parsers.length} parsers to process`)

    const generatedParsers: GeneratedParser[] = []

    for (const parser of config.parsers) {
      console.log(`Processing ${parser.filetype}...`)

      console.log(`  Downloading language...`)
      const languagePath = await downloadLanguage(parser.filetype, parser.wasm, opts.assetsDir, opts.outputPath)

      console.log(`  Downloading ${parser.queries.highlights.length} highlight queries...`)
      const highlightsPath = await downloadAndCombineQueries(
        parser.filetype,
        parser.queries.highlights,
        opts.assetsDir,
        opts.outputPath,
        "highlights",
        opts.configPath,
      )

      let injectionsPath: string | undefined
      if (parser.queries.injections && parser.queries.injections.length > 0) {
        console.log(`  Downloading ${parser.queries.injections.length} injection queries...`)
        injectionsPath = await downloadAndCombineQueries(
          parser.filetype,
          parser.queries.injections,
          opts.assetsDir,
          opts.outputPath,
          "injections",
          opts.configPath,
        )
      }

      generatedParsers.push({
        filetype: parser.filetype,
        aliases: parser.aliases,
        languagePath,
        highlightsPath,
        injectionsPath,
        injectionMapping: parser.injectionMapping,
      })

      console.log(`  ✓ Completed ${parser.filetype}`)
    }

    console.log("Generating output file...")
    await generateDefaultParsersFile(generatedParsers, opts.outputPath)

    console.log("✅ Update completed successfully!")
  } catch (error) {
    console.error("❌ Update failed:", error)
    process.exit(1)
  }
}

function parseCLIArgs(): Partial<UpdateOptions> | null {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        config: { type: "string" },
        assets: { type: "string" },
        output: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    })

    if (values.help) {
      const command = path.basename(Bun.argv[1] ?? "update-assets.js")

      console.log(`Usage: bun ${command} [options]

Options:
  --config <path>  Path to parsers-config.json
  --assets <path>  Directory where .wasm and .scm files will be downloaded
  --output <path>  Path where the generated TypeScript file will be written
  --help           Show this help message

Remote query entries use { "url": "https://...", "sha256": "<64 lowercase hex characters>" }.
Local query entries are paths beginning with ./.

Examples:
  # Use default paths (for AX TUI core development)
  bun ${command}

  # Use custom paths (for application integration)
  bun ${command} --config ./my-parsers.json --assets ./src/parsers --output ./src/parsers.ts
`)
      process.exit(0)
    }

    const options: Partial<UpdateOptions> = {}
    if (values.config) options.configPath = path.resolve(values.config)
    if (values.assets) options.assetsDir = path.resolve(values.assets)
    if (values.output) options.outputPath = path.resolve(values.output)

    return Object.keys(options).length > 0 ? options : null
  } catch (error) {
    console.error(`Error parsing arguments: ${error}`)
    console.log("Run with --help for usage information")
    process.exit(1)
  }
}

export function runUpdateAssetsCli(): Promise<void> {
  const cliOptions = parseCLIArgs()
  return main(cliOptions || undefined)
}

if (import.meta.main) {
  await runUpdateAssetsCli()
}

export { main as updateAssets }
