#!/usr/bin/env -S npx tsx

import { spawnSync } from "child_process"

// Allow scoped formatting when unrelated work is in progress in the checkout.
const paths = process.argv.slice(2)
const result = spawnSync(
  "pnpm",
  ["exec", "prettier", "--ignore-unknown", "--write", ...(paths.length ? paths : ["."])],
  {
    stdio: "inherit",
  },
)
process.exit(result.status ?? 1)
