/**
 * Static heuristics that back `Isolation.assertBashNetwork`.
 *
 * The per-command network allow/deny check only sees command names. Three
 * families hide the real network-relevant command behind a wrapper name:
 *
 * 1. `busybox <applet> …` — busybox dispatches to the named applet, so
 *    `busybox wget https://…` must be judged as `wget`.
 * 2. interpreter one-liners — `python -c`, `node -e`, `perl -e`, `ruby -e`,
 *    `php -r` carry inline code that can open sockets without invoking any
 *    network binary. Inline code is opaque; we only flag it when it contains
 *    conservative network indicators (or the code is missing entirely).
 * 3. container/namespace invocations — `docker run`, `podman run`, `nsenter`,
 *    `unshare` create or enter another network namespace that the OS sandbox
 *    cannot police, so they are always network-suspect while network access
 *    is disabled.
 *
 * Kept as a pure module so the policy matrix is unit-testable without
 * spawning processes.
 */
export namespace BashNetworkHeuristics {
  /** interpreter family (matched on the base name) → flags whose argument is inline code */
  const INLINE_CODE_INTERPRETERS: ReadonlyArray<{ family: string; match: RegExp; flags: readonly string[] }> = [
    // Versioned and distro-specific names execute the same inline code:
    // python3.12, pypy3, nodejs (Debian), perl5.36, ruby3.3, php8.3.
    { family: "python", match: /^(?:python|pypy)(?:\d+(?:\.\d+)?t?)?(?:\.exe)?$/i, flags: ["-c"] },
    { family: "node", match: /^(?:node|nodejs)(?:\d+)?(?:\.exe)?$/i, flags: ["-e", "-p", "--eval", "--print"] },
    { family: "bun", match: /^bun(?:\.exe)?$/i, flags: ["-e", "--eval", "--print", "-p"] },
    { family: "deno", match: /^deno(?:\.exe)?$/i, flags: ["eval"] },
    { family: "perl", match: /^perl(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i, flags: ["-e", "-E"] },
    { family: "ruby", match: /^ruby(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i, flags: ["-e"] },
    { family: "php", match: /^php(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i, flags: ["-r"] },
  ]

  /** substrings/regexes that suggest inline code opens network sockets */
  const NETWORK_CODE_INDICATORS: readonly (RegExp | string)[] = [
    /(?:https?|wss?|ftps?):\/\//i,
    "urllib",
    // Only the module, not a variable that happens to be called `requests`.
    /\b(?:import|from)\s+requests\b|require\(\s*["']requests["']/,
    "http.client",
    "net/http",
    /socket/i,
    /\bfetch\s*\(/,
    "XMLHttpRequest",
    "WebSocket",
    "LWP",
    "Net::",
    "IO::Socket",
    "HTTP::",
    "dgram",
    "tls",
    // Node core network modules, with or without the node: prefix.
    /require\(\s*["'](?:node:)?(?:net|http|https|http2|dns)["']|from\s+["'](?:node:)?(?:net|http|https|http2|dns)["']/,
    /\b(?:net|http|https)\.(?:connect|get|request|createServer)\s*\(/,
    // PHP
    /\b(?:curl_init|curl_exec|p?fsockopen|file_get_contents|stream_socket_client|ftp_connect|SoapClient)\b/,
  ]

  const CONTAINER_RUNNERS = new Set(["docker", "podman", "nerdctl"])
  /** container subcommands that start or enter another network namespace;
   *  registry operations (pull/push/build) stay with the ordinary
   *  per-command network policy, which already knows the container binary. */
  const CONTAINER_NETWORK_SUBCOMMANDS = new Set(["run", "exec", "create", "start", "restart", "compose"])
  /** management-form prefixes: `docker container run`, `docker image pull` */
  const CONTAINER_MANAGEMENT_GROUPS = new Set(["container", "image", "compose"])
  /** global container flags that take a value in the next argument */
  const CONTAINER_VALUE_FLAGS = new Set([
    "--config",
    "--context",
    "-c",
    "-H",
    "--host",
    "-l",
    "--log-level",
    "--tlscacert",
    "--tlscert",
    "--tlskey",
  ])
  const NAMESPACE_TOOLS = new Set(["nsenter", "unshare"])
  /** Leading help/version forms; `-h` and `-v` are not included since docker
   *  uses them for hostname and volume. */
  const HELP_LEADING = new Set(["--help", "help", "--version", "version"])
  /** busybox applets that only wrap another command */
  const BUSYBOX_WRAPPERS = new Set(["sh", "ash", "bash", "env", "nice", "timeout", "xargs", "nohup", "setsid"])

  export type Inspection = {
    /** busybox applet to judge the command by (e.g. `wget` for `busybox wget …`) */
    applet?: string
    /** inline interpreter code that appears network-capable (or opaque) */
    inlineCodeNetworkSuspect: boolean
    /** container/namespace invocation that escapes per-command network checks */
    sandboxEscapeSuspect: boolean
  }

  function baseName(name: string): string {
    return name.split(/[\\/]/).pop() ?? name
  }

  function interpreterFor(base: string) {
    return INLINE_CODE_INTERPRETERS.find((entry) => entry.match.test(base))
  }

  /**
   * Every inline-code argument for the interpreter: `-c code`, `-ccode`,
   * `-e'code'` (the shell hands `-ecode` to us), `--eval=code`, bundled short
   * flags such as `-Bc code`, and repeated `-e` (perl/ruby run all of them).
   * Scanning stops at `--` or at the first operand (a script filename), so a
   * script's own `-c` argument is not mistaken for inline code. `undefined`
   * means a code flag was present but its code is missing (opaque).
   */
  function inlineCodeFor(flags: readonly string[], args: readonly string[]): { codes: string[]; opaque: boolean } {
    const codes: string[] = []
    let opaque = false
    const longFlags = flags.filter((flag) => flag.startsWith("--"))
    const shortFlags = flags.filter((flag) => /^-[^-]$/.test(flag)).map((flag) => flag[1]!)
    const wordFlags = flags.filter((flag) => !flag.startsWith("-"))
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (arg === "--") break
      if (wordFlags.includes(arg)) {
        const next = args[i + 1]
        if (next === undefined) opaque = true
        else codes.push(next)
        i++
        continue
      }
      const long = longFlags.find((flag) => arg === flag || arg.startsWith(`${flag}=`))
      if (long) {
        if (arg === long) {
          const next = args[i + 1]
          if (next === undefined) opaque = true
          else codes.push(next)
          i++
        } else codes.push(arg.slice(long.length + 1))
        continue
      }
      if (/^-[^-]/.test(arg)) {
        // Short flag cluster: the first code flag consumes the remainder of
        // the cluster (or the next argument when the cluster ends there).
        const cluster = arg.slice(1)
        const index = [...cluster].findIndex((char) => shortFlags.includes(char))
        if (index === -1) continue
        const rest = cluster.slice(index + 1)
        if (rest.length > 0) codes.push(rest)
        else {
          const next = args[i + 1]
          if (next === undefined) opaque = true
          else codes.push(next)
          i++
        }
        continue
      }
      if (!arg.startsWith("-")) break
    }
    return { codes, opaque }
  }

  function looksNetworked(code: string): boolean {
    return NETWORK_CODE_INDICATORS.some((indicator) =>
      typeof indicator === "string" ? code.includes(indicator) : indicator.test(code),
    )
  }

  /** The command a busybox invocation really runs, looking through wrapper applets. */
  function busyboxApplet(args: readonly string[]): string | undefined {
    let rest = args.filter((arg) => arg.length > 0)
    for (let depth = 0; depth < 4; depth++) {
      const index = rest.findIndex((arg) => !arg.startsWith("-"))
      if (index === -1) return undefined
      const applet = baseName(rest[index]!)
      if (!BUSYBOX_WRAPPERS.has(applet)) return applet
      const after = rest.slice(index + 1)
      if (applet === "sh" || applet === "ash" || applet === "bash") {
        const flag = after.findIndex((arg) => arg === "-c")
        const script = flag === -1 ? undefined : after[flag + 1]
        // An inline script hides the inner command; report its first word so
        // `busybox sh -c 'wget …'` is judged as wget. An opaque script keeps
        // the shell name, which the policy treats as unknown.
        if (script === undefined) return applet
        const word = script.trim().split(/\s+/)[0]
        return word ? baseName(word) : applet
      }
      // env/nice/timeout/xargs/nohup/setsid: skip the wrapper and its
      // VAR=value or -flag arguments, then judge what follows.
      rest = after
        .filter((arg, i) => !(i === 0 && applet === "timeout" && /^\d/.test(arg)))
        .filter((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))
    }
    return undefined
  }

  /** The effective container subcommand after global flags, or the management-form pair. */
  function containerSubcommand(args: readonly string[]): string | undefined {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (CONTAINER_VALUE_FLAGS.has(arg)) {
        i++
        continue
      }
      if (arg.startsWith("-")) continue
      if (CONTAINER_MANAGEMENT_GROUPS.has(arg)) {
        const next = args[i + 1]
        return next === undefined ? arg : `${arg} ${next}`
      }
      return arg
    }
    return undefined
  }

  export function inspect(name: string, args: readonly string[]): Inspection {
    const base = baseName(name)
    const result: Inspection = { inlineCodeNetworkSuspect: false, sandboxEscapeSuspect: false }

    if (base === "busybox") {
      const applet = busyboxApplet(args)
      if (applet) result.applet = applet
    }

    const interpreter = interpreterFor(base)
    if (interpreter) {
      const { codes, opaque } = inlineCodeFor(interpreter.flags, args)
      // Missing code after the flag is opaque — treat it as suspect rather
      // than as harmless.
      if (opaque || codes.some(looksNetworked)) result.inlineCodeNetworkSuspect = true
    }

    // Help/version forms only exempt the invocation when they appear before
    // the image or command operand: the first argument, any argument before
    // the (possibly management-form) subcommand, or the argument immediately
    // after it. A `--help` behind the image (`docker run --rm alpine --help`,
    // or inside container payload such as `sh -c "echo --help"`) must not
    // disable escape detection.
    const firstArgIndex = args.findIndex((arg) => arg.length > 0)
    if (firstArgIndex !== -1 && HELP_LEADING.has(args[firstArgIndex]!)) return result
    let subcommandEnd = -1
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (CONTAINER_VALUE_FLAGS.has(arg)) {
        i++
        continue
      }
      if (arg.length === 0 || arg.startsWith("-")) continue
      subcommandEnd = CONTAINER_MANAGEMENT_GROUPS.has(arg) && args[i + 1] !== undefined ? i + 1 : i
      break
    }
    if (subcommandEnd >= 0 && args.some((arg, i) => HELP_LEADING.has(arg) && i <= subcommandEnd + 1)) return result

    if (CONTAINER_RUNNERS.has(base)) {
      const subcommand = containerSubcommand(args)
      if (subcommand !== undefined) {
        const [group, verb] = subcommand.split(" ")
        const effective = verb ?? group!
        if (CONTAINER_NETWORK_SUBCOMMANDS.has(effective) || (group === "compose" && verb !== undefined)) {
          result.sandboxEscapeSuspect = true
        }
      }
    } else if (NAMESPACE_TOOLS.has(base)) {
      result.sandboxEscapeSuspect = true
    }

    return result
  }
}
