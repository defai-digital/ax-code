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
import { toErrorMessage } from "@/util/error-message"
import { TOAST_DURATION_LONG_MS } from "@/constants/server"
import { createRequire } from "module"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"
import { ToolNumber } from "./schema"
import { isLocalHostname } from "@/util/local-host"
import { uniqueStrings } from "@/util/string-list"

import { BashArity } from "@/permission/arity"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { Truncate } from "./truncate"
import { Plugin } from "@/plugin"
import { Isolation } from "@/isolation"
import { OsSandbox } from "@/isolation/os-sandbox"
import { BlastRadius } from "@/session/blast-radius"
import { assertSymlinkInsideProject } from "./external-directory"
import { classifyDestructiveCommand } from "./bash-destructive"
import { normalizeToWorkspacePath, resolveToolFilePath } from "./file-path"
import {
  absolutePathLiterals,
  assertStaticRedirectTarget,
  expandLeadingTilde,
  hasDynamicRedirection,
  hasDynamicShellExpansion,
  isStaticPathArg,
  safeUtf8PrefixLength,
  staticallyCheckablePathArgs,
  stripShellQuotes,
  truncateBashMetadata,
} from "./bash-helpers"

import { BASH_MAX_METADATA_LENGTH as MAX_METADATA_LENGTH } from "@/constants/network"
const DEFAULT_TIMEOUT = Flag.AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

// Browser-launcher command names on macOS, Linux, Windows.
const BROWSER_OPEN_RE = /^(open|xdg-open|start|sensible-browser)\s+/

// Matches local HTML file paths. The negative lookahead prevents matching
// remote URLs that happen to end in .html (e.g. https://example.com/page.html).
const LOCAL_HTML_PATH_RE = /^(?!https?:\/\/).*\.html?(?:\s*$|#|\?)/i

// Patterns that identify intentional (non-development) browser opens.
// These are allowed through even when targeting localhost/local files.
const BROWSER_INTENT_PASSTHROUGH_RE = /(?:callback|oauth|auth|token|dre-graph|mcp)/i
const BROWSER_OPEN_ARG_RE = /"[^"]*"|'[^']*'|[^\s]+/g
const WRITE_REDIRECT_OPERATORS = new Set([">", ">>", ">|", "&>", "&>>", "<>"])

/**
 * Returns the target argument if the command is a browser-open call targeting
 * a local HTML file or localhost URL that should be intercepted. Returns null
 * for OAuth flows, DRE graph, MCP auth, or non-local targets.
 */
function isBrowserOpenToLocal(command: string): string | null {
  const normalized = command.trimStart()
  if (!BROWSER_OPEN_RE.test(normalized)) return null
  const args = normalized.replace(BROWSER_OPEN_RE, "").trim().match(BROWSER_OPEN_ARG_RE) ?? []
  const target = stripShellQuotes(args[args.length - 1] ?? "")
  if (!LOCAL_HTML_PATH_RE.test(target) && !isLocalBrowserUrl(target)) return null
  if (BROWSER_INTENT_PASSTHROUGH_RE.test(target)) return null
  return target
}

function isLocalBrowserUrl(target: string) {
  try {
    const url = new URL(stripShellQuotes(target))
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    return isLocalHostname(url.hostname)
  } catch {
    return false
  }
}

function isWriteFileRedirect(redirect: { childCount: number; child(index: number): { type: string } | null }) {
  for (let i = 0; i < redirect.childCount; i++) {
    const child = redirect.child(i)
    if (child && WRITE_REDIRECT_OPERATORS.has(child.type)) return true
  }
  return false
}

const log = Log.create({ service: "bash-tool" })
const CLEANUP_KILL_TIMEOUT_MS = 250
const isBunRuntime = Boolean((process.versions as Record<string, string | undefined>).bun)
const useSetsidProcessGroup = process.platform === "linux" && isBunRuntime

async function estimateFileLineDelta(filePath: string) {
  const stat = await fs.stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (Filesystem.isMissingPathError(error)) return undefined
    throw error
  })
  if (!stat?.isFile()) return 1
  return Math.max(1, Math.ceil(stat.size / 80))
}

// Track child process groups so we can clean them up if the parent
// process exits unexpectedly (crash, SIGKILL, etc.). Without this,
// background commands can become orphans that keep running.
const trackedPIDs = new Set<number>()
const cleanupTimers = new Map<number, ReturnType<typeof setTimeout>>()

const isPidError = (error: unknown): error is { code: string } => {
  return error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
}

const killProcessGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if (isPidError(error) && error.code === "ESRCH") {
      return false
    }
    log.warn("bash process group kill failed", { pid, signal, errorCode: isPidError(error) ? error.code : "unknown" })
  }

  try {
    process.kill(pid, signal)
    return true
  } catch (error) {
    if (isPidError(error) && error.code === "ESRCH") {
      return false
    }
    log.warn("bash process kill failed", { pid, signal, errorCode: isPidError(error) ? error.code : "unknown" })
  }

  return false
}

const forgetTrackedPID = (pid: number) => {
  trackedPIDs.delete(pid)
  const timer = cleanupTimers.get(pid)
  if (!timer) return
  clearTimeout(timer)
  cleanupTimers.delete(pid)
}

const cleanupDetachedProcess = (pid: number, hard = false) => {
  const signal = hard ? "SIGKILL" : "SIGTERM"
  const terminated = killProcessGroup(pid, signal)
  if (!terminated) {
    forgetTrackedPID(pid)
    return
  }
  if (hard) {
    forgetTrackedPID(pid)
    return
  }
  const timer = setTimeout(() => {
    cleanupDetachedProcess(pid, true)
  }, CLEANUP_KILL_TIMEOUT_MS)
  cleanupTimers.set(pid, timer)
}

const cleanupDetachedProcesses = (hard = false) => {
  for (const pid of trackedPIDs) {
    cleanupDetachedProcess(pid, hard)
  }
}

process.once("exit", () => {
  cleanupDetachedProcesses(true)
  for (const timer of cleanupTimers.values()) clearTimeout(timer)
  cleanupTimers.clear()
})

// Resolve the tree-sitter .wasm FILE PATHS rather than `import(...wasm)`. Bun's
// wasm import returned the path, but Node instantiates the module (its `env`
// import then fails: "Cannot find package 'env'"). createRequire.resolve gives
// the path under both runtimes and both layouts: from source (web-tree-sitter /
// tree-sitter-bash in node_modules) and the built bundle (shipped beside it via
// build-node-tui's distDeps). web-tree-sitter loads the bytes itself.
const requireWasm = createRequire(import.meta.url)

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const treePath = requireWasm.resolve("web-tree-sitter/tree-sitter.wasm")
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const bashPath = requireWasm.resolve("tree-sitter-bash/tree-sitter-bash.wasm")
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const config = await Config.get()
  const shell = Shell.acceptable(config.shell)
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: ToolNumber(z.number().min(1).max(600_000))
        .describe("Optional timeout in milliseconds (max 600000)")
        .optional(),
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
        )
        // Cosmetic only. Fall back to the command when a weaker tool-calling
        // model omits it.
        .optional(),
    }),
    async execute(params, ctx) {
      const description = params.description ?? params.command.slice(0, 80)
      if (params.workdir !== undefined) {
        resolveToolFilePath(params.workdir, Instance.directory)
      }
      if (params.command.includes("\x00")) throw new Error("Command contains null byte")
      if (hasDynamicRedirection(params.command)) throw new Error("Dynamic redirection targets are not allowed")

      const browserOpenIntercept = isBrowserOpenToLocal(params.command)
      if (browserOpenIntercept && (await Config.get()).browser?.interceptOpen !== false) {
        log.info("browser open intercepted", {
          toolName: "bash",
          command: params.command,
          status: "intercepted",
          durationMs: 0,
        })
        Bus.publishDetached(NotificationEvent.ToastShow, {
          title: "Browser preview ready",
          message: `${browserOpenIntercept} — open manually when ready`,
          variant: "info",
          duration: TOAST_DURATION_LONG_MS,
        })
        const msg = `[Browser open intercepted] Preview is ready at: ${browserOpenIntercept}\n\nThe browser was not opened automatically to avoid disrupting your active development session. Open it manually when ready, or ask to open it explicitly.`
        return {
          title: description,
          metadata: {
            output: msg,
            exit: 0,
            description,
            hang: {
              processId: null,
              signal: null,
              timeoutMs: 0,
              timedOut: false,
              aborted: false,
              outputBytes: Buffer.byteLength(msg),
              outputTruncated: false,
              lastOutputAt: null,
              killStartedAt: null,
              killCompletedAt: null,
              killDurationMs: null,
            },
            truncated: false as const,
          },
          output: msg,
        }
      }
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
      const commandNames = new Set<string>()
      const redirectWritePaths = new Set<string>()
      const patterns = new Set<string>()
      const always = new Set<string>()
      // commandText → reason. Populated for both top-level commands and
      // commands nested inside eval / shell -c strings; drives the
      // interactive-only bash_destructive ask below.
      const destructiveCommands = new Map<string, string>()
      let dynamicPathAccess = false
      let foundCommands = false

      const recordResolvedPath = async (raw: string) => {
        const arg = stripShellQuotes(raw)
        if (!arg) return
        if (hasDynamicShellExpansion(arg)) {
          dynamicPathAccess = true
          return
        }
        const literal = expandLeadingTilde(arg)
        if (!literal) {
          dynamicPathAccess = true
          return
        }
        const resolved = await fs.realpath(path.resolve(cwd, literal)).catch(() => path.resolve(cwd, literal))
        const normalized =
          process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
        resolvedPaths.add(normalized)
        if (!Instance.containsPath(normalized)) {
          const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
          directories.add(dir)
        }
        return normalized
      }

      const recordInnerCommandPaths = async (parts: string[]) => {
        const name = parts[0]
        if (!name) return
        commandNames.add(name)
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
            if (arg === "-o" || arg === "-O" || arg === "--output" || arg === "--output-document") {
              const next = args[i + 1]
              const output = next ? await recordResolvedPath(next) : undefined
              if (output) redirectWritePaths.add(output)
              i++
              continue
            }
            const inline = arg.match(/^--(?:output|output-document)=(.+)$/)?.[1]
            if (inline) {
              const output = await recordResolvedPath(inline)
              if (output) redirectWritePaths.add(output)
            }
          }
          return
        }

        if (name === "dd") {
          for (const arg of args) {
            const output = arg.match(/^of=(.+)$/)?.[1]
            if (output) {
              const resolved = await recordResolvedPath(output)
              if (resolved) redirectWritePaths.add(resolved)
            }
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
          if (!unquoted) continue
          if (hasDynamicShellExpansion(unquoted) || unquoted.startsWith("~")) {
            dynamicPathAccess = true
            continue
          }
          if (path.isAbsolute(unquoted)) {
            await recordResolvedPath(unquoted)
            continue
          }
          // Relative args that traverse out of the workspace (e.g.
          // `../../etc/passwd`) are potential escape targets even for
          // commands we don't model explicitly. Without this, a write via an
          // unrecognized command (`sed -i ... ../../outside`) slips past the
          // workspace boundary. We only record args that actually resolve
          // outside the workspace so harmless in-workspace barewords (sed
          // expressions, grep patterns, subcommands) aren't flagged.
          if (unquoted.includes("..") && !Instance.containsPath(path.resolve(cwd, unquoted))) {
            await recordResolvedPath(unquoted)
          }
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

        const destructiveReason = classifyDestructiveCommand(command.map(stripShellQuotes))
        if (destructiveReason) destructiveCommands.set(commandText, destructiveReason)

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
                const innerDestructiveReason = classifyDestructiveCommand(innerParts.map(stripShellQuotes))
                if (innerDestructiveReason) destructiveCommands.set(innerNode.text, innerDestructiveReason)
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
                  const resolved = await recordResolvedPath(target)
                  if (resolved && isWriteFileRedirect(innerRedirect)) redirectWritePaths.add(resolved)
                }
              }
            }
          }

          // For source/. (not eval or shell -c), resolve args as file paths
          if (!isShellWithC && !isEval) {
            for (const arg of command.slice(1)) {
              if (arg.startsWith("-")) continue
              await recordResolvedPath(arg)
            }
          }
        } else {
          await recordInnerCommandPaths(command)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            await recordResolvedPath(arg)
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

      // Redirection targets must be sandboxed: in workspace-write mode the
      // model could otherwise read/write arbitrary files outside the workspace
      // through redirect syntax that the per-command path scan ignored. Only
      // write redirects are counted against autonomous blast-radius caps.
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
          const literal = expandLeadingTilde(target)
          if (!literal) throw new Error("Dynamic redirection targets are not allowed")
          const resolved = await fs.realpath(path.resolve(cwd, literal)).catch(() => path.resolve(cwd, literal))
          if (!resolved) continue
          const normalized =
            process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
          resolvedPaths.add(normalized)
          if (isWriteFileRedirect(redirect)) redirectWritePaths.add(normalized)
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
        const unique = uniqueStrings(missingPaths)
        throw new Error(
          `Path does not exist: ${unique.slice(0, 3).join(", ")}${unique.length > 3 ? ` (and ${unique.length - 3} more)` : ""}.\n` +
            `Hint: use the Glob or Read tool to discover available files before running commands against them.`,
        )
      }

      if (dynamicPathAccess) {
        await ctx.ask({
          permission: "external_directory",
          patterns: [params.command],
          always: [],
          metadata: {
            reason: "dynamic shell path",
            requireInteractive: true,
          },
        })
      }

      Isolation.assertBash(ctx.extra?.isolation, cwd, Instance.directory, Instance.worktree, [...resolvedPaths])
      Isolation.assertBashNetwork(ctx.extra?.isolation, commandNames)

      // OS sandbox wrap for bash (Seatbelt / bubblewrap). App-layer checks
      // above always run; the default `auto` backend adds kernel enforcement
      // whenever the platform supports it.
      let osWrap: OsSandbox.WrapResult | undefined
      if (Isolation.shouldUseOsSandbox(ctx.extra?.isolation)) {
        const state = ctx.extra!.isolation!
        osWrap = OsSandbox.wrapCommand({
          command: params.command,
          shell,
          cwd,
          workspaceRoot: Instance.directory,
          worktree: Instance.worktree,
          network: state.network,
          protectedPaths: state.protected,
        })
        if (!osWrap.active && state.backend === "os") {
          throw new Isolation.DeniedError(
            "bash",
            `OS isolation backend is required but unavailable: ${osWrap.reason}. ` +
              `Set isolation.backend to "app" or "auto", or install platform sandbox tools.`,
          )
        }
        if (!osWrap.active) {
          log.info("os sandbox unavailable; using app-layer isolation only", { reason: osWrap.reason })
        }
      }

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

      // Destructive commands always require interactive confirmation:
      // `bash_destructive` is in the permission layer's INTERACTIVE_ONLY set,
      // so neither wildcard allow rules nor autonomous auto-approval can skip
      // this ask. No `always` patterns are offered — approval is per call.
      if (destructiveCommands.size > 0) {
        await ctx.ask({
          permission: "bash_destructive",
          patterns: Array.from(destructiveCommands.keys()),
          always: [],
          metadata: {
            tool: "bash",
            reasons: Object.fromEntries(destructiveCommands),
          },
        })
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
      const proc =
        osWrap?.active === true
          ? spawn(osWrap.file, osWrap.args, {
              cwd,
              env: {
                ...sanitizedEnv,
              },
              stdio: ["ignore", "pipe", "pipe"],
              detached: process.platform !== "win32",
              windowsHide: process.platform === "win32",
            })
          : useSetsidProcessGroup
            ? spawn("setsid", [shell, "-c", params.command], {
                cwd,
                env: {
                  ...sanitizedEnv,
                },
                stdio: ["ignore", "pipe", "pipe"],
                detached: false,
                windowsHide: process.platform === "win32",
              })
            : spawn(params.command, {
                shell,
                cwd,
                env: {
                  ...sanitizedEnv,
                },
                stdio: ["ignore", "pipe", "pipe"],
                detached: process.platform !== "win32",
                windowsHide: process.platform === "win32",
              })
      const seatbeltProfile = osWrap?.active === true ? osWrap.profilePath : undefined
      const cleanupSeatbelt = () => OsSandbox.cleanupProfile(seatbeltProfile)
      if (proc.pid) {
        trackedPIDs.add(proc.pid)
      } else {
        log.warn("spawned bash process has no pid and cannot be tracked for cleanup", {
          command: params.command,
          cwd,
        })
        cleanupSeatbelt()
      }
      proc.on("close", cleanupSeatbelt)
      proc.on("error", cleanupSeatbelt)

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
              description,
              hang: hangMetadata(),
            },
          })
        } catch (error) {
          log.warn("bash metadata publish failed", {
            pid: proc.pid,
            error: toErrorMessage(error),
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
      let lastPublishedBytes = -1

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
            const safeRemaining = safeUtf8PrefixLength(chunk, remaining)
            output += chunk.subarray(0, safeRemaining).toString() + "\n\n[output truncated at 10MB]"
            truncated = true
          }
        }
        const outputMetadataBytes = Buffer.byteLength(output, "utf8")
        const isPastCap = outputMetadataBytes > MAX_METADATA_LENGTH
        if (isPastCap && lastPublishedBytes > MAX_METADATA_LENGTH) return
        publishMetadata(isPastCap ? truncateBashMetadata(output, MAX_METADATA_LENGTH) : output)
        lastPublishedBytes = outputMetadataBytes
      }

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

      let procExitCode: number | null = null

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
          proc.stdout?.off("data", append)
          proc.stderr?.off("data", append)
          if (proc.pid) forgetTrackedPID(proc.pid)
        }

        proc.once("exit", () => {
          exited = true
          procExitCode = proc.exitCode
          // Background processes spawned by the command (e.g. `cmd &`) inherit
          // the pipe FDs and keep them open, so the 'close' event never fires.
          // Destroy the streams after one I/O cycle — giving Node.js a chance
          // to drain any data already in the kernel buffer — then 'close' fires
          // regardless of what background processes are still running.
          setImmediate(() => {
            proc.stdout?.destroy()
            proc.stderr?.destroy()
          })
        })

        proc.once("close", () => {
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

      const truncateResult = await Truncate.output(output)
      const truncateMeta = truncateResult.truncated
        ? {
            truncated: true as const,
            outputPath: truncateResult.outputPath,
            fullOutputPath: truncateResult.fullOutputPath,
            originalSize: truncateResult.originalSize,
            truncatedTo: truncateResult.truncatedTo,
            contentHint: truncateResult.contentHint,
          }
        : { truncated: false as const }

      return {
        title: description,
        metadata: {
          output: truncateBashMetadata(output, MAX_METADATA_LENGTH),
          exit: procExitCode ?? proc.exitCode,
          description,
          hang: hangMetadata(),
          ...truncateMeta,
        },
        output: truncateResult.content,
      }
    },
  }
})
