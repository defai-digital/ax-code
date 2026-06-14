import { toErrorMessage } from "./error-message"

const INTERRUPTED_WITHOUT_ERROR = "All fibers interrupted without error"

export function isHarmlessInterrupt(reason: unknown) {
  const message = toErrorMessage(reason)
  return message === INTERRUPTED_WITHOUT_ERROR
}
