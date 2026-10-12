// Consolidated into @ax-code/util so core and intel share one
// implementation. This shim keeps the package-local `./internal/lock`
// import path stable for existing call sites.
export * from "@ax-code/util/lock"
