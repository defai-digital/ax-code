import { createProcess } from "@ax-code/util/process"
import { codeIntelHost } from "../host"

// The LSP host owns process-tree termination (graceful SIGTERM with
// escalation), so bind it into the shared spawn/kill helpers.
export const Process = createProcess((proc, options) => codeIntelHost().killTree(proc, options))
