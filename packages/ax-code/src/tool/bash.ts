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
import { BlastRadius } from "@/session/blast-radius"
import { assertSymlinkInsideProject } from "./external-directory"
import { normalizeToWorkspacePath, resolveToolFilePath } from "./file-path"

import { BASH_MAX_METADATA_LENGTH as MAX_METADATA_LENGTH } from "@/constants/network"
const DEFAULT_TIMEOUT = Flag.AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

const log = Log.create({ service: "bash-tool" })

function hasDynamicShellExpansion(value: string) {
  return /\$\(|\$\{|`/.test(value)
}

function assertStaticRedirectTarget(target: string) {
  if (hasDynamicShellExpansion(target)) {
    throw new Error("Dynamic redirection targets are not allowed")
  }
}

function stripShellQuotes(value: string) {
  return value.replace(/^"(.*)"$|^'(.*)'$/s, "$1$2")
}

function isStaticPathArg(value: string) {
  const stripped = stripShellQuotes(value)
  if (!stripped || hasDynamicShellExpansion(stripped)) return undefined
  return stripped
}

function positionalArgs(args: string[]) {
  const result: string[] = []
  let afterSeparator = false
  for (const arg of args) {
    if (!afterSeparator && arg === "--") {
      afterSeparator = true
      continue
    }
    if (!afterSeparator && arg.startsWith("-")) continue
    result.push(arg)
  }
  return result
}

function hasAnyFlag(args: string[], flags: string[]) {
  return args.some(
    (arg) =>
      flags.includes(arg) ||
      (arg.startsWith("-") && !arg.startsWith("--") && flags.some((flag) => flag.length === 2 && arg.includes(flag[1]!))),
  )
}

function staticallyCheckablePathArgs(cmd: string, args: string[]) {
  const positional = positionalArgs(args)
  switch (cmd) {
    case "cd":
      return positional.slice(0, 1)
    case "cat":
      return positional
    case "rm":
      if (hasAnyFlag(args, ["-f", "--force"])) return []
      return positional
    case "mv":
    case "cp":
      return positional.length > 1 ? positional.slice(0, -1) : positional
    default:
      return []
  }
}

function hasDynamicRedirection(command: string) {
  return /(?:^|[\s&;])\d*>>?\s*(?:\$\(|\$\{|`)/.test(command)
}

function absolutePathLiterals(value: string) {
  return Array.from(value.matchAll(/["'](\/[^"']+)["']/g), (match) => match[1]).filter(Boolean)
}

async function estimateFileLineDelta(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => undefined)
  if (!stat?.isFile()) return 1
  return Math.max(1, Math.ceil(stat.size / 80))
}

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
        .max(200)
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      if (params.workdir !== undefined) {
        resolveToolFilePath(params.workdir, Instance.directory)
      }
      if (params.command.includes("\x00")) throw new Error("Command contains null byte")
      if (hasDynamicRedirection(params.command)) throw new Error("Dynamic redirection targets are not allowed")
      const requestedCwd = params.workdir ? resolveToolFilePath(params.workdir, Instance.directory) : Instance.directory
      await assertSymlinkInsideProject(requestedCwd)
      const cwd = params.workdir
        ? await fs.realpath(requestedCwd).catch(() => {
            throw new Error(`Working directory does not exist: ${params.workdir}`)
          })
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
      const redirectWritePaths = new Set<string>()
      const patterns = new Set<string>()
      const always = new Set<string>()
      let foundCommands = false

      const recordResolvedPath = async (raw: string) => {
        const arg = stripShellQuotes(raw)
        if (!arg || hasDynamicShellExpansion(arg)) return
        const resolved = await fs.realpath(path.resolve(cwd, arg)).catch(() => path.resolve(cwd, arg))
        const normalized =
          process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
        resolvedPaths.add(normalized)
        if (!Instance.containsPath(normalized)) {
          const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
          directories.add(dir)
        }
      }

      const recordInnerCommandPaths = async (parts: string[]) => {
        const name = parts[0]
        if (!name) return
        const args = parts.slice(1)

        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat", "tee", "install"].includes(name)) {
          for (const arg of args) {
            if (arg.startsWith("-") || (name === "chmod" && arg.startsWith("+"))) continue
            await recordResolvedPath(arg)
          }
          return
        }

        if (["curl", "wget"].includes(name)) {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (!arg) continue
            if (arg === "-o" || arg === "--output" || arg === "--output-document") {
              const next = args[i + 1]
              if (next) await recordResolvedPath(next)
              i++
              continue
            }
            const inline = arg.match(/^--(?:output|output-document)=(.+)$/)?.[1]
            if (inline) await recordResolvedPath(inline)
          }
          return
        }

        if (name === "dd") {
          for (const arg of args) {
            const output = arg.match(/^of=(.+)$/)?.[1]
            if (output) await recordResolvedPath(output)
          }
          return
        }

        if (["rsync", "scp"].includes(name)) {
          for (const arg of args) {
            if (arg.startsWith("-") || /^[^/][^:]*:/.test(arg)) continue
            await recordResolvedPath(arg)
          }
          return
        }

        if (["python", "python3", "node", "ruby", "perl"].includes(name)) {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (!arg) continue
            if (arg === "-c" || arg === "-e") {
              const code = args[i + 1]
              if (code) {
                for (const literal of absolutePathLiterals(stripShellQuotes(code))) {
                  await recordResolvedPath(literal)
                }
              }
              i++
              continue
            }
            if (arg.startsWith("-")) continue
            await recordResolvedPath(arg)
            break
          }
          return
        }

        for (const arg of args) {
          if (arg.startsWith("-")) continue
          const unquoted = stripShellQuotes(arg)
          if (path.isAbsolute(unquoted)) await recordResolvedPath(unquoted)
        }
      }

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
          const isShellWithC = ["bash", "sh", "zsh"].includes(command[0]) && command.includes("-c")
          const isEval = command[0] === "eval"

          // Collect the inner command string for eval / shell -c
          let innerCmd: string | undefined
          if (isShellWithC) {
            const cIdx = command.indexOf("-c")
            if (cIdx >= 0 && cIdx + 1 < command.length) {
              // Strip surrounding quotes that tree-sitter may preserve
              innerCmd = stripShellQuotes(command[cIdx + 1])
            }
          } else if (isEval) {
            // eval concatenates all its arguments into a single command
            const evalArgs = command.slice(1).map(stripShellQuotes)
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
                await recordInnerCommandPaths(innerParts)
              }
              // Inner-tree redirect targets: `bash -c "echo > /etc/x"` and
              // `eval "echo >> /etc/x"` would otherwise bypass the outer
              // file_redirect scan because the redirect lives inside the
              // string argument, not as a sibling AST node of the outer
              // command.
              for (const innerRedirect of innerTree.rootNode.descendantsOfType("file_redirect")) {
                if (!innerRedirect) continue
                for (let j = 0; j < innerRedirect.childCount; j++) {
                  const c = innerRedirect.child(j)
                  if (!c) continue
                  if (!["word", "string", "raw_string", "concatenation"].includes(c.type)) continue
                  const target = stripShellQuotes(c.text)
                  if (!target || /^&/.test(target)) continue
                  assertStaticRedirectTarget(target)
                  const resolved = await fs.realpath(path.resolve(cwd, target)).catch(() => path.resolve(cwd, target))
                  if (!resolved) continue
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

      // Redirection targets (`> /etc/x`, `tee /etc/x`-style file_redirect)
      // must be sandboxed: in workspace-write mode the model could
      // otherwise overwrite arbitrary files outside the workspace through
      // a stdout redirect that the per-command path scan ignored.
      for (const redirect of tree.rootNode.descendantsOfType("file_redirect")) {
        if (!redirect) continue
        for (let i = 0; i < redirect.childCount; i++) {
          const child = redirect.child(i)
          if (!child) continue
          if (!["word", "string", "raw_string", "concatenation"].includes(child.type)) continue
          const target = stripShellQuotes(child.text)
          // Skip command substitution / fd dup (&1 etc.) — opaque or non-path.
          if (!target || /^&/.test(target)) continue
          assertStaticRedirectTarget(target)
          const resolved = await fs.realpath(path.resolve(cwd, target)).catch(() => path.resolve(cwd, target))
          if (!resolved) continue
          const normalized =
            process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
          resolvedPaths.add(normalized)
          redirectWritePaths.add(normalized)
          if (!Instance.containsPath(normalized)) {
            const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
            directories.add(dir)
          }
        }
      }

      for (const filePath of redirectWritePaths) {
        if (Filesystem.contains(Instance.worktree, filePath)) {
          BlastRadius.assertWritable(ctx.sessionID, normalizeToWorkspacePath(filePath, Instance.worktree))
        }
      }

      // Pre-validation: check that paths referenced by read-only commands
      // actually exist before spawning the process. This saves a wasted LLM
      // turn — instead of getting a generic shell error, the model receives
      // a structured message naming the missing path.
      const missingPaths: string[] = []
      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
        const parts: string[] = []
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (!c) continue
          if (["command_name", "word", "string", "raw_string", "concatenation"].includes(c.type)) {
            parts.push(c.text)
          }
        }
        const cmd = parts[0]
        if (!cmd) continue
        for (const arg of staticallyCheckablePathArgs(cmd, parts.slice(1))) {
          const staticPath = isStaticPathArg(arg)
          if (!staticPath) continue
          const resolved = path.resolve(cwd, staticPath)
          const exists = await Filesystem.exists(resolved)
          if (!exists) missingPaths.push(resolved)
        }
      }
      if (missingPaths.length > 0) {
        const unique = [...new Set(missingPaths)]
        throw new Error(
          `Path does not exist: ${unique.slice(0, 3).join(", ")}${unique.length > 3 ? ` (and ${unique.length - 3} more)` : ""}.\n` +
            `Hint: use the Glob or Read tool to discover available files before running commands against them.`,
        )
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
      if (proc.pid) {
        trackedPIDs.add(proc.pid)
      } else {
        log.warn("spawned bash process has no pid and cannot be tracked for cleanup", {
          command: params.command,
          cwd,
        })
      }

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

      const publishMetadata = (outputSnapshot: string) => {
        try {
          ctx.metadata({
            metadata: {
              output: outputSnapshot,
              description: params.description,
              hang: hangMetadata(),
            },
          })
        } catch (error) {
          log.warn("bash metadata publish failed", {
            pid: proc.pid,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Initialize metadata with empty output
      publishMetadata("")

      // Once output has crossed the metadata-length cap, every subsequent
      // append() call would publish a byte-identical truncated snapshot
      // (the first MAX_METADATA_LENGTH bytes never change once we've seen
      // them). Skip those duplicate publishes to avoid flooding the bus
      // and the TUI on high-volume streams (e.g. `find /`).
      let lastPublishedLength = -1

      const append = (chunk: Buffer) => {
        const priorOutputBytes = outputBytes
        outputBytes += chunk.byteLength
        lastOutputAt = Date.now()
        if (priorOutputBytes < OUTPUT_HARD_CAP) {
          const remaining = OUTPUT_HARD_CAP - priorOutputBytes
          if (chunk.byteLength <= remaining) {
            const text = chunk.toString()
            output += text
          } else {
            let safeRemaining = remaining
            while (safeRemaining > 0 && (chunk[safeRemaining]! & 0xc0) === 0x80) safeRemaining--
            output += chunk.subarray(0, safeRemaining).toString() + "\n\n[output truncated at 10MB]"
            truncated = true
          }
        }
        const isPastCap = output.length >= MAX_METADATA_LENGTH
        if (isPastCap && lastPublishedLength >= MAX_METADATA_LENGTH) return
        publishMetadata(isPastCap ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output)
        lastPublishedLength = output.length
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
        void kill().catch((error) => {
          log.warn("bash abort kill failed", {
            error,
          })
        })
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill().catch((error) => {
          log.warn("bash timeout kill failed", {
            timeout,
            error,
          })
        })
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
          proc.stdout?.off("data", append)
          proc.stderr?.off("data", append)
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
          void kill().catch((error) => {
            log.warn("bash pre-aborted kill failed", {
              error,
            })
          })
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

      if (proc.exitCode === 0) {
        for (const filePath of redirectWritePaths) {
          if (Filesystem.contains(Instance.worktree, filePath)) {
            BlastRadius.recordWriteAndAssert(ctx.sessionID, filePath, await estimateFileLineDelta(filePath))
          }
        }
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
