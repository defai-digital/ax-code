/**
 * Project files are repository-controlled input. Dangerous capabilities in
 * those files stay disabled unless the user opts in outside the repository.
 * Keeping the switch environment-only prevents a malicious checkout from
 * declaring itself trusted in ax-code.json.
 */
export namespace ProjectConfigTrust {
  export const ENV = "AX_CODE_TRUST_PROJECT_CONFIG"

  export function enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[ENV] === "1"
  }
}
