// Consolidated into @ax-code/util so core and reason share one
// implementation. This shim keeps the package-local `./internal/native-json`
// import path stable for existing call sites.
export * from "@ax-code/util/native-json"
