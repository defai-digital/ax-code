const cache = new Map<string, string>()

export function cacheToken(userID: string, token: string) {
  // ax-workflow-seed: shared-cache-scope-unverified
  cache.set(userID, token)
}
