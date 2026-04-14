import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  createTuiRendererContractTemplate,
  evaluateTuiRendererParity,
  normalizeTuiRendererContractReport,
  validateTuiRendererParityBenchmarkReport,
} from "../src/cli/cmd/tui/renderer-parity"
import { parseTuiRendererName } from "../src/cli/cmd/tui/renderer-choice"

async function readJSON<T>(file: string): Promise<T> {
  return JSON.parse(await Bun.file(file).text()) as T
}

async function writeJSON(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function value(name: string, argv = process.argv.slice(2)) {
  const idx = argv.indexOf(name)
  if (idx < 0) return
  const next = argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

function flag(name: string, argv = process.argv.slice(2)) {
  return argv.includes(name)
}

async function main() {
  const output = value("--output")
  if (flag("--contract-template")) {
    const template = createTuiRendererContractTemplate()
    if (output) await writeJSON(output, template)
    console.log(JSON.stringify(template, null, 2))
    return
  }

  const benchmarkPath = value("--benchmark-report")
  const contractPath = value("--contract")
  if (!benchmarkPath || !contractPath) throw new Error("Provide --benchmark-report <file> and --contract <file>")

  const decision = evaluateTuiRendererParity({
    renderer: parseTuiRendererName(value("--renderer") ?? process.env["AX_CODE_TUI_RENDERER"], "opentui"),
    benchmarkReport: validateTuiRendererParityBenchmarkReport(await readJSON<unknown>(benchmarkPath)),
    contract: normalizeTuiRendererContractReport(await readJSON<unknown>(contractPath)),
    opentuiFallbackRetained: flag("--opentui-fallback-retained"),
  })

  if (output) await writeJSON(output, decision)
  console.log(JSON.stringify(decision, null, 2))
  if (!decision.ready) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
