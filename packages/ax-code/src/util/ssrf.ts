// SSRF-guarded fetch consolidated into @ax-code/util so core, intel and reason
// validate resolved addresses with one hardened implementation. This shim keeps
// the `@/util/ssrf` import path stable.
export * from "@ax-code/util/ssrf"
