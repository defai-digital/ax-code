import { mkdtemp, rm, writeFile } from "fs/promises"
import path from "path"
import os from "os"
import type { ProjectID } from "../src/project/schema"
import type { CodeNodeID } from "../src/code-intelligence/id"

type Metrics = {
  mode: "graph-first" | "grep-read-baseline"
  toolCalls: number
  fileReads: number
  graphQueries: number
  estimatedTokens: number
  elapsedMs: number
  success: boolean
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

type Runtime = {
  CodeGraphQuery: typeof import("../src/code-intelligence/query").CodeGraphQuery
  CodeNodeID: typeof import("../src/code-intelligence/id").CodeNodeID
  CodeEdgeID: typeof import("../src/code-intelligence/id").CodeEdgeID
  CodeFileID: typeof import("../src/code-intelligence/id").CodeFileID
}

function seedSymbol(
  runtime: Runtime,
  projectID: ProjectID,
  file: string,
  name: string,
  startLine: number,
  endLine: number,
) {
  const { CodeGraphQuery, CodeNodeID, CodeFileID } = runtime
  const now = Date.now()
  const id = CodeNodeID.ascending()
  CodeGraphQuery.insertNode({
    id,
    project_id: projectID,
    kind: "function",
    name,
    qualified_name: name,
    file,
    range_start_line: startLine,
    range_start_char: 0,
    range_end_line: endLine,
    range_end_char: 80,
    signature: null,
    visibility: null,
    metadata: null,
    time_created: now,
    time_updated: now,
  })
  CodeGraphQuery.upsertFile({
    id: CodeFileID.ascending(),
    project_id: projectID,
    path: file,
    sha: "bench",
    size: 100,
    lang: "typescript",
    indexed_at: now,
    completeness: "full",
    time_created: now,
    time_updated: now,
  })
  return id
}

function seedCall(runtime: Runtime, projectID: ProjectID, from: CodeNodeID, to: CodeNodeID, file: string) {
  const { CodeGraphQuery, CodeEdgeID } = runtime
  const now = Date.now()
  CodeGraphQuery.insertEdge({
    id: CodeEdgeID.ascending(),
    project_id: projectID,
    kind: "calls",
    from_node: from,
    to_node: to,
    file,
    range_start_line: 5,
    range_start_char: 9,
    range_end_line: 5,
    range_end_char: 24,
    time_created: now,
    time_updated: now,
  })
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-graph-context-bench-"))
  const home = path.join(dir, "home")
  process.env["AX_CODE_TEST_HOME"] = home
  process.env["AX_CODE_NATIVE_INDEX"] = "0"
  process.env["XDG_DATA_HOME"] = path.join(dir, "share")
  process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
  process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
  process.env["XDG_STATE_HOME"] = path.join(dir, "state")

  const { Instance } = await import("../src/project/instance")
  const { CodeIntelligence } = await import("../src/code-intelligence")
  const { GraphContext } = await import("../src/code-intelligence/graph-context")
  const { CodeGraphQuery } = await import("../src/code-intelligence/query")
  const { CodeNodeID, CodeEdgeID, CodeFileID } = await import("../src/code-intelligence/id")
  const { Database } = await import("../src/storage/db")
  const runtime = { CodeGraphQuery, CodeNodeID, CodeEdgeID, CodeFileID }

  try {
    await Instance.provide({
      directory: dir,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        const file = path.join(dir, "checkout.ts")
        const source = [
          "export function chargeCard() {",
          "  return true",
          "}",
          "export function checkout() {",
          "  if (!chargeCard()) throw new Error('payment failed')",
          "  return 'ok'",
          "}",
          "export function refund() {",
          "  return chargeCard()",
          "}",
          ...Array.from({ length: 80 }, (_, i) => `export const unrelated${i} = ${i}`),
        ].join("\n")
        await writeFile(file, source)
        const charge = seedSymbol(runtime, projectID, file, "chargeCard", 0, 2)
        const checkout = seedSymbol(runtime, projectID, file, "checkout", 3, 6)
        const refund = seedSymbol(runtime, projectID, file, "refund", 7, 9)
        seedCall(runtime, projectID, checkout, charge, file)
        seedCall(runtime, projectID, refund, charge, file)
        CodeGraphQuery.upsertCursor(projectID, "bench", 3, 2)

        const graphStart = performance.now()
        const pack = await GraphContext.build(projectID, {
          query: "what calls chargeCard",
          maxSymbols: 2,
          maxSnippets: 1,
          scope: "none",
        })
        const graph: Metrics = {
          mode: "graph-first",
          toolCalls: 1,
          fileReads: pack.snippets.length,
          graphQueries: 1 + pack.symbols.length * 3,
          estimatedTokens: estimateTokens(pack.output),
          elapsedMs: performance.now() - graphStart,
          success: pack.output.includes("checkout") && pack.output.includes("refund"),
        }

        const baselineStart = performance.now()
        const baselineOutput = source
          .split(/\r?\n/)
          .map((line, idx) => `${idx + 1}: ${line}`)
          .filter((line) => line.includes("chargeCard") || line.includes("checkout") || line.includes("refund"))
          .join("\n")
        const baseline: Metrics = {
          mode: "grep-read-baseline",
          toolCalls: 3,
          fileReads: 1,
          graphQueries: 0,
          estimatedTokens: estimateTokens(source + "\n" + baselineOutput),
          elapsedMs: performance.now() - baselineStart,
          success: baselineOutput.includes("checkout") && baselineOutput.includes("refund"),
        }

        console.log(JSON.stringify({ tasks: ["what calls chargeCard"], metrics: [graph, baseline] }, null, 2))
        CodeIntelligence.__clearProject(projectID)
      },
    })
  } finally {
    Database.close()
    await rm(dir, { recursive: true, force: true })
  }
}

await main()
