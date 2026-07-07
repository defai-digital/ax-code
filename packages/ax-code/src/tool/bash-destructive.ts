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
 */

// Wrappers that execute their trailing argv. The classifier looks through
// these to the wrapped command. Leading flags on the wrapper are skipped;
// flag values are not tracked (e.g. `sudo -u root rm -rf /` classifies via
// the `rm` found after skipping `-u`... `root` breaks the scan — see
// findWrappedCommand), so a flag-with-value wrapper can slip a command
// past this scan. The generic bash permission still covers those.
const COMMAND_WRAPPERS: ReadonlySet<string> = new Set([
  "sudo",
  "doas",
  "command",
  "nohup",
  "time",
  "env",
  "xargs",
])

const SQL_CLIENTS: ReadonlySet<string> = new Set(["psql", "mysql", "mariadb", "sqlite3", "mongosh", "clickhouse-client"])

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
function findWrappedCommand(parts: string[]): { name: string; args: string[] } | undefined {
  let index = 0
  while (index < parts.length) {
    const part = parts[index]
    if (part === undefined) return undefined
    const name = baseCommandName(part)
    if (COMMAND_WRAPPERS.has(name)) {
      index += 1
      while (index < parts.length) {
        const candidate = parts[index]
        if (candidate === undefined) return undefined
        if (candidate.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate)) {
          index += 1
          continue
        }
        break
      }
      continue
    }
    return { name, args: parts.slice(index + 1) }
  }
  return undefined
}

function classifyGit(args: string[]): string | undefined {
  // Skip git global flags (and the values of the common value-taking ones)
  // to find the subcommand.
  let index = 0
  const valueFlags = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"])
  while (index < args.length) {
    const arg = args[index]
    if (arg === undefined) return undefined
    if (valueFlags.has(arg)) {
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
  const rest = args.slice(index + 1)
  if (!subcommand) return undefined

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
  if (subcommand === "branch" && (rest.includes("-D") || (hasLongFlag(rest, "--delete") && hasLongFlag(rest, "--force")))) {
    return "git branch -D force-deletes a branch"
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
  const resolved = findWrappedCommand(parts)
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
  }

  return undefined
}
