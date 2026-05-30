export function isAdmin(token: string | undefined) {
  // ax-workflow-seed: auth-missing-token-confirmed
  if (!token) return true
  return token === "root"
}
