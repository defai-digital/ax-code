/**
 * OS-sandbox denial detection for the bash escalation ladder (PRD phase-2 R3).
 *
 * When the OS sandbox (macOS Seatbelt / Linux bubblewrap) itself denies an
 * operation, the wrapped command fails with an ordinary non-zero exit and the
 * denial only survives as stderr text. The app-layer isolation retry loop in
 * session/prompt-tools.ts cannot see these kernel denials — it only covers
 * Isolation.DeniedError thrown before spawn. The classifier here detects the
 * denial signatures so bash-impl can ask once via the `isolation_escalation`
 * permission and retry exactly once with the OS sandbox relaxed.
 *
 * The signature list is deliberately conservative: false negatives (a missed
 * denial just stays a failed tool call, today's behavior) are cheaper than
 * false positives (an escalation prompt for an ordinary failure). Ordinary
 * command failures — plain `exit 1`, test failures, EACCES "Permission
 * denied" from file permissions — must never match.
 */

import type { Isolation } from "@/isolation"
import type { OsSandbox } from "@/isolation/os-sandbox"

export type SandboxDenial = {
  /** Sandbox mechanism of the wrapped run that was denied. */
  mechanism: "seatbelt" | "bubblewrap"
  /** Matched denial text, surfaced as evidence in the escalation prompt. */
  evidence: string
}

// Denial signatures, in match order:
//
// - "Operation not permitted" is the strerror for EPERM, which is what
//   Seatbelt returns for denied file-write*/network* operations on macOS; the
//   wrapped command's own error text carries the phrase (e.g.
//   `touch: /etc/x: Operation not permitted`). The EACCES strerror
//   "Permission denied" — what ordinary file-permission failures produce —
//   is deliberately NOT matched: it fires constantly outside any sandbox.
// - sandbox-exec reports its own profile/load/exec failures on stderr with a
//   line-anchored "sandbox-exec: " prefix.
// - sandboxd-style violation lines ("deny(1) file-write-data") when a wrapped
//   process or shell surfaces the Seatbelt violation text.
// - bubblewrap reports every setup/runtime failure with a line-anchored
//   "bwrap: " prefix.
const DENIAL_PATTERNS: RegExp[] = [
  /Operation not permitted/,
  /^sandbox-exec: /m,
  /\bdeny\(\d+\) [a-z][a-z-]+/,
  /^bwrap: /m,
]

/**
 * Detect an OS-sandbox denial in a finished bash run. Returns the denial
 * evidence when the escalation ladder should offer a relaxed retry, or
 * undefined when the run must be returned as-is.
 *
 * Fires ONLY when every gate passes:
 * - the run was actually wrapped by the OS sandbox (`wrap.active`),
 * - isolation mode is not read-only (an absolute floor the app-layer
 *   escalation loop also never relaxes — the ask is never even offered),
 * - the run was not ended by our own timeout/abort kill,
 * - the run failed with a real non-zero exit (null means signal-killed),
 * - the output carries a sandbox-denial signature.
 */
export function detectSandboxDenial(input: {
  wrap: OsSandbox.WrapResult | undefined
  isolation: Isolation.State | undefined
  exit: number | null
  timedOut: boolean
  aborted: boolean
  output: string
}): SandboxDenial | undefined {
  if (input.wrap?.active !== true) return undefined
  if (input.isolation?.mode === "read-only") return undefined
  if (input.timedOut || input.aborted) return undefined
  if (input.exit === null || input.exit === 0) return undefined
  for (const pattern of DENIAL_PATTERNS) {
    const match = pattern.exec(input.output)
    if (match) return { mechanism: input.wrap.mechanism, evidence: match[0] }
  }
  return undefined
}
