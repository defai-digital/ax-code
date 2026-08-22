export type ComputerUseErrorCode =
  | "stale_target"
  | "no_active_observation"
  | "unsupported_scope"
  | "unsupported_action"
  | "unsupported_target"
  | "provider_unavailable"
  | "provider_error"

export class ComputerUseError extends Error {
  readonly provider: string
  /** ax-computer error code, or a backend refusal code carried verbatim */
  readonly code: ComputerUseErrorCode | string

  constructor(message: string, options: { provider: string; code: ComputerUseErrorCode | string; cause?: unknown }) {
    super(message, { cause: options.cause })
    this.name = "ComputerUseError"
    this.provider = options.provider
    this.code = options.code
  }
}
