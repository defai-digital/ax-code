const INTERRUPTED_WITHOUT_ERROR = "All fibers interrupted without error"

function isHarmlessInterrupt(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message === INTERRUPTED_WITHOUT_ERROR
}

process.prependListener("unhandledRejection", (reason) => {
  if (isHarmlessInterrupt(reason)) return

  queueMicrotask(() => {
    throw reason instanceof Error ? reason : new Error(String(reason))
  })
})

process.prependListener("uncaughtException", (error) => {
  if (isHarmlessInterrupt(error)) return
  throw error
})
