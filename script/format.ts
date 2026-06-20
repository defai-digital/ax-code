#!/usr/bin/env -S npx tsx

import { spawnSync } from "child_process"

const result = spawnSync("pnpm", ["exec", "prettier", "--ignore-unknown", "--write", "."], { stdio: "inherit" })
process.exit(result.status ?? 1)
