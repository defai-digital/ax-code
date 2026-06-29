"use strict"

const createMissingInstalledAppsCache = () => ({
  apps: [],
  hasCache: false,
  isCacheStale: true,
})

function normalizeInstalledAppsCache(cache, nowSecs, ttlSecs) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
    return createMissingInstalledAppsCache()
  }

  if (!Array.isArray(cache.apps)) {
    return createMissingInstalledAppsCache()
  }

  const updatedAt = Number(cache.updatedAt)
  const hasUsableTimestamp = Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt <= nowSecs
  const isCacheStale = !hasUsableTimestamp || nowSecs - updatedAt > ttlSecs

  return {
    apps: cache.apps,
    hasCache: true,
    isCacheStale,
  }
}

module.exports = {
  normalizeInstalledAppsCache,
}
