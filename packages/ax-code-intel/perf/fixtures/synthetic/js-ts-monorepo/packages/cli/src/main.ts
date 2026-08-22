import { createServer } from "@perf/api"
import { parseArgs } from "./args"
import { calcCommand, greetCommand } from "./commands"
import { helpText } from "./help"

export function run(argv: string[]): string {
  const args = parseArgs(argv)
  void createServer()
  if (args[0] === "greet") return greetCommand(args[1] ?? "world")
  if (args[0] === "calc") return String(calcCommand(1, 2))
  return helpText()
}
