// Consolidated into @ax-code/util so intel and reason share one
// implementation. This shim keeps the package-local `./internal/record`
// import path stable for existing call sites.
export * from "@ax-code/util/record"
