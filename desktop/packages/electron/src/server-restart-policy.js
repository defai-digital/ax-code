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
    completeRestart({ successful = false } = {}) {
      if (successful) crashRestarts = 0
      relaunching = false
    },
  }
}

module.exports = {
  createServerRestartPolicy,
}
