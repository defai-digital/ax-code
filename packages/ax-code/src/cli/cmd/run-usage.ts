import { isRunEventStreamFormat } from "./run-format"

/** Yargs usage-failure message prefixes the shared CLI failure handler recognizes. */
const CLI_USAGE_FAILURE_PREFIXES: readonly string[] = [
  "Unknown argument",
  "Not enough non-option arguments",
  "Invalid values:",
  "Missing required argument",
]

export function isCliUsageFailureMessage(message: string | undefined): boolean {
  return message !== undefined && CLI_USAGE_FAILURE_PREFIXES.some((prefix) => message.startsWith(prefix))
}

/** The offending token in a yargs "Unknown argument: x" message, when present. */
function unknownArgumentToken(message: string): string | undefined {
  if (!message.startsWith("Unknown argument")) return undefined
  const token = message
    .slice("Unknown argument".length)
    .replace(/^[:\s]+/, "")
    .trim()
  return token.length > 0 ? token : undefined
}

/**
 * Hint appended to a yargs usage failure ("Unknown argument",
 * "Invalid values", "Missing required argument", "Not enough non-option
 * arguments") when the failing command is `run`, so headless callers get a
 * one-line pointer instead of a full help dump. A bare `json` argument is
 * almost always a mistyped `--format json`, so it gets the NDJSON-specific
 * hint.
 */
export function runUsageFailureHint(message: string | undefined, command: string | undefined): string | undefined {
  if (command !== "run") return undefined
  if (!isCliUsageFailureMessage(message)) return undefined
  if (unknownArgumentToken(message ?? "") === "json") {
    return "Use --format json for the NDJSON event stream (run --help lists the accepted flags)."
  }
  return "Run `ax-code run --help` to see the accepted flags."
}

/**
 * Whether the shared CLI failure handler prints the full help for this usage
 * failure: the `run` command prints only the one-line error plus the hint
 * above (scripted callers must be able to read stderr), every other command
 * keeps the full help dump.
 */
export function cliFailureShowsFullHelp(message: string | undefined, command: string | undefined): boolean {
  return isCliUsageFailureMessage(message) && command !== "run"
}

/**
 * The command yargs is parsing, derived from the raw CLI arguments: the
 * first non-flag token after the entry. Global value-taking flags
 * (--log-level, --sandbox, --debug-dir, --port, --hostname, --mdns-domain,
 * --cors) skip their value so a flag value is never mistaken for the command,
 * and nothing after `--` counts. Used by the shared CLI failure handler to
 * attribute an "Unknown argument" error to its command without depending on
 * yargs internals, which do not expose the command chain reliably at
 * strict-fail time.
 */
export function commandTokenFromArgv(argv: readonly string[]): string | undefined {
  const valueFlags = new Set([
    "--log-level",
    "--sandbox",
    "--debug-dir",
    "--port",
    "--hostname",
    "--mdns-domain",
    "--cors",
  ])
  let skipValue = false
  for (const token of argv) {
    if (skipValue) {
      skipValue = false
      continue
    }
    if (token === "--") return undefined
    if (token.startsWith("-")) {
      if (!token.includes("=") && valueFlags.has(token)) skipValue = true
      continue
    }
    return token
  }
  return undefined
}

/**
 * Whether the raw CLI argv selects the `run` command with one of the NDJSON
 * event-stream `--format` values (spaced or `=` spelling). Used by the shared
 * CLI failure handler so a yargs-level usage failure (e.g. a mistyped flag)
 * still writes one structured `{"type":"error",...}` stdout line for stream
 * consumers before the human-readable stderr prose — without it they get
 * nothing on stdout at all.
 */
export function runArgvUsesEventStream(argv: readonly string[]): boolean {
  if (commandTokenFromArgv(argv) !== "run") return false
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    // Prompt text after `--` must never match, even when it spells a flag.
    if (token === "--") return false
    if (token === "--format") {
      const value = argv[i + 1]
      if (value !== undefined && isRunEventStreamFormat(value)) return true
      continue
    }
    if (token.startsWith("--format=") && isRunEventStreamFormat(token.slice("--format=".length))) return true
  }
  return false
}
