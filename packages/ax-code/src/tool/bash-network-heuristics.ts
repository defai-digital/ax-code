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
  /** interpreter base name → flags whose following argument is inline code */
  const INLINE_CODE_INTERPRETERS: Readonly<Record<string, readonly string[]>> = {
    python: ["-c"],
    python3: ["-c"],
    node: ["-e"],
    perl: ["-e"],
    ruby: ["-e"],
    php: ["-r"],
  }

  /** substrings/regexes that suggest inline code opens network sockets */
  const NETWORK_CODE_INDICATORS: readonly (RegExp | string)[] = [
    /https?:\/\//,
    "urllib",
    "requests",
    "http.client",
    "net/http",
    "socket",
    "fetch(",
    "XMLHttpRequest",
    "LWP",
    "Net::",
    "dgram",
    "tls",
  ]

  const CONTAINER_RUNNERS = new Set(["docker", "podman", "nerdctl"])
  const NAMESPACE_TOOLS = new Set(["nsenter", "unshare"])

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

  function inlineCodeFor(base: string, args: readonly string[]): string | undefined {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (arg === "--eval" && base === "node") return args[i + 1]
      if (arg.startsWith("--eval=") && base === "node") return arg.slice("--eval=".length)
      if (INLINE_CODE_INTERPRETERS[base]?.includes(arg)) return args[i + 1]
    }
    return undefined
  }

  export function inspect(name: string, args: readonly string[]): Inspection {
    const base = baseName(name)
    const result: Inspection = { inlineCodeNetworkSuspect: false, sandboxEscapeSuspect: false }

    if (base === "busybox") {
      const applet = args.find((arg) => arg && !arg.startsWith("-"))
      if (applet) result.applet = baseName(applet)
    }

    if (INLINE_CODE_INTERPRETERS[base]) {
      const code = inlineCodeFor(base, args)
      // Missing code after the flag is opaque — treat it as suspect rather
      // than as harmless.
      if (code === undefined) {
        if (
          args.some(
            (arg) => INLINE_CODE_INTERPRETERS[base]!.includes(arg) || (base === "node" && arg.startsWith("--eval")),
          )
        ) {
          result.inlineCodeNetworkSuspect = true
        }
      } else if (
        NETWORK_CODE_INDICATORS.some((indicator) =>
          typeof indicator === "string" ? code.includes(indicator) : indicator.test(code),
        )
      ) {
        result.inlineCodeNetworkSuspect = true
      }
    }

    if ((CONTAINER_RUNNERS.has(base) && args[0] === "run") || NAMESPACE_TOOLS.has(base)) {
      result.sandboxEscapeSuspect = true
    }

    return result
  }
}
