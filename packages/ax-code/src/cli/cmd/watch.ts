import { spawn } from "child_process"
import { readFile } from "fs/promises"
import path from "path"
import type { Argv } from "yargs"
import { FileIgnore } from "../../file/ignore"
import { Protected } from "../../file/protected"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { createWatchLoop } from "./watch-comments"

/**
 * `ax-code watch` (ADR-228): a long-running foreground command that watches
 * the workspace for AI! / AI? comments and submits each one as an ordinary
 * prompt through the same path as `ax-code run` (a child `run` process, so
 * permissions, model selection and output behave exactly like a manual run).
 *
 * Watch events respect .gitignore (the @parcel/watcher binding applies it
 * natively) plus the shared ignore patterns and the protected-path list.
 */

function isWatchable(directory: string, file: string): boolean {
  const rel = path.relative(directory, file)
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return false
  if (FileIgnore.match(rel)) return false
  for (const protectedPath of Protected.paths()) {
    if (file === protectedPath || file.startsWith(protectedPath + path.sep)) return false
  }
  return true
}

/**
 * Submits one prompt by spawning the CLI's own `run` command. The child
 * inherits stdio so the user sees the live run output; a non-zero exit is
 * surfaced as a rejected promise and logged by the watch loop, which keeps
 * watching.
 */
export function createCliSubmitter(input: { session?: string; dir?: string; onSpawn?: (running: boolean) => void }) {
  return async (prompt: string) => {
    const { backendProcessCommand } = await import("../tui/thread")
    const commandArgs = [
      "run",
      ...(input.session ? ["--session", input.session] : []),
      ...(input.dir ? ["--dir", input.dir] : []),
      "--",
      prompt,
    ]
    const { command, args } = backendProcessCommand(commandArgs)
    input.onSpawn?.(true)
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit" })
        child.once("error", (error) => reject(error))
        child.once("close", (code) => {
          if (code === 0) resolve()
          else reject(new Error(`ax-code run exited with code ${code ?? "signal"}`))
        })
      })
    } finally {
      input.onSpawn?.(false)
    }
  }
}

async function subscribeParcel(directory: string, onEvent: (file: string) => void): Promise<() => Promise<void>> {
  // Load the watcher binding through createRequire from this module's URL:
  // a bare `require` is unavailable under some ESM launchers (see
  // src/file/watcher.ts for the same pattern).
  const { createRequire } = await import("node:module")
  const require = createRequire(import.meta.url)
  const parcel = require("@parcel/watcher") as typeof import("@parcel/watcher")
  const ignore = FileIgnore.PATTERNS.map((item) => (path.isAbsolute(item) ? item : path.join(directory, item)))
  const subscription = await parcel.subscribe(
    directory,
    (error, events) => {
      if (error) return
      for (const event of events) {
        if (event.type !== "create" && event.type !== "update") continue
        onEvent(path.resolve(event.path))
      }
    },
    // The binding applies .gitignore rules natively; PATTERNS prunes the
    // noisy built-ins (node_modules, .git, build output, ...) at the source.
    { ignore },
  )
  return () => subscription.unsubscribe()
}

export const WatchCommand = cmd({
  command: "watch [--dir] [--session] [--once-file]",
  describe: "watch the workspace for AI! (do this) and AI? (answer this) comments and submit each as a prompt",
  builder: (yargs: Argv) =>
    yargs
      .option("dir", {
        type: "string",
        describe: "directory to watch (defaults to the current directory)",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to submit prompts to; a new session per comment otherwise",
      })
      .option("once-file", {
        type: "string",
        describe: "process a single file once and exit (primarily for tests)",
      })
      .option("debounce-ms", {
        type: "number",
        describe: "per-file debounce window in milliseconds",
        default: 500,
      }),
  handler: async (args) => {
    const directory = path.resolve(args.dir ?? process.cwd())
    let submissionActive = false
    const submit = createCliSubmitter({
      session: args.session,
      dir: directory,
      onSpawn: (running) => {
        submissionActive = running
      },
    })
    const loop = createWatchLoop(
      {
        readFile: (file) => readFile(file, "utf8"),
        submit,
        log: (message) => UI.println(message),
      },
      { debounceMs: args["debounce-ms"] },
    )

    if (args["once-file"]) {
      const file = path.resolve(args["once-file"])
      const submitted = await loop.processFile(file)
      UI.println(`watch: ${submitted} comment${submitted === 1 ? "" : "s"} submitted from ${file}`)
      return
    }

    let unsubscribe: (() => Promise<void>) | undefined
    const keepAlive = setInterval(() => undefined, 3_600_000)
    const shutdown = (code: number) => {
      clearInterval(keepAlive)
      const pending = unsubscribe?.()
      void pending?.catch(() => undefined)
      process.exit(code)
    }
    // First Ctrl+C while a run is active only interrupts the child `run`
    // (it receives the signal through the process group); the watcher stays
    // up. Ctrl+C while idle stops watching.
    process.once("SIGINT", () => {
      if (submissionActive) return
      shutdown(0)
    })

    UI.println(`watch: ${directory}`)
    UI.println(`watch: markers AI! (do this) and AI? (answer this); comments are never rewritten`)
    try {
      unsubscribe = await subscribeParcel(directory, (file) => {
        if (!isWatchable(directory, file)) return
        loop.onChange(file)
      })
    } catch (error) {
      UI.error(
        `watch: filesystem watcher unavailable in ${directory}: ${error instanceof Error ? error.message : String(error)}`,
      )
      shutdown(1)
      return
    }
    UI.println("watch: ready")
  },
})
