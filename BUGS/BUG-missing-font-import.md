# BUG: Missing Font Asset Import in Font Component

**Date:** 2026-04-03
**Severity:** Medium
**Status:** Fixed (v1.6.13)

## Symptoms

- TypeScript compilation fails with error "Cannot find name 'ibmPlexMonoRegular'"
- The font preloading link in the Font component cannot resolve the font asset
- UI may not properly preload the IBM Plex Mono font

## Root Cause

The `ibmPlexMonoRegular` variable is used in the Link component for font preloading but is not imported. The font file exists at `packages/ui/src/assets/fonts/ibm-plex-mono.woff2` but the import statement was missing.

## Fix

Added the missing import:
```ts
import ibmPlexMonoRegular from "../assets/fonts/ibm-plex-mono.woff2"
```

## Files Changed

- `packages/ui/src/components/font.tsx:7`
