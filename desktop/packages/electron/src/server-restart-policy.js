"use strict"

function createServerRestartPolicy(options = {}) {
  const maxRestarts = Number.isInteger(options.maxRestarts) && options.maxRestarts >= 0 ? options.maxRestarts : 5
  let crashRestarts = 0
  let relaunching = false

  return {
    get crashRestarts() {
      return crashRestarts
    },
    get relaunching() {
      return relaunching
    },
    shouldRestart({ quitting = false } = {}) {
      if (relaunching || quitting) return false
      return crashRestarts + 1 <= maxRestarts
    },
    beginRestart() {
      if (relaunching) return false
      crashRestarts += 1
      if (crashRestarts > maxRestarts) return false
      relaunching = true
      return true
    },
    completeRestart() {
      relaunching = false
    },
    markStable() {
      crashRestarts = 0
    },
  }
}

// Classifies a server utilityProcess exit event: crash recovery must fire
// only for a server that actually became ready and is still the current
// process. A start attempt that failed (timeout or error before ready) also
// reaches the exit handler with its launch promise already settled — its
// caller owns the retry, and treating that exit as a crash re-enters
// recovery, which can queue a pending pass that later forks a duplicate
// server while a healthy replacement is already running (orphaning it).
function shouldRecoverAfterServerExit({ becameReady = false, wasCurrent = false, quitting = false } = {}) {
  return becameReady && wasCurrent && !quitting
}

module.exports = {
  createServerRestartPolicy,
  shouldRecoverAfterServerExit,
}
