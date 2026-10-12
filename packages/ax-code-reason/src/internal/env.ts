// Consolidated into @ax-code/util so core, intel and reason share one
// implementation. This shim keeps the package-local `./internal/env`
// import path stable for existing call sites.
//
// This now resolves to core's implementation, which strips a strict superset
// of secret-bearing variables and redacts more credential shapes than the
// previous package-local copy.
export * from "@ax-code/util/env"
