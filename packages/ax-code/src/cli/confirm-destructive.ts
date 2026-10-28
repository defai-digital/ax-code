import { UI } from "./ui"

/** Ask a y/N question before a destructive CLI action; anything but "y" cancels. */
export async function confirmDestructiveAction(prompt: string) {
  if (!process.stdin.isTTY) {
    UI.error("Confirmation required but stdin is not interactive; re-run with --force to proceed")
    process.exitCode = 1
    return false
  }
  const readline = await import("readline")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => {
    // readline traps ^C in raw mode and only pauses, so question() would
    // never resolve; treat Ctrl+C or a closed input as "no".
    rl.once("SIGINT", () => {
      process.stdout.write("\n")
      resolve("")
    })
    rl.once("close", () => resolve(""))
    rl.question(`${prompt} (y/N) `, resolve)
  })
  rl.close()
  if (answer.toLowerCase() !== "y") {
    UI.println("Cancelled.")
    return false
  }
  return true
}
