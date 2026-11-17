/**
 * Values that look like a bearer credential are refused before any prompt
 * (ADR-174 rule 4): typing a credential is transmitting it. Unanchored, so
 * a secret embedded in a longer value is still caught. Publishable keys
 * (`pk_`) are deliberately absent; a JWT shape is labeled, not refused.
 */
const CREDENTIAL_VALUE: readonly RegExp[] = [
  // Not a word boundary: `my_sk_live_…` must still match (underscore is a
  // word character); only an alphanumeric prefix such as `task_live_…` is
  // treated as a different token.
  /(?<![A-Za-z0-9])(?:sk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9_-]{16,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abcepsr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bya29\.[0-9A-Za-z_-]{20,}/,
  /\bage-secret-key-1[a-z0-9]{20,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]
/** A JWT-shaped value: labeled and masked, never refused (fixtures use the shape). */
const JWT_SHAPE = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/

/** Whether text contains a bearer-credential shape (ADR-174 rule 4). */
export function credentialLike(value: string): boolean {
  return CREDENTIAL_VALUE.some((pattern) => pattern.test(value))
}

/** Whether text should be masked in reviews and prompts, including JWT-shaped fixtures. */
export function maskedCredentialValue(value: string): boolean {
  return JWT_SHAPE.test(value) || credentialLike(value)
}
