#!/usr/bin/env bun

import { $ } from "bun"

// drizzle-kit check compares schema to migrations, exits non-zero if drift
const result = await $`pnpm exec drizzle-kit check`.quiet().nothrow()

if (result.exitCode !== 0) {
  console.error("Schema has changes not captured in migrations!")
  console.error("Run: pnpm exec drizzle-kit generate")
  console.error("")
  console.error(result.stderr.toString())
  process.exit(1)
}

console.log("Migrations are up to date")
