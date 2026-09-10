import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { AX_ENGINE_ERROR } from "./constants"

// Readiness already owns a bounded startup attempt. Replaying it in either
// session retry loop repeats expensive weight loading without fixing its cause.
export const AxEngineStartupError = NamedError.create(
  "AxEngineStartupError",
  z.object({
    message: z.string(),
    code: z.enum([AX_ENGINE_ERROR.ServerStartFailed, AX_ENGINE_ERROR.ServerHealthFailed]),
    reason: z.enum(["process-exited", "timeout"]),
  }),
)
