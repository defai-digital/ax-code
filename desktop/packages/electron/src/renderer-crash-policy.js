"use strict"

// Bounds automatic renderer reloads after a crash so a renderer that crashes
// on every load does not loop forever. The attempt counter resets once the
// renderer survives a stability window (scheduled by main.js, which calls
// markStable() after the window has been up for a while) — the same shape as
// the server restart policy.
function createRendererCrashPolicy(options = {}) {
  const maxReloads = Number.isInteger(options.maxReloads) && options.maxReloads >= 0 ? options.maxReloads : 3
  let crashReloads = 0

  return {
    get crashReloads() {
      return crashReloads
    },
    shouldReload({ quitting = false } = {}) {
      if (quitting) return false
      return crashReloads + 1 <= maxReloads
    },
    beginReload() {
      crashReloads += 1
      if (crashReloads > maxReloads) return false
      return true
    },
    markStable() {
      crashReloads = 0
    },
  }
}

module.exports = {
  createRendererCrashPolicy,
}
