export async function resolveSession(id?: string) {
  const [{ Session }, { SessionID }] = await Promise.all([import("../../session"), import("../../session/schema")])
  if (id) {
    return Session.get(SessionID.make(id))
  }
  return [...Session.list({ limit: 1 })][0]
}

export function printNoSessionFound() {
  console.log("No sessions found. Run ax-code first.")
}
