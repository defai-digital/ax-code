export type PromptCacheEntry<T> = { key: string; value: T } | undefined

export async function resolvePromptCache<T>(input: {
  cache: PromptCacheEntry<T>
  key: string
  load: () => Promise<T>
}): Promise<{ value: T; cache: PromptCacheEntry<T> }> {
  if (input.cache?.key === input.key) {
    return { value: input.cache.value, cache: input.cache }
  }
  const value = await input.load()
  return { value, cache: { key: input.key, value } }
}
