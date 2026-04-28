#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun --env-file=../../.env --conditions=browser ./src/index.ts generate > ../sdk/openapi.json`.cwd("packages/ax-code")

await $`./script/format.ts`
