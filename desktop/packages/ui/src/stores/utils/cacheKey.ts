export const DEFAULT_DIRECTORY_CACHE_KEY = "__default__"

export const getDirectoryCacheKey = (directory: string | null | undefined): string =>
  directory?.trim() || DEFAULT_DIRECTORY_CACHE_KEY
