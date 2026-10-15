// Consolidated into @ax-code/util so reason, intel and core share one glob
// implementation. This shim keeps the package-local `./internal/glob` import
// path stable for existing call sites.
export * from "@ax-code/util/glob"
