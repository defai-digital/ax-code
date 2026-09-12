import z from "zod"
import { spawn, type ChildProcess } from "child_process"
import { StringDecoder } from "node:string_decoder"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import DESCRIPTION_AX_ENGINE from "./bash-ax-engine.txt"
import { Log } from "../util/log"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
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
import { ToolBoolean, ToolNumber } from "./schema"
import { isLocalHostname } from "@/util/local-host"
import { uniqueStrings } from "@/util/string-list"

import { BashArity } from "@/permission/arity"
import { Permission } from "@/permission"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { Truncate } from "./truncate"
import { Plugin } from "@/plugin"
import { Isolation } from "@/isolation"
import { OsSandbox } from "@/isolation/os-sandbox"
import { BlastRadius } from "@/session/blast-radius"
import { assertSymlinkInsideProject } from "./external-directory"
import { classifyDestructiveCommand, findWrappedCommand, gitSubcommand } from "./bash-destructive"
import { BashNetworkHeuristics } from "./bash-network-heuristics"
import { denyDestructiveInOpsStrict } from "./bash-strict"
import { detectSandboxDenial } from "./bash-sandbox-escalation"
import { BackgroundShell } from "./bash-background"
import { signalBashProcessTree } from "./bash-process-cleanup"
import { normalizeToWorkspacePath, resolveToolFilePath } from "./file-path"
import { estimateAutonomousLineDelta } from "./file-content"
import {
  absolutePathLiterals,
  assertStaticRedirectTarget,
  expandLeadingTilde,
  decodeShellLiteral,
  hasDynamicRedirection,
  hasDynamicShellExpansion,
  isStaticPathArg,
  staticallyCheckablePathArgs,
  staticallyCreatedPathArgs,
  stripShellQuotes,
  truncateBashMetadata,
} from "./bash-helpers"
import { recordDestructiveApproval } from "./ops-shared"

import { BASH_MAX_METADATA_LENGTH as MAX_METADATA_LENGTH } from "@/constants/network"
const DEFAULT_TIMEOUT = Flag.AX_CODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

// Browser-launcher command names on macOS, Linux, Windows.
const BROWSER_OPEN_RE = /^(open|xdg-open|start|sensible-browser)\s+/

// Matches local HTML file paths. The negative lookahead prevents matching
// remote URLs that happen to end in .html (e.g. https://example.com/page.html).
const LOCAL_HTML_PATH_RE = /^(?!https?:\/\/).*\.html?(?:\s*$|#|\?)/i

// git config keys that can execute code when set: hook injection, arbitrary
// command wrappers, external protocol handlers, filter processes, pagers.
// These are stable git keys, so an explicit guard list is appropriate — mirrors
// Isolation.NETWORK_COMMANDS. Matching is case-insensitive (git normalizes key
// case before lookup).
const DANGEROUS_GIT_CONFIG_KEYS = [
  "core.hookspath",
  "core.fsmonitor",
  "core.sshcommand",
  "core.editor",
  "core.pager",
  "alias.",
  "include.path",
  "includeif.",
  "credential.helper",
  "protocol.",
  "extensions.",
  "filter.",
  "pager.",
  "diff.external",
  "gpg.program",
  "sequence.editor",
] as const

// Subsections contain caller-chosen names (including dotted URLs), so match
// the executable field at the end instead of blocking every setting in a family.
const DANGEROUS_GIT_CONFIG_PATTERNS = [
  /^core\.(?:askpass|gitproxy|alternaterefscommand)$/,
  /^interactive\.difffilter$/,
  /^imap\.tunnel$/,
  /^instaweb\.httpd$/,
  /^gpg\.ssh\.defaultkeycommand$/,
  /^credential\..+\.helper$/s,
  /^diff\..+\.(?:command|textconv)$/s,
  /^merge\..+\.driver$/s,
  /^(?:difftool|mergetool|browser|man)\..+\.(?:cmd|path)$/s,
  /^guitool\..+\.cmd$/s,
  /^trailer\..+\.(?:cmd|command)$/s,
  /^gpg\..+\.program$/s,
  /^remote\..+\.(?:uploadpack|receivepack|vcs)$/s,
  /^sendemail(?:\..+)?\.(?:cccmd|tocmd|headercmd|sendmailcmd)$/s,
] as const

const GIT_SENDMAIL_SERVER_KEY = /^sendemail(?:\..+)?\.smtpserver$/s
const GIT_SUBMODULE_UPDATE_KEY = /^submodule\..+\.update$/s

function isDangerousGitConfigKey(key: string, value?: string): boolean {
  if (
    DANGEROUS_GIT_CONFIG_KEYS.some((prefix) => key.startsWith(prefix)) ||
    DANGEROUS_GIT_CONFIG_PATTERNS.some((pattern) => pattern.test(key))
  )
    return true
  if (value === undefined) return false
  // These fields also accept ordinary hostnames or built-in update modes.
  if (GIT_SENDMAIL_SERVER_KEY.test(key)) {
    return (
      path.posix.isAbsolute(value) ||
      path.win32.isAbsolute(value) ||
      value.startsWith("~") ||
      hasDynamicShellExpansion(value)
    )
  }
  if (GIT_SUBMODULE_UPDATE_KEY.test(key)) return value.startsWith("!") || hasDynamicShellExpansion(value)
  return false
}

// Parse config options once so option values and tokens after -- never act
// as flags. Both legacy actions and the modern config subcommands are used.
function gitConfigInvocation(args: string[]): {
  key?: string
  value?: string
  file?: string
  isRead: boolean
  wholeFile: boolean
  unresolvedLocation: boolean
} {
  const readActions = new Set(["--get", "--get-regexp", "--get-all", "--get-urlmatch", "--list", "-l"])
  const subcommands = new Set(["get", "list", "set", "unset", "rename-section", "remove-section", "edit"])
  let action = subcommands.has(args[0]) ? args[0] : undefined
  let wholeFile = action === "rename-section" || action === "remove-section" || action === "edit"
  let file: string | undefined
  let unresolvedLocation = false
  let options = true
  const positional: string[] = []
  for (let i = action ? 1 : 0; i < args.length; i++) {
    const arg = args[i]
    if (options && arg === "--") {
      options = false
      continue
    }
    if (options && arg.startsWith("-")) {
      if (arg === "--local") continue
      if (["--global", "--system", "--worktree"].includes(arg)) unresolvedLocation = true
      if (["--rename-section", "--remove-section", "--edit", "-e"].includes(arg)) wholeFile = true
      if (arg === "--file" || arg === "-f") file = args[++i]
      else if (arg.startsWith("--file=")) file = arg.slice(7)
      else if (arg.startsWith("-f")) file = arg.slice(2)
      else if (["--type", "-t", "--default", "--value", "--comment"].includes(arg)) i++
      else if (readActions.has(arg)) action = "get"
      else if (
        [
          "--add",
          "--replace-all",
          "--unset",
          "--unset-all",
          "--rename-section",
          "--remove-section",
          "--edit",
          "-e",
        ].includes(arg)
      )
        action = "set"
      // Git accepts abbreviated long options. Unmodeled options cannot be
      // assumed unrelated to the destination (for example --glob or --fi).
      else unresolvedLocation = true
      continue
    }
    positional.push(arg)
  }
  return {
    key: positional[0]?.toLowerCase(),
    value: positional[1],
    file,
    wholeFile,
    unresolvedLocation,
    isRead: action === "get" || action === "list" || (!action && positional.length === 1),
  }
}

// git global flags that relocate where `git config` writes: `-C <dir>`
// chdirs before every other path is resolved (including relative --file
// targets and the implicit .git/config default), and `--git-dir <dir>` /
// `--git-dir=<dir>` replaces the .git directory so the implicit target
// becomes <dir>/config. Git requires the separate-argument form for -C and
// accepts both forms for --git-dir. Multiple -C values fold (each later one
// is interpreted relative to the previous, per git), so every -C value is
// collected in order and the caller resolves the chain; the last --git-dir
// wins. Pure command-text parsing — no path resolution happens here.
function gitConfigLocationFlags(args: string[]): { cdChain: string[]; gitDir?: string } {
  const cdChain: string[] = []
  let gitDir: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue
    if (arg === "-C") {
      const value = args[i + 1]
      if (value !== undefined) cdChain.push(value)
      i++
      continue
    }
    if (arg === "-c" || arg === "--work-tree" || arg === "--namespace") {
      i++
      continue
    }
    if (arg === "--git-dir") {
      gitDir = args[i + 1]
      i++
      continue
    }
    if (arg.startsWith("--git-dir=")) gitDir = arg.slice("--git-dir=".length)
  }
  return { cdChain, gitDir }
}

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

// Track child process roots so we can clean them up if the parent
// process exits through its synchronous exit handler. Without this,
// background commands can become orphans that keep running.
const trackedPIDs = new Set<number>()
const cleanupTimers = new Map<number, ReturnType<typeof setTimeout>>()

const forgetTrackedPID = (pid: number) => {
  trackedPIDs.delete(pid)
  const timer = cleanupTimers.get(pid)
  if (!timer) return
  clearTimeout(timer)
  cleanupTimers.delete(pid)
}

const cleanupDetachedProcess = (pid: number, hard = false) => {
  const signal = hard ? "SIGKILL" : "SIGTERM"
  const terminated = signalBashProcessTree(pid, signal)
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
export const BashTool = Tool.define("bash", async (initCtx) => {
  const config = await Config.get()
  const shell = Shell.acceptable(config.shell)
  log.info("bash tool using shell", { shell })
  const description = initCtx?.model?.providerID === AX_ENGINE_PROVIDER_ID ? DESCRIPTION_AX_ENGINE : DESCRIPTION

  // Named schema so async Tool.define init keeps z.infer<Parameters> (without
  // this, tsgo widens params to unknown under the initCtx callback form).
  const parameters = z.object({
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
    run_in_background: ToolBoolean.describe(
      "Set to true to run this command in the background. The call returns immediately with a shell ID; use the bash_output tool to read incremental output and kill_shell to terminate it. Use for long-running processes like dev servers, watchers, or slow builds. The timeout parameter is ignored for background commands.",
    ).optional(),
    description: z
      .string()
      .max(200)
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      )
      // Cosmetic only. Fall back to the command when a weaker tool-calling
      // model omits it.
      .optional(),
  })

  return {
    description: description
      .replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
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
            throw new Error(
              `Working directory does not exist: ${params.workdir}. ` +
                `Session working directory: ${Instance.directory}. Omit workdir or pass a path under it.`,
            )
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
      // Fail fast before permission prompts and before spawning: a shell
      // spawned past the capacity limit would leak.
      if (params.run_in_background) BackgroundShell.assertCapacity(ctx.sessionID)
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      // Admission and spawning must inspect the same plugin-adjusted environment.
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
      const gitRelocationEnvironment = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_CONFIG"].some(
        (name) => sanitizedEnv[name] !== undefined,
      )
      // Shell assignments and env wrappers may change Git's destination after
      // this snapshot. Preserve their semantics and require interactive admission.
      let shellEnvironmentChanges = tree.rootNode.descendantsOfType("variable_assignment").length > 0
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
      const decodeCommandParts = (parts: string[]) =>
        parts.map((part) => {
          const decoded = decodeShellLiteral(part)
          if (decoded === undefined) dynamicPathAccess = true
          return decoded ?? part
        })
      // Set when any scanned command wraps network-capable interpreted code
      // (python -c 'urllib…') or enters another network namespace (docker
      // run / nsenter): the per-command-name network check cannot see those,
      // so assertBashNetwork gets an explicit suspect flag instead.
      let networkWrapperSuspect = false
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

        // Wrapper/network heuristics: busybox dispatches to a named applet
        // (`busybox wget …` must be judged as `wget`), interpreter one-liners
        // and container/namespace invocations are network-suspect.
        const heuristics = BashNetworkHeuristics.inspect(name, args)
        if (heuristics.applet) commandNames.add(heuristics.applet)
        if (heuristics.inlineCodeNetworkSuspect || heuristics.sandboxEscapeSuspect) networkWrapperSuspect = true

        // cp/mv/install write to the LAST positional argument; tee writes to
        // every positional operand. Track those as write targets so the
        // autonomous blocked/protected-path check applies (`cp x .env`,
        // `install -m 600 x .git/config`, `tee secrets`), not just the
        // isolation workspace-boundary check. The remaining commands
        // (cd/rm/mkdir/touch/chmod/chown/cat) have no such single-dest shape.
        if (["cp", "mv", "install"].includes(name)) {
          let destResolved: string | undefined
          for (const arg of args) {
            if (arg.startsWith("-")) continue
            const resolved = await recordResolvedPath(arg)
            if (resolved) destResolved = resolved // last positional wins
          }
          if (destResolved) redirectWritePaths.add(destResolved)
          return
        }
        if (name === "tee") {
          for (const arg of args) {
            if (arg.startsWith("-")) continue
            const resolved = await recordResolvedPath(arg)
            if (resolved) redirectWritePaths.add(resolved)
          }
          return
        }
        if (["cd", "rm", "mkdir", "touch", "chmod", "chown", "cat"].includes(name)) {
          for (const arg of args) {
            if (arg.startsWith("-") || (name === "chmod" && arg.startsWith("+"))) continue
            await recordResolvedPath(arg)
          }
          return
        }

        if (["curl", "wget"].includes(name)) {
          let remoteName = false
          for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (!arg) continue
            // curl's -O is --remote-name and takes NO value: the download is
            // written to the URL basename in the cwd. Only wget's -O takes
            // an output path, so treat -O as value-taking for wget alone.
            const takesOutputValue =
              arg === "-o" || arg === "--output" || arg === "--output-document" || (name === "wget" && arg === "-O")
            if (takesOutputValue) {
              const next = args[i + 1]
              const output = next ? await recordResolvedPath(next) : undefined
              if (output) redirectWritePaths.add(output)
              i++
              continue
            }
            if (name === "curl" && (arg === "-O" || arg === "--remote-name")) {
              remoteName = true
              continue
            }
            const inline = arg.match(/^--(?:output|output-document)=(.+)$/)?.[1]
            if (inline) {
              const output = await recordResolvedPath(inline)
              if (output) redirectWritePaths.add(output)
            }
          }
          if (remoteName) {
            // Record the real download target <cwd>/<url basename> so the
            // blast-radius and autonomous line-budget checks see it. The URL
            // is the first arg with a scheme (falls back to the first
            // non-flag arg); query strings are not part of the file name.
            const url =
              args.find((a) => a && /^[a-z][a-z0-9+.-]*:\/\//i.test(a)) ?? args.find((a) => a && !a.startsWith("-"))
            const basename = url?.split("/").pop()?.split("?")[0]
            if (basename) {
              const output = await recordResolvedPath(basename)
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

        const gitConfigCall = name === "git" ? gitSubcommand(args) : undefined
        if (gitConfigCall?.subcommand === "config") {
          // git config writes to .git/config (or --file <path>) internally,
          // not via a shell redirect, so the implicit destination is surfaced
          // here. Dangerous keys (hook injection, arbitrary command wrappers,
          // protocol handlers) record the effective target — including the
          // implicit .git/config default — so protected-path and blast-radius
          // checks apply. Reads (--get/--list/...) are skipped entirely.
          // Every other non-read invocation still records the effective write
          // target: `git config --file=<outside> user.email x` and
          // `git -C <outside> config user.email x` are real writes outside the
          // git-owned default and must hit the same isolation and
          // external-directory checks as any redirect. The implicit
          // .git/config default stays unrecorded for benign keys when it is
          // workspace-internal and DEFAULT_PROTECTED — recording it would
          // turn ordinary `git config user.email x` into a false-positive
          // denial — but a `-C <dir>` / --git-dir relocation that pushes the
          // target outside the workspace is recorded and denied.
          // Use gitSubcommand (not args[0] === "config") so a leading git
          // global flag (`git -C dir config ...`, `git -c x=y config ...`)
          // doesn't let a dangerous write slip past this check — see
          // bash-destructive.ts.
          const rest = gitConfigCall.rest
          const config = gitConfigInvocation(rest)
          const isRead = config.isRead
          if (!isRead) {
            if (
              config.unresolvedLocation ||
              shellEnvironmentChanges ||
              (config.file === undefined && gitRelocationEnvironment)
            ) {
              dynamicPathAccess = true
              return
            }
            // -C chdirs before anything else resolves, so it is the base for
            // relative --file targets AND the implicit default; --git-dir
            // replaces the .git directory for the implicit default.
            const location = gitConfigLocationFlags(args.slice(0, args.length - rest.length - 1))
            const explicitFile = config.file
            const key = config.key
            // Section moves and editor invocations can change arbitrary keys.
            const dangerous = config.wholeFile || (key !== undefined && isDangerousGitConfigKey(key, config.value))
            // Keep the directory as raw input until the containment check;
            // append the implicit config filename only when resolving below.
            const target = stripShellQuotes(explicitFile ?? location.gitDir ?? ".git")
            const targetPath = expandLeadingTilde(target)
            // Validate every -C value before resolving: dynamic ($VAR, globs)
            // and ~user values cannot name a static base directory, so the
            // effective write target is unknowable — force the interactive
            // external-directory ask instead of guessing, mirroring the
            // generic arg scan's dynamicPathAccess handling.
            const cdParts: string[] = []
            let cdUnresolvable = false
            for (const raw of location.cdChain) {
              const part = expandLeadingTilde(stripShellQuotes(raw))
              if (part === undefined || hasDynamicShellExpansion(part)) {
                cdUnresolvable = true
                break
              }
              cdParts.push(part)
            }
            const unresolvable = targetPath === undefined || hasDynamicShellExpansion(target) || cdUnresolvable
            if (unresolvable) {
              dynamicPathAccess = true
            } else {
              // git folds each later -C relative to the previous one; resolve
              // the chain here so the effective base sits next to the
              // Instance.containsPath(absolute) below validates the resolved
              // target before any isolation or blast-radius recording.
              let base = cwd
              for (const part of cdParts) base = path.resolve(base, part)
              let lexical =
                explicitFile === undefined ? path.resolve(base, targetPath!, "config") : path.resolve(base, targetPath!)
              // Before Instance.containsPath(absolute), inspect read-only Git metadata.
              // A gitfile, absent .git directory, or commondir needs interactive
              // admission because this parser cannot prove Git's discovery result.
              if (explicitFile === undefined) {
                const gitDirectory = path.dirname(lexical)
                const directory = await fs.stat(gitDirectory).catch(() => undefined)
                if (!directory?.isDirectory() || (await Filesystem.exists(path.join(gitDirectory, "commondir")))) {
                  dynamicPathAccess = true
                  return
                }
                // Resolve the existing directory even when config is absent;
                // Instance.containsPath(absolute) must check where Git creates it.
                lexical = path.join(await fs.realpath(gitDirectory), "config")
              }
              // Resolve before the benign-key exception, including symlinked .git.
              const absolute = await fs.realpath(lexical).catch(() => lexical)
              if (explicitFile || dangerous || !Instance.containsPath(absolute)) {
                const resolved = await recordResolvedPath(absolute)
                if (resolved) redirectWritePaths.add(resolved)
              }
            }
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

        const normalizedCommand = decodeCommandParts(command)
        const destructiveReason = classifyDestructiveCommand(normalizedCommand)
        if (destructiveReason) destructiveCommands.set(commandText, destructiveReason)

        // Look through wrapper commands (sudo, env, nohup, xargs, ...) so a
        // wrapped `bash -c` / `eval` gets the same inner-string path,
        // redirect, and network scanning as an unwrapped invocation —
        // mirroring how classifyDestructiveCommand already sees through
        // wrappers via findWrappedCommand.
        const unwrappedCommand = findWrappedCommand(normalizedCommand)
        const wrapperParts = unwrappedCommand
          ? normalizedCommand.slice(0, normalizedCommand.length - unwrappedCommand.args.length - 1)
          : []
        const envWrapper = wrapperParts.findIndex((part) => path.basename(part) === "env")
        if (
          (envWrapper >= 0 && envWrapper < wrapperParts.length - 1) ||
          ["export", "unset", "source", "."].includes(normalizedCommand[0])
        ) {
          shellEnvironmentChanges = true
        }
        // Keep raw words for the shell's next parsing stage. Removing outer
        // quotes first loses whether backslashes and quote fragments are literal.
        const rawUnwrapped = findWrappedCommand(command)
        const rawScanParts = rawUnwrapped ? [rawUnwrapped.name, ...rawUnwrapped.args] : command
        const scanParts = unwrappedCommand ? [unwrappedCommand.name, ...unwrappedCommand.args] : normalizedCommand

        // Commands that wrap or delegate to other commands.
        // For shell invocations with -c, and eval, we parse the inner
        // command string to extract paths. For source/., we resolve
        // the script path. Arguments containing command substitution
        // ($(...), `...`, ${...}) are opaque — flag the whole command.
        if (["eval", "bash", "sh", "zsh", "source", "."].includes(scanParts[0])) {
          const isShellWithC = ["bash", "sh", "zsh"].includes(scanParts[0]) && scanParts.includes("-c")
          const isEval = scanParts[0] === "eval"

          // Collect the inner command string for eval / shell -c
          let innerCmd: string | undefined
          if (isShellWithC) {
            const cIdx = scanParts.indexOf("-c")
            if (cIdx >= 0 && cIdx + 1 < scanParts.length) {
              innerCmd = decodeShellLiteral(rawScanParts[cIdx + 1] ?? "")
              if (innerCmd === undefined) dynamicPathAccess = true
            }
          } else if (isEval) {
            // eval concatenates all its arguments into a single command
            const evalArgs = rawScanParts.slice(1).map(decodeShellLiteral)
            if (evalArgs.some((arg) => arg === undefined)) dynamicPathAccess = true
            else if (evalArgs.length > 0) innerCmd = evalArgs.join(" ")
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
              if (innerTree.rootNode.descendantsOfType("variable_assignment").length > 0) shellEnvironmentChanges = true
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
                const normalizedInnerParts = decodeCommandParts(innerParts)
                const innerDestructiveReason = classifyDestructiveCommand(normalizedInnerParts)
                if (innerDestructiveReason) destructiveCommands.set(innerNode.text, innerDestructiveReason)
                const innerCommand = findWrappedCommand(normalizedInnerParts)
                const innerWrappers = innerCommand
                  ? normalizedInnerParts.slice(0, normalizedInnerParts.length - innerCommand.args.length - 1)
                  : []
                const innerEnvWrapper = innerWrappers.findIndex((part) => path.basename(part) === "env")
                if (
                  (innerEnvWrapper >= 0 && innerEnvWrapper < innerWrappers.length - 1) ||
                  ["export", "unset", "source", "."].includes(normalizedInnerParts[0])
                ) {
                  shellEnvironmentChanges = true
                }
                await recordInnerCommandPaths(
                  innerCommand ? [innerCommand.name, ...innerCommand.args] : normalizedInnerParts,
                )
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
            for (const arg of scanParts.slice(1)) {
              if (arg.startsWith("-")) continue
              await recordResolvedPath(arg)
            }
          }
        } else {
          await recordInnerCommandPaths(scanParts)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(scanParts[0])) {
          for (const arg of scanParts.slice(1)) {
            if (arg.startsWith("-") || (scanParts[0] === "chmod" && arg.startsWith("+"))) continue
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
      // a structured message naming the missing path. A compound command may
      // create a path before reading it (`cat > prompt; ax-code "$(cat
      // prompt)"`), so record ordered, statically-known creation sites first.
      // This only suppresses the convenience preflight; normal shell errors,
      // isolation, permissions, and blast-radius checks still apply.
      const normalizeResolvedPath = (value: string) =>
        process.platform === "win32" ? Filesystem.windowsPath(value).replace(/\//g, "\\") : value
      const staticResolvedPath = (raw: string, base: string) => {
        const staticPath = isStaticPathArg(raw)
        if (!staticPath) return undefined
        return normalizeResolvedPath(path.resolve(base, staticPath))
      }

      // Track top-level `cd` commands so relative paths in a compound command
      // resolve against the directory in effect at that point (`cd sub && cat
      // file.txt`). Fail-open: a cd with anything other than exactly one
      // static path argument, or any cd inside a subshell / command
      // substitution, disables tracking entirely and every path resolves
      // against the base cwd (the previous behavior).
      const effectiveCwdAt = new Map<number, string>()
      {
        let effectiveCwd = cwd
        for (const node of tree.rootNode.descendantsOfType("command")) {
          if (!node) continue
          effectiveCwdAt.set(node.id, effectiveCwd)
          const parts: string[] = []
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (!child) continue
            if (["command_name", "word", "string", "raw_string", "concatenation"].includes(child.type)) {
              parts.push(child.text)
            }
          }
          if (parts.length === 0 || stripShellQuotes(parts[0]!) !== "cd") continue
          let nested = false
          for (let p = node.parent; p; p = p.parent) {
            if (p.type === "subshell" || p.type === "command_substitution") {
              nested = true
              break
            }
          }
          const target = parts.length === 2 && !parts[1]!.startsWith("-") ? isStaticPathArg(parts[1]!) : undefined
          if (nested || target === undefined) {
            effectiveCwdAt.clear()
            break
          }
          effectiveCwd = path.resolve(effectiveCwd, target)
        }
      }
      const cwdFor = (node: { id: number }) => effectiveCwdAt.get(node.id) ?? cwd

      const createdAt = new Map<string, number>()
      const recordCreation = (raw: string, position: number, base: string) => {
        const resolved = staticResolvedPath(raw, base)
        if (!resolved) return
        const previous = createdAt.get(resolved)
        if (previous === undefined || position < previous) createdAt.set(resolved, position)
      }
      for (const redirect of tree.rootNode.descendantsOfType("file_redirect")) {
        if (!redirect || !isWriteFileRedirect(redirect)) continue
        let base = cwd
        for (let p = redirect.parent; p; p = p.parent) {
          if (p.type === "command") {
            base = cwdFor(p)
            break
          }
        }
        for (let i = 0; i < redirect.childCount; i++) {
          const child = redirect.child(i)
          if (!child || !["word", "string", "raw_string", "concatenation"].includes(child.type)) continue
          const target = stripShellQuotes(child.text)
          if (!target || /^&/.test(target)) continue
          recordCreation(target, redirect.endIndex, base)
        }
      }
      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
        const parts: string[] = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (["command_name", "word", "string", "raw_string", "concatenation"].includes(child.type)) {
            parts.push(child.text)
          }
        }
        const cmd = parts[0] ? stripShellQuotes(parts[0]) : undefined
        if (!cmd) continue
        for (const arg of staticallyCreatedPathArgs(cmd, parts.slice(1))) {
          recordCreation(arg, node.endIndex, cwdFor(node))
        }
      }

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
          const resolved = staticResolvedPath(arg, cwdFor(node))
          if (!resolved) continue
          const creation = createdAt.get(resolved)
          if (creation !== undefined && creation < node.startIndex) continue
          const exists = await Filesystem.exists(resolved)
          if (!exists) missingPaths.push(resolved)
        }
      }
      if (missingPaths.length > 0) {
        const unique = uniqueStrings(missingPaths)
        throw new Error(
          `Path does not exist: ${unique.slice(0, 3).join(", ")}${unique.length > 3 ? ` (and ${unique.length - 3} more)` : ""}.\n` +
            `Hint: use the Glob or Read tool to discover available files before running commands against them.\n` +
            `Session working directory: ${Instance.directory}. Prefer paths under it; omit workdir to use it as the default.`,
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
      Isolation.assertBashNetwork(ctx.extra?.isolation, commandNames, { wrapperSuspect: networkWrapperSuspect })

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
        // Cloud-operations strict mode (PRD-2026-09-04 P2): when `ops.strict`
        // is enabled, the ask is replaced by a hard deny (enforceSafetyPolicy
        // style) that directs the model to the ops plan/apply workflow. The
        // flag is global config, so this also applies to subagent bash calls.
        if (config.ops?.strict === true) denyDestructiveInOpsStrict(destructiveCommands)

        await ctx.ask({
          permission: "bash_destructive",
          patterns: Array.from(destructiveCommands.keys()),
          always: [],
          metadata: {
            tool: "bash",
            reasons: Object.fromEntries(destructiveCommands),
          },
        })

        // Journal linkage (PRD sequencing item 3): record the approval next to
        // the active operation plan — or the unplanned-mutations sentinel when
        // no approved plan exists. Best-effort by contract: recordDestructive
        // Approval never throws, so a journaling failure can never block or
        // fail the command on this hot path.
        try {
          recordDestructiveApproval({
            projectID: Instance.project.id,
            sessionID: ctx.sessionID,
            commands: Array.from(destructiveCommands.keys()),
            reason: [...new Set(destructiveCommands.values())].join("; "),
          })
        } catch (error) {
          log.warn("failed to journal bash_destructive approval; continuing", { error: toErrorMessage(error) })
        }
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      // Background shells keep stdin open ("pipe") so bash_input can write
      // to them later. Trade-off: a background command that reads stdin to
      // EOF now blocks until bash_input sends input/EOF or the shell exits,
      // instead of getting immediate EOF at spawn. Foreground commands stay
      // on "ignore" — they are bounded and non-interactive by design.
      const stdinMode = params.run_in_background ? "pipe" : "ignore"
      // Sandbox-denial escalation ladder (PRD phase-2 R3). Attempt 0 runs
      // under the OS sandbox wrap; if the sandbox itself denies an operation
      // (detectSandboxDenial below), the user is asked once and the command
      // retries exactly once with the wrap relaxed. Background shells return
      // before any failure is observable, so they never reach the retry.
      for (let attempt = 0; ; attempt++) {
        // undefined on the escalated retry: spawn the command unsandboxed.
        const activeWrap = attempt === 0 ? osWrap : undefined
        let proc: ChildProcess
        try {
          proc =
            activeWrap?.active === true
              ? spawn(activeWrap.file, activeWrap.args, {
                  cwd,
                  env: {
                    ...sanitizedEnv,
                  },
                  stdio: [stdinMode, "pipe", "pipe"],
                  detached: process.platform !== "win32",
                  windowsHide: process.platform === "win32",
                })
              : useSetsidProcessGroup
                ? spawn("setsid", [shell, "-c", params.command], {
                    cwd,
                    env: {
                      ...sanitizedEnv,
                    },
                    stdio: [stdinMode, "pipe", "pipe"],
                    detached: false,
                    windowsHide: process.platform === "win32",
                  })
                : spawn(params.command, {
                    shell,
                    cwd,
                    env: {
                      ...sanitizedEnv,
                    },
                    stdio: [stdinMode, "pipe", "pipe"],
                    detached: process.platform !== "win32",
                    windowsHide: process.platform === "win32",
                  })
        } catch (error) {
          // A synchronous spawn throw (invalid arguments, resource limits)
          // never reaches the close/error listeners below — clean up the
          // seatbelt profile here or it leaks in os.tmpdir().
          OsSandbox.cleanupProfile(activeWrap?.active === true ? activeWrap.profilePath : undefined)
          throw error
        }
        const seatbeltProfile = activeWrap?.active === true ? activeWrap.profilePath : undefined
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

        if (params.run_in_background) {
          // Background shells outlive this tool call: no timeout timer, and the
          // turn's abort signal must not kill them. They stay in trackedPIDs so
          // process exit still reaps them; BackgroundShell forgets the PID on
          // its own exit via onExited.
          let info: ReturnType<typeof BackgroundShell.register>
          try {
            info = BackgroundShell.register({
              sessionID: ctx.sessionID,
              command: params.command,
              description,
              proc,
              onExited: () => {
                if (proc.pid) forgetTrackedPID(proc.pid)
              },
            })
          } catch (error) {
            // Capacity can fill while this call waited on its permission
            // prompt (the pre-spawn check passed earlier). An unregistered
            // process would be invisible to bash_output/kill_shell and run
            // until app exit — kill it before surfacing the error.
            void Shell.killTree(proc, { exited: () => proc.exitCode !== null })
              .then(() => {
                if (proc.pid) forgetTrackedPID(proc.pid)
              })
              .catch((killError) => {
                log.warn("failed to kill unregistered background shell", { pid: proc.pid, error: killError })
              })
            throw error
          }
          const msg =
            `Command running in background with shell ID: ${info.id}\n` +
            `Use the bash_output tool with shell_id "${info.id}" to read its output, and kill_shell to terminate it.`
          // Record cast: this branch's metadata carries a `background` key the
          // foreground branches lack, and the shared inferred metadata type
          // must accommodate both shapes.
          const backgroundMetadata: Record<string, any> = {
            output: msg,
            exit: null,
            description,
            background: { shellID: info.id, pid: proc.pid ?? null },
            truncated: false as const,
          }
          return {
            title: description,
            metadata: backgroundMetadata,
            output: msg,
          }
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
        // Coalesce live progress publishes so a high-volume stream (e.g.
        // `find /`) does not issue one DB write + bus broadcast per stdout
        // chunk. The final output is returned by the tool result (never via
        // publishMetadata), so a throttled snapshot is never lost.
        const METADATA_PUBLISH_INTERVAL_MS = 100
        let lastPublishedBytes = -1
        let lastPublishedAt = 0

        const stdoutDecoder = new StringDecoder("utf8")
        const stderrDecoder = new StringDecoder("utf8")
        const append = (chunk: Buffer, decoder: StringDecoder) => {
          const priorOutputBytes = outputBytes
          outputBytes += chunk.byteLength
          lastOutputAt = Date.now()
          if (priorOutputBytes < OUTPUT_HARD_CAP) {
            const remaining = OUTPUT_HARD_CAP - priorOutputBytes
            output += decoder.write(chunk.subarray(0, remaining))
          }
          if (outputBytes > OUTPUT_HARD_CAP && !truncated) {
            output += "\n\n[output truncated at 10MB]"
            truncated = true
          }
          const outputMetadataBytes = Buffer.byteLength(output, "utf8")
          const isPastCap = outputMetadataBytes > MAX_METADATA_LENGTH
          if (isPastCap && lastPublishedBytes > MAX_METADATA_LENGTH) return
          const now = Date.now()
          if (now - lastPublishedAt < METADATA_PUBLISH_INTERVAL_MS) return
          publishMetadata(isPastCap ? truncateBashMetadata(output, MAX_METADATA_LENGTH) : output)
          lastPublishedBytes = outputMetadataBytes
          lastPublishedAt = now
        }

        const appendStdout = (chunk: Buffer) => append(chunk, stdoutDecoder)
        const appendStderr = (chunk: Buffer) => append(chunk, stderrDecoder)
        proc.stdout?.on("data", appendStdout)
        proc.stderr?.on("data", appendStderr)

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
        }, timeout)

        let procExitCode: number | null = null

        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeoutTimer)
            ctx.abort.removeEventListener("abort", abortHandler)
            proc.stdout?.off("data", appendStdout)
            proc.stderr?.off("data", appendStderr)
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
            // Flush tails only when output was retained in full. A hard-cap
            // cutoff discards pending bytes instead of adding replacement text.
            if (!truncated) output += stdoutDecoder.end() + stderrDecoder.end()
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
              BlastRadius.recordWriteAndAssert(ctx.sessionID, filePath, await estimateAutonomousLineDelta(filePath))
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

        // Sandbox-denial escalation: only the first (wrapped) attempt can be
        // denied by the OS sandbox. On approval, retry once with the wrap
        // relaxed; on denial (including headless auto-deny of the
        // INTERACTIVE_ONLY isolation_escalation permission) fall through and
        // return the original failure unchanged.
        if (attempt === 0) {
          const denial = detectSandboxDenial({
            wrap: osWrap,
            isolation: ctx.extra?.isolation,
            exit: procExitCode ?? proc.exitCode,
            timedOut,
            aborted,
            output,
          })
          if (denial) {
            log.info("os sandbox denial detected; requesting escalation", {
              command: params.command,
              mechanism: denial.mechanism,
              evidence: denial.evidence,
            })
            try {
              await ctx.ask({
                permission: "isolation_escalation",
                patterns: [params.command],
                always: [],
                metadata: {
                  reason: "os_sandbox_denial",
                  mechanism: denial.mechanism,
                  evidence: denial.evidence,
                  requireInteractive: true,
                },
              })
              log.info("os sandbox escalation approved; retrying without OS sandbox", { command: params.command })
              continue
            } catch (error) {
              // CorrectedError (reject-with-feedback) and aborts propagate so
              // the model sees the feedback; plain rejections and ruleset
              // denials keep today's behavior — return the original failure.
              if (!(error instanceof Permission.RejectedError) && !(error instanceof Permission.DeniedError)) {
                throw error
              }
              log.info("os sandbox escalation denied; returning original failure", { command: params.command })
            }
          }
        }

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
      }
    },
  }
})
