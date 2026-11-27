/**
 * Type-check every ```ts fence in the SDK README against the package sources.
 *
 * Each fence is compiled as its own virtual module rooted under
 * `packages/sdk/js`, so `node_modules` resolution (for example `zod`) works
 * without running the package build. A shared ambient prelude supplies the
 * identifiers that snippets intentionally inherit from surrounding prose or
 * from an earlier snippet.
 *
 * Run directly with:
 *   pnpm --dir packages/sdk/js exec tsx ./script/check-readme-snippets.ts
 */

import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const PACKAGE_ROOT = resolve(import.meta.dirname, "..")
const DEFAULT_README = join(PACKAGE_ROOT, "README.md")

const SNIPPET_RE = /^```ts[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm

// TypeScript hands the compiler host forward-slash normalized file names, so
// normalize every virtual key to POSIX. Otherwise `path.join` keys use
// backslashes on Windows and the lookups miss (TS6053).
export const toPosix = (path: string): string => path.replaceAll("\\", "/")

const PRELUDE_FILE = toPosix(join(PACKAGE_ROOT, "__readme_prelude__.d.ts"))
const SNIPPET_PREFIX = toPosix(join(PACKAGE_ROOT, "__readme_snippet_"))
const PRELUDE_SOURCE = `import type { Agent } from "@defai-digital/ax-code-sdk"

declare global {
  var agent: Agent
  var backend: { url: string; headers: Record<string, string> }
  var directory: string
  var sessionID: string
  var clientID: string
  function test(name: string, body: () => void | Promise<void>): void
  function expect(actual: unknown): {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
  }
}

export {}
`

/** One diagnostic reported against a README snippet. */
export type SnippetDiagnostic = {
  /** 0-based snippet index, or -1 for a program-wide diagnostic. */
  snippet: number
  /** 1-based line number in README.md, or 0 for a program-wide diagnostic. */
  readmeLine: number
  code: number
  message: string
}

/** Result of checking the README snippets. */
export type ReadmeSnippetCheckResult = {
  snippets: number
  diagnostics: SnippetDiagnostic[]
}

type Snippet = {
  index: number
  /** 1-based README line of the first snippet source line. */
  firstContentLine: number
  fileName: string
  source: string
}

/** Resolve `@defai-digital/ax-code-sdk` imports to the package sources, mirroring `exports`. */
const EXPORT_SOURCES: Record<string, string> = {
  "@defai-digital/ax-code-sdk": "src/index.ts",
  "@defai-digital/ax-code-sdk/testing": "src/testing/index.ts",
  "@defai-digital/ax-code-sdk/programmatic": "src/programmatic/index.ts",
  "@defai-digital/ax-code-sdk/grpc": "src/grpc.ts",
  "@defai-digital/ax-code-sdk/grpc/node": "src/grpc-node.ts",
  "@defai-digital/ax-code-sdk/headless": "src/headless.ts",
  "@defai-digital/ax-code-sdk/headless-ipc": "src/headless-ipc.ts",
  "@defai-digital/ax-code-sdk/headless/client": "src/headless/client.ts",
  "@defai-digital/ax-code-sdk/headless/event": "src/headless/event.ts",
  "@defai-digital/ax-code-sdk/headless/projection": "src/headless/projection.ts",
  "@defai-digital/ax-code-sdk/mode": "src/mode.ts",
  "@defai-digital/ax-code-sdk/provider-connect": "src/provider-connect.ts",
  "@defai-digital/ax-code-sdk/v2": "src/v2/index.ts",
  "@defai-digital/ax-code-sdk/v2/client": "src/v2/client.ts",
  "@defai-digital/ax-code-sdk/v2/gen/client": "src/v2/gen/client/index.ts",
  "@defai-digital/ax-code-sdk/v2/server": "src/v2/server.ts",
  "@defai-digital/ax-code-sdk/tui-debug": "src/tui-debug.ts",
}

// `paths` substitutions are absolute so no `baseUrl` is needed (removed in TS 7).
const PATHS: ts.MapLike<string[]> = Object.fromEntries(
  Object.entries(EXPORT_SOURCES).map(([specifier, source]) => [specifier, [join(PACKAGE_ROOT, source)]]),
)

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2024.d.ts", "lib.esnext.array.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: ["node"],
  typeRoots: [join(PACKAGE_ROOT, "node_modules/@types")],
  paths: PATHS,
}

function extractSnippets(readme: string): Snippet[] {
  const snippets: Snippet[] = []
  for (const match of readme.matchAll(SNIPPET_RE)) {
    const source = match[1]
    if (source === undefined) continue
    const index = snippets.length
    const openingLine = readme.slice(0, match.index).split("\n").length
    snippets.push({
      index,
      firstContentLine: openingLine + 1,
      fileName: `${SNIPPET_PREFIX}${index}.ts`,
      source,
    })
  }
  return snippets
}

function createHost(sources: Map<string, string>): ts.CompilerHost {
  const host = ts.createCompilerHost(COMPILER_OPTIONS)
  const getSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const readFile = host.readFile.bind(host)

  host.fileExists = (fileName) => sources.has(toPosix(fileName)) || fileExists(fileName)
  host.readFile = (fileName) => sources.get(toPosix(fileName)) ?? readFile(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(toPosix(fileName))
    if (source !== undefined) return ts.createSourceFile(fileName, source, languageVersion, true)
    return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }
  return host
}

function flatten(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
}

/** Type-check every ```ts fence in the README and return mapped diagnostics. */
export function checkReadmeSnippets(options: { readmePath?: string } = {}): ReadmeSnippetCheckResult {
  const readmePath = options.readmePath ?? DEFAULT_README
  const snippets = extractSnippets(readFileSync(readmePath, "utf8"))

  const sources = new Map<string, string>()
  sources.set(PRELUDE_FILE, PRELUDE_SOURCE)
  for (const snippet of snippets) sources.set(snippet.fileName, snippet.source)

  const rootNames = [PRELUDE_FILE, ...snippets.map((snippet) => snippet.fileName)]
  const program = ts.createProgram(rootNames, COMPILER_OPTIONS, createHost(sources))
  const byFileName = new Map(snippets.map((snippet) => [snippet.fileName, snippet] as const))

  const diagnostics: SnippetDiagnostic[] = []
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const diagnosticFileName = diagnostic.file ? toPosix(diagnostic.file.fileName) : undefined
    const snippet = diagnosticFileName ? byFileName.get(diagnosticFileName) : undefined
    if (!snippet) {
      // Ignore diagnostics from the real sources and lib files; the package
      // typecheck covers those. Only report errors in snippet/prelude files.
      if (diagnosticFileName && diagnosticFileName !== PRELUDE_FILE) continue
      diagnostics.push({ snippet: -1, readmeLine: 0, code: diagnostic.code, message: flatten(diagnostic) })
      continue
    }
    let readmeLine = 0
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      readmeLine = snippet.firstContentLine + line
    }
    diagnostics.push({ snippet: snippet.index, readmeLine, code: diagnostic.code, message: flatten(diagnostic) })
  }

  diagnostics.sort((a, b) => a.readmeLine - b.readmeLine || a.code - b.code)
  return { snippets: snippets.length, diagnostics }
}

/** Format diagnostics for CLI output. */
export function formatSnippetDiagnostics(readmePath: string, diagnostics: SnippetDiagnostic[]): string[] {
  const label = relative(process.cwd(), readmePath) || readmePath
  return diagnostics.map((diagnostic) => {
    const location = diagnostic.readmeLine > 0 ? `${label}:${diagnostic.readmeLine}` : label
    return `${location} - error TS${diagnostic.code}: ${diagnostic.message}`
  })
}

function main(): void {
  const readmePath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_README
  const result = checkReadmeSnippets({ readmePath })
  if (result.diagnostics.length === 0) {
    console.log(`README snippets type-check (${result.snippets} fences).`)
    return
  }
  for (const line of formatSnippetDiagnostics(readmePath, result.diagnostics)) console.error(line)
  console.error(`\n${result.diagnostics.length} README snippet error(s).`)
  process.exitCode = 1
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (entry === import.meta.url) main()
