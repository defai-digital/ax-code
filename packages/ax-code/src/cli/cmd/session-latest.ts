export async function resolveSession(id?: string) {
  const [{ Session }, { SessionID }, { NotFoundError }] = await Promise.all([
    import("../../session"),
    import("../../session/schema"),
    import("../../storage/db"),
  ])
  if (id) {
    // An unknown explicit id is the caller's "no session" case, not a crash.
    return Session.get(SessionID.make(id)).catch((error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    })
  }
  return [...Session.list({ limit: 1 })][0]
}

export function printNoSessionFound(id?: string) {
  console.log(id ? `Session "${id}" not found.` : "No sessions found. Run ax-code first.")
}
