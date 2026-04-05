export namespace Env {
  // Strip secrets from a process environment before forwarding to child
  // processes. An LLM prompt that instructs a spawned shell to run
  // `env` or `echo $OPENAI_API_KEY` could otherwise exfiltrate provider
  // tokens, passwords, and other credentials held by the parent
  // process. Matches on component boundaries (start/end or underscore)
  // so functional variables like `SSH_AUTH_SOCK` (auth agent socket)
  // and `GIT_ASKPASS` (credential helper) aren't stripped. An explicit
  // allowlist covers the few legitimate cases where a secret-looking
  // keyword IS a real substring we want to keep.
  const SECRET_PATTERN = /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH)(?:_|$)/i
  const SAFE_ALLOWLIST = new Set(["SSH_AUTH_SOCK", "GIT_ASKPASS", "SUDO_ASKPASS", "GIT_CREDENTIAL_HELPER"])

  export function sanitize(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(env)) {
      if (SAFE_ALLOWLIST.has(k)) {
        out[k] = v
        continue
      }
      if (SECRET_PATTERN.test(k)) continue
      out[k] = v
    }
    return out
  }
}
