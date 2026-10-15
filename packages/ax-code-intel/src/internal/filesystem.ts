// Consolidated into @ax-code/util so intel, core and reason share one
// filesystem helper. The package-local copy had drifted behind core — it lacked
// `isExecutable`, `callerCwd` and the factored `isOutsideRelative`. This shim
// keeps the package-local `./internal/filesystem` import path stable.
export * from "@ax-code/util/filesystem"
