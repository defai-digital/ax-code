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
  // The Bash grammar can place an && list inside a redirected pipeline stage.
  if (node.type === "list") return command(node.namedChildren.at(-1) ?? null)
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

function validation(name: string, args: string[]): boolean {
  if (DRIVERS.has(name)) return !args.some((arg) => ["--help", "-h", "--version", "--showConfig"].includes(arg))
  if (name === "cargo" || name === "go") return args[0] === "test" || args[0] === "check"
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
    const stages = pipeline.namedChildren.map(command)
    const first = stages[0]
    if (!first || !validation(first.name, first.args)) continue
    if (!stages.slice(1).some((stage) => stage?.name === "head" || stage?.name === "tail")) continue
    throw new Error(
      "Validation output must not be piped through head or tail. No command ran. " +
        "Run the check directly with the tool timeout; output is captured and truncated automatically. " +
        "For slow tests use run_in_background and bash_output to follow the same run. " +
        "Read the saved output to obtain a summary; never rerun a suite only to retrieve its summary. " +
        "A pipeline's last-stage exit code does not prove the check passed.",
    )
  }
}
