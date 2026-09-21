import type { Node } from "web-tree-sitter"
import { decodeShellLiteral } from "./bash-helpers"
import { findWrappedCommand } from "./bash-destructive"

const WORD_TYPES = new Set(["command_name", "number", "word", "string", "raw_string", "concatenation"])
const DRIVERS = new Set(["vitest", "jest", "mocha", "pytest", "tsc"])
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"])
const VALUE_OPTIONS = new Set(["--dir", "-C", "--prefix", "--cwd", "--filter", "-F", "--workspace"])
const CHECK_SCRIPT = /^(?:test|typecheck|check|lint|validate)(?::[a-zA-Z0-9_-]+)*$/

function command(node: Node | null): { name: string; args: string[] } | undefined {
  if (!node) return
  if (node.type === "redirected_statement") {
    const body = node.namedChildren.find(
      (child) => child && child.type !== "file_redirect" && child.type !== "heredoc_redirect",
    )
    if (!body) return
    return command(body)
  }
  if (node.type !== "command") return
  const words = node.namedChildren
    .filter((child): child is Node => !!child && WORD_TYPES.has(child.type))
    .map((child) => decodeShellLiteral(child.text))
  if (words.some((word) => word === undefined)) return
  return findWrappedCommand(words as string[])
}

function stageCommands(node: Node | null): { name: string; args: string[] }[] {
  if (!node) return []
  if (["list", "subshell", "compound_statement", "redirected_statement"].includes(node.type)) {
    return node.namedChildren.flatMap(stageCommands)
  }
  const resolved = command(node)
  return resolved ? [resolved] : []
}

function validation(name: string, args: string[]): boolean {
  if (DRIVERS.has(name)) return !args.some((arg) => ["--help", "-h", "--version", "--showConfig"].includes(arg))
  if (name === "cargo")
    return ["test", "check", "clippy"].includes(args[0] ?? "") || (args[0] === "fmt" && args.includes("--check"))
  if (name === "go") return args[0] === "test" || args[0] === "vet"
  if (!PACKAGE_MANAGERS.has(name)) return false
  let i = 0
  while (i < args.length && args[i]!.startsWith("-")) {
    const option = args[i++]!
    if (VALUE_OPTIONS.has(option) || (name === "npm" && option === "-w")) i++
  }
  if (args[i] === "run") i++
  if (args[i] === "exec") return validation(args[i + 1] ?? "", args.slice(i + 2))
  return CHECK_SCRIPT.test(args[i] ?? "")
}

/** A bounded reliability check, not a general shell status or safety analyzer. */
export function assertValidationPipeline(root: Node): void {
  for (const pipeline of root.descendantsOfType("pipeline")) {
    if (!pipeline) continue
    const stages = pipeline.namedChildren.map(stageCommands)
    const first = stages[0]
    if (!first?.some((stage) => validation(stage.name, stage.args))) continue
    if (
      !stages
        .slice(1)
        .flat()
        .some((stage) => stage.name === "head" || stage.name === "tail")
    )
      continue
    throw new Error(
      "Validation output must not be piped through head or tail. No command ran. " +
        "Run the check directly with the tool timeout; output is captured and truncated automatically. " +
        "For slow tests use run_in_background and bash_output to follow the same run. " +
        "Read the saved output to obtain a summary; never rerun a suite only to retrieve its summary. " +
        "A pipeline's last-stage exit code does not prove the check passed.",
    )
  }
}
