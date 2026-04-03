# BUG: Missing Type Definitions for sanitize-html Library

**Date:** 2026-04-03
**Severity:** Medium
**Status:** Fixed (v1.6.13)

## Symptoms

- TypeScript compilation fails with "Could not find a declaration file for module 'sanitize-html'"
- The markdown component cannot be properly type-checked

## Root Cause

The `sanitize-html` library was imported without its corresponding `@types/sanitize-html` package.

## Fix

Installed `@types/sanitize-html` as a dev dependency in `packages/ui`.

## Files Changed

- `packages/ui/package.json` — added `@types/sanitize-html` to devDependencies
