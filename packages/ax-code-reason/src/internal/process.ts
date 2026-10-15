import { createProcess } from "@ax-code/util/process"
import { codeReasonHost } from "../host"

// The engine host owns process-tree termination, so bind it into the shared
// spawn/kill helpers.
export const Process = createProcess((proc, options) => codeReasonHost().killTree(proc, options))
