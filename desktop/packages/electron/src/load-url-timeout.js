"use strict"

// loadURL has no built-in deadline: if the server accepts TCP but never
// responds, the promise never settles, `ready-to-show` never fires, and a
// show:false window stays hidden forever while the app looks dead. Race the
// load against a timeout so the caller can fail loudly instead.
const DEFAULT_LOAD_URL_TIMEOUT_MS = 30_000

function loadUrlWithTimeout(
  window,
  url,
  { timeoutMs = DEFAULT_LOAD_URL_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  return new Promise((resolve, reject) => {
    const timer = setTimer(() => {
      reject(new Error(`window failed to load within ${timeoutMs}ms: ${url}`))
    }, timeoutMs)
    // A wedged load must not keep the process alive on its own.
    timer.unref?.()
    window.loadURL(url).then(
      () => {
        clearTimer(timer)
        resolve()
      },
      (error) => {
        clearTimer(timer)
        reject(error)
      },
    )
  })
}

module.exports = { loadUrlWithTimeout, DEFAULT_LOAD_URL_TIMEOUT_MS }
