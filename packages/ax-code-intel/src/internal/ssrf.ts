// Consolidated into @ax-code/util. The package-local copy had drifted behind
// core and still trusted the resolver's `family` tag, so a mismatched pair (an
// IPv6 string tagged family 4) could bypass the private-address check. This shim
// keeps the `./internal/ssrf` import path stable.
export * from "@ax-code/util/ssrf"
