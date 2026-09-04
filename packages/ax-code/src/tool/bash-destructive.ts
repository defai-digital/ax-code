import { parseShellArgs } from "@/util/shell-args"

/**
 * Deterministic classification of destructive shell commands (ADR-004
 * follow-up). Commands matched here always require interactive user
 * confirmation via the `bash_destructive` permission — which is listed in
 * Permission's INTERACTIVE_ONLY set, so neither wildcard allow rules nor
 * autonomous mode can auto-approve them. This is a code-level guarantee;
 * the prose warnings in bash.txt are guidance for the model, not a control.
 *
 * The list is deliberately tight: every entry is an operation that destroys
 * data or state in a way that is hard or impossible to undo (recursive
 * force-delete, history rewrite on a remote, disk-level writes, dropped
 * tables). Routine mutations (single-file rm, git commit, npm install)
 * stay on the normal bash permission path.
 *
 * Known limitation: classification is per parsed command argv. Commands
 * hidden behind unparseable constructs (command substitution, exotic
 * quoting) are not matched here — those already fall back to prompting for
 * the entire raw command in bash-impl.ts when tree-sitter finds no
 * command nodes.
 *
 * Cloud-mutating gates: aws/gcloud/az/kubectl/doctl/wrangler mutations,
 * terraform apply without a reviewed plan, ssh commit-without-confirm, and
 * curl write methods against cloud control-plane hosts also require the
 * interactive `bash_destructive` confirmation below.
 */

type WrapperSpec = {
  readonly valueFlags: ReadonlySet<string>
  readonly positionalArgs?: number
  readonly nonExecutingFlags?: ReadonlySet<string>
}

// Wrappers that execute their trailing argv. Value-taking flags must be
// consumed with their values: treating every option as a standalone flag
// lets an option value (for example, `root` in `sudo -u root rm`) hide the
// actual command from the destructive-operation classifier.
const COMMAND_WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map([
  [
    "sudo",
    {
      valueFlags: new Set([
        "-a",
        "-C",
        "-D",
        "-g",
        "-h",
        "-p",
        "-R",
        "-r",
        "-T",
        "-u",
        "-U",
        "--auth-type",
        "--chdir",
        "--close-from",
        "--command-timeout",
        "--group",
        "--host",
        "--other-user",
        "--prompt",
        "--role",
        "--chroot",
        "--type",
        "--user",
      ]),
    },
  ],
  ["doas", { valueFlags: new Set(["-C", "-u"]) }],
  ["command", { valueFlags: new Set(), nonExecutingFlags: new Set(["-v", "-V"]) }],
  ["nohup", { valueFlags: new Set() }],
  ["time", { valueFlags: new Set(["-f", "-o", "--format", "--output"]) }],
  ["env", { valueFlags: new Set(["-a", "-C", "-S", "-u", "--argv0", "--chdir", "--split-string", "--unset"]) }],
  [
    "xargs",
    {
      valueFlags: new Set([
        "-a",
        "-d",
        "-E",
        "-I",
        "-L",
        "-n",
        "-P",
        "-s",
        "--arg-file",
        "--delimiter",
        "--eof",
        "--max-args",
        "--max-chars",
        "--max-lines",
        "--max-procs",
        "--process-slot-var",
        "--replace",
      ]),
    },
  ],
  ["nice", { valueFlags: new Set(["-n", "--adjustment"]) }],
  ["timeout", { valueFlags: new Set(["-k", "-s", "--kill-after", "--signal"]), positionalArgs: 1 }],
  ["setsid", { valueFlags: new Set() }],
  ["stdbuf", { valueFlags: new Set(["-e", "-i", "-o", "--error", "--input", "--output"]) }],
  [
    "ionice",
    {
      valueFlags: new Set(["-c", "-n", "-p", "-P", "-u", "--class", "--classdata", "--pid", "--pgid", "--uid"]),
    },
  ],
])

const SQL_CLIENTS: ReadonlySet<string> = new Set([
  "psql",
  "mysql",
  "mariadb",
  "sqlite3",
  "mongosh",
  "clickhouse-client",
])

const SYSTEM_HALT_COMMANDS: ReadonlySet<string> = new Set(["shutdown", "reboot", "halt", "poweroff"])

const DESTRUCTIVE_SQL_PATTERN = /\bdrop\s+(table|database|schema|index)\b|\btruncate\s+(table\b|[a-z_])/i

function baseCommandName(raw: string): string {
  const stripped = raw.replace(/["']/g, "")
  const segments = stripped.split(/[\\/]/)
  return (segments[segments.length - 1] ?? stripped).toLowerCase()
}

function hasShortFlag(args: string[], flag: string): boolean {
  return args.some((arg) => /^-[a-zA-Z]+$/.test(arg) && arg.includes(flag))
}

function hasLongFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
}

function isRootishTarget(arg: string): boolean {
  const stripped = arg.replace(/["']/g, "")
  return stripped === "/" || stripped === "/*" || stripped === "~" || stripped === "~/" || stripped === "$HOME"
}

// Locates the first argv entry that is a real command, looking through
// wrapper commands (sudo, env, xargs, ...) and skipping wrapper flags and
// env assignments (VAR=value).
export function findWrappedCommand(parts: string[]): { name: string; args: string[] } | undefined {
  let commandParts = parts
  let index = 0
  while (index < commandParts.length) {
    const part = commandParts[index]
    if (part === undefined) return undefined
    const name = baseCommandName(part)
    if (name === "env") {
      const expanded = expandEnvSplitString(commandParts, index + 1)
      if (expanded) {
        commandParts = expanded
        continue
      }
    }
    const wrapper = COMMAND_WRAPPERS.get(name)
    if (wrapper) {
      index = skipWrapperArguments(commandParts, index + 1, wrapper)
      if (index < 0) return undefined
      continue
    }
    return { name, args: commandParts.slice(index + 1) }
  }
  return undefined
}

function expandEnvSplitString(parts: string[], start: number): string[] | undefined {
  const wrapper = COMMAND_WRAPPERS.get("env")!
  let index = start
  while (index < parts.length) {
    const candidate = parts[index]
    if (candidate === undefined || candidate === "--" || !candidate.startsWith("-") || candidate === "-") return

    let splitValue: string | undefined
    let consumed = 1
    if (candidate === "--split-string") {
      splitValue = parts[index + 1]
      consumed = 2
    } else if (candidate.startsWith("--split-string=")) {
      splitValue = candidate.slice("--split-string=".length)
    } else if (!candidate.startsWith("--")) {
      for (let offset = 1; offset < candidate.length; offset += 1) {
        const flag = `-${candidate[offset]}`
        if (flag === "-S") {
          splitValue = candidate.slice(offset + 1) || parts[index + 1]
          consumed = candidate.slice(offset + 1) ? 1 : 2
          break
        }
        // Once a value-taking option is found, the rest of this token belongs
        // to that option and cannot contain another flag.
        if (wrapper.valueFlags.has(flag)) break
      }
    }

    if (splitValue !== undefined) {
      const quote = splitValue[0]
      const unquoted =
        splitValue.length >= 2 && (quote === '"' || quote === "'") && splitValue.at(-1) === quote
          ? splitValue.slice(1, -1)
          : splitValue
      return [...parts.slice(0, index), ...parseShellArgs(unquoted), ...parts.slice(index + consumed)]
    }

    const option = parseWrapperOption(candidate, wrapper)
    index += option.consumesNext ? 2 : 1
  }
  return undefined
}

function skipWrapperArguments(parts: string[], start: number, wrapper: WrapperSpec): number {
  let index = start
  while (index < parts.length) {
    const candidate = parts[index]
    if (candidate === undefined) return -1
    if (candidate === "--") {
      index += 1
      break
    }
    if (!candidate.startsWith("-") || candidate === "-") break
    const option = parseWrapperOption(candidate, wrapper)
    if (option.nonExecuting) return -1
    index += 1
    if (option.consumesNext) index += 1
  }

  let positional = wrapper.positionalArgs ?? 0
  while (positional > 0 && index < parts.length) {
    index += 1
    positional -= 1
  }
  if (parts[index] === "--") index += 1

  while (index < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[index] ?? "")) index += 1
  return index
}

function parseWrapperOption(candidate: string, wrapper: WrapperSpec) {
  if (candidate.startsWith("--")) {
    const equals = candidate.indexOf("=")
    const flag = equals === -1 ? candidate : candidate.slice(0, equals)
    return {
      nonExecuting: wrapper.nonExecutingFlags?.has(flag) ?? false,
      consumesNext: equals === -1 && wrapper.valueFlags.has(flag),
    }
  }

  for (let index = 1; index < candidate.length; index += 1) {
    const flag = `-${candidate[index]}`
    if (wrapper.nonExecutingFlags?.has(flag)) return { nonExecuting: true, consumesNext: false }
    if (!wrapper.valueFlags.has(flag)) continue
    return { nonExecuting: false, consumesNext: index === candidate.length - 1 }
  }
  return { nonExecuting: false, consumesNext: false }
}

// git global flags that take a value (skipped along with their value when
// locating the subcommand), e.g. `-C <dir>`, `-c <key=value>`.
const GIT_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"])

/**
 * Skip git's own global flags (and the values of the common value-taking
 * ones) to find the subcommand and its remaining args. Shared by
 * `classifyGit` here and bash-impl.ts's `git config` write-target detection
 * so both agree on what the subcommand is for invocations like
 * `git -C dir config ...` or `git -c x=y config ...` — checking
 * `args[0] === "config"` directly would miss those and let a dangerous
 * `git config` write slip past the protected-path check.
 */
export function gitSubcommand(args: string[]): { subcommand: string; rest: string[] } | undefined {
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (arg === undefined) return undefined
    if (GIT_GLOBAL_VALUE_FLAGS.has(arg)) {
      index += 2
      continue
    }
    if (arg.startsWith("-")) {
      index += 1
      continue
    }
    break
  }
  const subcommand = args[index]?.toLowerCase()
  if (!subcommand) return undefined
  return { subcommand, rest: args.slice(index + 1) }
}

function classifyGit(args: string[]): string | undefined {
  const resolved = gitSubcommand(args)
  if (!resolved) return undefined
  const { subcommand, rest } = resolved
  if (subcommand === "push") {
    if (hasShortFlag(rest, "f") || hasLongFlag(rest, "--force") || hasLongFlag(rest, "--force-with-lease")) {
      return "git push --force rewrites remote history"
    }
    if (hasShortFlag(rest, "d") || hasLongFlag(rest, "--delete")) {
      return "git push --delete removes a remote branch"
    }
    if (rest.some((arg) => /^\+\S/.test(arg))) {
      return "git push with a +refspec force-updates the remote ref"
    }
    return undefined
  }
  if (subcommand === "reset" && hasLongFlag(rest, "--hard")) {
    return "git reset --hard discards uncommitted work"
  }
  if (subcommand === "clean" && (hasShortFlag(rest, "f") || hasLongFlag(rest, "--force"))) {
    return "git clean -f permanently deletes untracked files"
  }
  if (
    subcommand === "branch" &&
    (hasShortFlag(rest, "D") ||
      ((hasShortFlag(rest, "d") || hasLongFlag(rest, "--delete")) &&
        (hasShortFlag(rest, "f") || hasLongFlag(rest, "--force"))))
  ) {
    return "git branch -D force-deletes a branch"
  }
  return undefined
}

const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/

// Per-CLI global flags that consume the following argv token as their value.
// Used by skipValueFlagArgs so option values cannot be mistaken for
// subcommands or resource names (`gcloud --project prod compute instances
// delete vm` must still surface `delete`).
const AWS_VALUE_FLAGS: ReadonlySet<string> = new Set(["--profile", "--region", "--output", "--endpoint-url"])
const GCLOUD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--project",
  "--configuration",
  "--zone",
  "--region",
  "--account",
  "--format",
  "--filter",
  "--impersonate-service-account",
])
const AZ_VALUE_FLAGS: ReadonlySet<string> = new Set(["-o", "--output", "--query", "--subscription", "--resource-group"])
const KUBECTL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-n",
  "--namespace",
  "--context",
  "--kubeconfig",
  "--cluster",
  "--user",
])
const DOCTL_VALUE_FLAGS: ReadonlySet<string> = new Set(["-t", "--access-token", "--context", "--output"])
const WRANGLER_VALUE_FLAGS: ReadonlySet<string> = new Set(["-c", "--config", "--env", "--account-id"])
const TERRAFORM_APPLY_VALUE_FLAGS: ReadonlySet<string> = new Set(["-var", "-var-file", "-target", "-backup"])

// Returns the positional tokens of `args` with value-taking flags and their
// values consumed: `--flag value` and `--flag=value` are skipped, bare flags
// are skipped, everything else is collected in order.
function skipValueFlagArgs(args: string[], valueFlags: ReadonlySet<string>): string[] {
  const positional: string[] = []
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (arg === undefined) break
    if (arg.startsWith("-")) {
      const equals = arg.indexOf("=")
      const flag = equals === -1 ? arg : arg.slice(0, equals)
      index += equals === -1 && valueFlags.has(flag) ? 2 : 1
      continue
    }
    positional.push(arg)
    index += 1
  }
  return positional
}

function hasDeleteOrDestroyVerb(positionals: string[]): boolean {
  return positionals.some(
    (positional) => positional.toLowerCase() === "delete" || positional.toLowerCase() === "destroy",
  )
}

function classifyAws(args: string[]): string | undefined {
  // aws supports both spellings of the EC2 dry-run flag; a dry run changes
  // nothing, so it stays on the normal bash permission path.
  if (hasLongFlag(args, "--dry-run") || args.includes("--dryrun")) return undefined
  const positionals = skipValueFlagArgs(args, AWS_VALUE_FLAGS)
  const service = positionals[0]
  const verb = positionals[1]
  if (!service || !verb) return undefined
  if (/^(delete|terminate|remove)-/.test(verb)) {
    return `aws ${service} ${verb} deletes cloud resources`
  }
  if (service === "s3" && (verb === "rm" || verb === "rb")) {
    return `aws s3 ${verb} deletes objects or buckets`
  }
  return undefined
}

function classifyGcloudAzDoctl(args: string[], valueFlags: ReadonlySet<string>, cli: string): string | undefined {
  const positionals = skipValueFlagArgs(args, valueFlags)
  if (hasDeleteOrDestroyVerb(positionals)) return `${cli} delete/destroy removes cloud resources`
  return undefined
}

function classifyKubectl(args: string[]): string | undefined {
  const positionals = skipValueFlagArgs(args, KUBECTL_VALUE_FLAGS)
  const operation = positionals[0]
  if (operation === "delete") {
    if (hasLongFlag(args, "--dry-run")) return undefined
    return "kubectl delete removes cluster objects"
  }
  if (operation === "apply" && hasLongFlag(args, "--prune")) {
    return "kubectl apply --prune deletes objects not in the manifest"
  }
  return undefined
}

function classifyWrangler(args: string[]): string | undefined {
  const positionals = skipValueFlagArgs(args, WRANGLER_VALUE_FLAGS)
  if (positionals.some((positional) => positional === "delete" || positional === "rollback")) {
    return "wrangler delete/rollback removes or reverts deployed resources"
  }
  return undefined
}

const SSH_COMMIT_PATTERN = /\bcommit\b/i
const SSH_COMMIT_EXCLUSIONS = [/\bconfirmed\b/i, /\bcommit\s+check\b/i, /\bgit\s+commit\b/i]

function classifySsh(args: string[]): string | undefined {
  // Choice: rather than modeling ssh's option grammar, we check the LAST
  // non-flag argv token as the remote command string. Flag values (e.g. the
  // `22` in `-p 22`) are ignored because they precede the remote command;
  // remote commands with their own flags (`commit check`) are usually a
  // single quoted argv token, and the exclusions still catch the rest.
  const remoteCommand = [...args].reverse().find((arg) => !arg.startsWith("-"))
  if (!remoteCommand) return undefined
  if (!SSH_COMMIT_PATTERN.test(remoteCommand)) return undefined
  if (SSH_COMMIT_EXCLUSIONS.some((pattern) => pattern.test(remoteCommand))) return undefined
  return "ssh running a remote device 'commit' without commit-confirm"
}

const CURL_DATA_FLAGS: ReadonlySet<string> = new Set(["-d", "--data", "-F", "--form", "-T", "--upload-file"])
const CURL_MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "DELETE", "PATCH"])
// Hosts of cloud control planes (plus instance-metadata endpoints). The
// trailing `$` keeps the match on hostnames only: an IP literal such as
// 169.254.169.254 never matches, so metadata-token fetches against a
// link-local address stay on the normal bash path.
const CURL_CLOUD_HOST_PATTERN =
  /(amazonaws\.com|googleapis\.com|management\.azure\.com|azure\.com|api\.digitalocean\.com|api\.cloudflare\.com|cloudflare\.com|api\.ovh\.com|runpod\.ai|metadata\.google\.internal)$/i

function classifyCurl(args: string[]): string | undefined {
  let method: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) break
    if (arg === "-X" || arg === "--request") {
      method = args[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith("-X") && arg.length > 2) {
      method = arg.slice(2)
      continue
    }
    if (arg.startsWith("--request=")) {
      method = arg.slice("--request=".length)
    }
  }
  if (!method) {
    // No explicit method: curl implies POST when a data/upload body flag is
    // present (including `--data=...` spellings), GET otherwise.
    const hasBody = args.some((arg) => {
      const equals = arg.indexOf("=")
      const flag = equals === -1 ? arg : arg.slice(0, equals)
      return CURL_DATA_FLAGS.has(flag)
    })
    method = hasBody ? "POST" : "GET"
  }
  const methodName = method.toUpperCase()
  if (!CURL_MUTATING_METHODS.has(methodName)) return undefined
  const url = [...args].reverse().find((arg) => /^https?:\/\//i.test(arg))
  if (!url) return undefined
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return undefined
  }
  if (CURL_CLOUD_HOST_PATTERN.test(host)) {
    return `curl ${methodName} against a cloud control-plane host mutates remote resources`
  }
  return undefined
}

/**
 * Returns a human-readable reason when the parsed command argv is
 * destructive, or undefined when it is not. `parts` is the argv of a single
 * parsed command (command name first), with shell quotes already stripped
 * or preserved — quotes are ignored for matching.
 */
export function classifyDestructiveCommand(parts: string[]): string | undefined {
  // Leading environment assignments (`AWS_PROFILE=prod aws ...`) are not the
  // command itself; skip them before wrapper resolution. (tree-sitter
  // usually drops these as variable_assignment nodes upstream, but direct
  // callers pass them through.)
  let assignmentIndex = 0
  while (assignmentIndex < parts.length && ENV_ASSIGNMENT_PATTERN.test(parts[assignmentIndex] ?? "")) {
    assignmentIndex += 1
  }
  const resolved = findWrappedCommand(parts.slice(assignmentIndex))
  if (!resolved) return undefined
  const { name, args } = resolved

  if (name === "rm") {
    const recursive = hasShortFlag(args, "r") || hasShortFlag(args, "R") || hasLongFlag(args, "--recursive")
    const force = hasShortFlag(args, "f") || hasLongFlag(args, "--force")
    if (recursive && force) return "rm with recursive+force deletes trees without confirmation"
    if (recursive && args.some(isRootishTarget)) return "recursive rm targeting the filesystem root or home"
    return undefined
  }

  if (name === "git") return classifyGit(args)

  if (name.startsWith("mkfs")) return "mkfs formats a filesystem"
  if (name === "shred" || name === "wipefs") return `${name} irrecoverably destroys data`
  if (name === "dd" && args.some((arg) => /^of=\/dev\//.test(arg.replace(/["']/g, "")))) {
    return "dd writing directly to a block device"
  }
  if (SYSTEM_HALT_COMMANDS.has(name)) return `${name} halts or restarts the machine`

  if (SQL_CLIENTS.has(name) && args.some((arg) => DESTRUCTIVE_SQL_PATTERN.test(arg))) {
    return "database client executing DROP/TRUNCATE"
  }

  if (name === "terraform") {
    const subcommand = args.find((arg) => !arg.startsWith("-"))?.toLowerCase()
    if (subcommand === "destroy") return "terraform destroy tears down infrastructure"
    if (subcommand === "apply" && hasLongFlag(args, "-auto-approve")) {
      return "terraform apply -auto-approve changes infrastructure without review"
    }
    if (subcommand === "apply") {
      // `-out` only writes a plan file; `apply <plan.tfplan>` applies a
      // previously reviewed plan. Bare `terraform apply` (optionally with
      // -var/-target overrides) changes infrastructure without one.
      if (hasLongFlag(args, "-out")) return undefined
      const subcommandIndex = args.findIndex((arg) => !arg.startsWith("-"))
      const positionals = skipValueFlagArgs(args.slice(subcommandIndex + 1), TERRAFORM_APPLY_VALUE_FLAGS)
      if (positionals.length === 0) {
        return "terraform apply without an explicit plan file changes infrastructure without a reviewed plan"
      }
    }
  }

  if (name === "aws") return classifyAws(args)
  if (name === "gcloud") return classifyGcloudAzDoctl(args, GCLOUD_VALUE_FLAGS, "gcloud")
  if (name === "az") return classifyGcloudAzDoctl(args, AZ_VALUE_FLAGS, "az")
  if (name === "doctl") return classifyGcloudAzDoctl(args, DOCTL_VALUE_FLAGS, "doctl")
  if (name === "kubectl") return classifyKubectl(args)
  if (name === "wrangler") return classifyWrangler(args)
  if (name === "ssh") return classifySsh(args)
  if (name === "curl") return classifyCurl(args)

  return undefined
}
