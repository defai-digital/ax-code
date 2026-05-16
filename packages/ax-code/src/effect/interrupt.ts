const INTERRUPTED_WITHOUT_ERROR = "All fibers interrupted without error"

export function isHarmlessEffectInterrupt(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message === INTERRUPTED_WITHOUT_ERROR
}
