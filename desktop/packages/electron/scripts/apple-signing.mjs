export const DEFAULT_APPLE_TEAM_ID = "N5ZUZDUJS6"
export const DEFAULT_APPLE_KEYCHAIN_PROFILE = "ax-notary"

export function isMacPackaging(args) {
  return args.some((arg) => arg === "--mac" || arg === "-m" || arg.startsWith("--mac="))
}

export function resolveAppleSigningEnv(args, env = process.env, platform = process.platform) {
  const resolved = { ...env }
  if (platform !== "darwin" || !isMacPackaging(args) || resolved.CI === "true") return resolved

  resolved.APPLE_TEAM_ID ||= DEFAULT_APPLE_TEAM_ID

  const hasExplicitNotaryCredentials =
    Object.hasOwn(resolved, "APPLE_KEYCHAIN_PROFILE") ||
    Boolean(resolved.APPLE_ID || resolved.APPLE_API_KEY || resolved.APPLE_API_KEY_ID || resolved.APPLE_API_ISSUER)
  if (!hasExplicitNotaryCredentials) {
    resolved.APPLE_KEYCHAIN_PROFILE = DEFAULT_APPLE_KEYCHAIN_PROFILE
  }

  return resolved
}
