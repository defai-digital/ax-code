import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import fs from "fs/promises"

import { Filesystem } from "@/util/filesystem"
import { Env } from "@/util/env"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncate"
import { Plugin } from "@/plugin"
import { Isolation } from "@/isolation"

import { BASH_MAX_METADATA_LENGTH as MAX_METADATA_LENGTH } from "@/constants/network"
const DEFAULT_TIMEOUT = Flag.AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

const log = Log.create({ service: "bash-tool" })

// Track detached process groups so we can clean them up if the parent
// process exits unexpectedly (crash, SIGKILL, etc.). Without this,
// detached child processes become orphans that keep running.
const trackedPIDs = new Set<number>()
process.on("exit", () => {
  for (const pid of trackedPIDs) {
    try {
      process.kill(-pid, "SIGTERM")
    } catch {}
  }
})

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().min(1).max(600_000).describe("Optional timeout in milliseconds (max 600000)").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir
        ? await fs.realpath(path.resolve(Instance.directory, params.workdir)).catch(() => path.resolve(Instance.directory, params.workdir!))
        : Instance.directory
      if (params.timeout !== undefined && (!Number.isFinite(params.timeout) || params.timeout < 1)) {
        // Reject NaN, Infinity, 0, and negatives: timeout=0 combined
        // with the `+ 100` in the kill timer fires ~100ms later,
        // giving commands almost no time to run. NaN would bypass the
        // comparison entirely, producing undefined behaviour
        // downstream.
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a finite positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const resolvedPaths = new Set<string>()
      const patterns = new Set<string>()
      const always = new Set<string>()
      let foundCommands = false

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue

        // Get full command text including redirects if present
        let commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // Commands that wrap or delegate to other commands.
        // For shell invocations with -c, and eval, we parse the inner
        // command string to extract paths. For source/., we resolve
        // the script path. Arguments containing command substitution
        // ($(...), `...`, ${...}) are opaque — flag the whole command.
        if (["eval", "bash", "sh", "zsh", "source", "."].includes(command[0])) {
          const isShellWithC =
            ["bash", "sh", "zsh"].includes(command[0]) && command.includes("-c")
          const isEval = command[0] === "eval"

          // Collect the inner command string for eval / shell -c
          let innerCmd: string | undefined
          if (isShellWithC) {
            const cIdx = command.indexOf("-c")
            if (cIdx >= 0 && cIdx + 1 < command.length) {
              // Strip surrounding quotes that tree-sitter may preserve
              innerCmd = command[cIdx + 1].replace(/^"(.*)"$|^'(.*)'$/s, "$1$2")
            }
          } else if (isEval) {
            // eval concatenates all its arguments into a single command
            const evalArgs = command.slice(1).map((a) => a.replace(/^"(.*)"$|^'(.*)'$/s, "$1$2"))
            if (evalArgs.length > 0) innerCmd = evalArgs.join(" ")
          }

          if (innerCmd) {
            // Parse the inner command string to extract paths from
            // known commands (rm, cat, etc.). Individual args that
            // contain command substitution ($(...), `...`, ${...})
            // are skipped since they can't be statically resolved —
            // the outer bash permission prompt still fires as a
            // safety net for those cases.
            const p = await parser()
            const innerTree = p.parse(innerCmd)
            if (innerTree) {
              for (const innerNode of innerTree.rootNode.descendantsOfType("command")) {
                if (!innerNode) continue
                const innerParts: string[] = []
                for (let j = 0; j < innerNode.childCount; j++) {
                  const c = innerNode.child(j)
                  if (!c) continue
                  if (["command_name", "word", "string", "raw_string", "concatenation"].includes(c.type)) {
                    innerParts.push(c.text)
                  }
                }
                if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(innerParts[0])) {
                  for (const innerArg of innerParts.slice(1)) {
                    if (innerArg.startsWith("-") || (innerParts[0] === "chmod" && innerArg.startsWith("+"))) continue
                    // Skip args with command substitution — can't resolve
                    if (/\$\(|\$\{|`/.test(innerArg)) continue
                    const resolved = await fs.realpath(path.resolve(cwd, innerArg)).catch(() => path.resolve(cwd, innerArg))
                    if (resolved) {
                      const normalized =
                        process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
                      resolvedPaths.add(normalized)
                      if (!Instance.containsPath(normalized)) {
                        const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                        directories.add(dir)
                      }
                    }
                  }
                }
              }
            }
          }

          // For source/. (not eval or shell -c), resolve args as file paths
          if (!isShellWithC && !isEval) {
            for (const arg of command.slice(1)) {
              if (arg.startsWith("-")) continue
              const resolved = await fs.realpath(path.resolve(cwd, arg)).catch(() => path.resolve(cwd, arg))
              if (resolved) {
                const normalized =
                  process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
                resolvedPaths.add(normalized)
                if (!Instance.containsPath(normalized)) {
                  const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                  directories.add(dir)
                }
              }
            }
          }
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await fs.realpath(path.resolve(cwd, arg)).catch(() => path.resolve(cwd, arg))
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              const normalized =
                process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
              resolvedPaths.add(normalized)
              if (!Instance.containsPath(normalized)) {
                const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                directories.add(dir)
              }
            }
          }
        }

        // cd covered by above check; track that we found a command
        // so the fallback below doesn't re-add skipped commands.
        if (command.length && command[0] !== "cd") {
          patterns.add(commandText)
          always.add(BashArity.prefix(command).join(" ") + " *")
        }
        if (command.length) foundCommands = true
      }

      Isolation.assertBash(ctx.extra?.isolation, cwd, Instance.directory, Instance.worktree, [...resolvedPaths])

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          // Preserve POSIX-looking paths with /s, even on Windows
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      // If tree-sitter found no command nodes at all (e.g. parsing edge
      // cases, subshells, or unusual syntax), fall back to prompting for
      // the entire raw command so the permission check is never bypassed.
      // Don't fall back if we found commands but intentionally skipped
      // them (e.g. cd-only commands are handled by the directory check).
      if (patterns.size === 0 && !foundCommands) {
        patterns.add(params.command)
        always.add(params.command)
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      // Strip secrets from process.env before forwarding to the child.
      // See Env.sanitize for the rationale — LLM-invoked shell commands
      // must not see provider tokens, passwords, or other credentials
      // held by the parent process.
      const sanitizedEnv = Env.sanitize({
        ...process.env,
        ...shellEnv.env,
      })
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...sanitizedEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: process.platform === "win32",
      })
      if (proc.pid) trackedPIDs.add(proc.pid)

      let output = ""
      // Hard cap on raw output to protect process memory against
      // commands that produce gigabytes of stdout/stderr. Previously
      // only the metadata snapshot was truncated; the `output` string
      // itself grew unbounded and accumulated the full stream in RAM
      // until the process was killed by the OOM killer. 10MB matches
      // the size at which we should surface a clear "output too large"
      // signal rather than silently truncating forever.
      const OUTPUT_HARD_CAP = 10 * 1024 * 1024
      let truncated = false
      let timedOut = false
      let aborted = false
      let exited = false
      let outputBytes = 0
      let lastOutputAt: number | undefined
      let killStartedAt: number | undefined
      let killCompletedAt: number | undefined

      const hangMetadata = () => ({
        processId: proc.pid ?? null,
        signal: proc.signalCode ?? null,
        timeoutMs: timeout,
        timedOut,
        aborted,
        outputBytes,
        outputTruncated: truncated,
        lastOutputAt: lastOutputAt ?? null,
        killStartedAt: killStartedAt ?? null,
        killCompletedAt: killCompletedAt ?? null,
        killDurationMs:
          killStartedAt !== undefined && killCompletedAt !== undefined ? killCompletedAt - killStartedAt : null,
      })

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
          hang: hangMetadata(),
        },
      })

      const append = (chunk: Buffer) => {
        outputBytes += chunk.byteLength
        lastOutputAt = Date.now()
        if (output.length < OUTPUT_HARD_CAP) {
          const remaining = OUTPUT_HARD_CAP - output.length
          const text = chunk.toString()
          if (text.length <= remaining) {
            output += text
          } else {
            output += text.slice(0, remaining) + "\n\n[output truncated at 10MB]"
            truncated = true
          }
        }
        ctx.metadata({
          metadata: {
            // truncate the metadata snapshot separately (smaller cap).
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
            hang: hangMetadata(),
          },
        })
      }
      void truncated

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      const kill = async () => {
        if (killStartedAt !== undefined) return
        killStartedAt = Date.now()
        await Shell.killTree(proc, { exited: () => exited })
        killCompletedAt = Date.now()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
          if (proc.pid) trackedPIDs.delete(proc.pid)
        }

        proc.once("close", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })

        if (ctx.abort.aborted) {
          aborted = true
          void kill()
        }
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
          hang: hangMetadata(),
        },
        output,
      }
    },
  }
})
