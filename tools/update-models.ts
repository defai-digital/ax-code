#!/usr/bin/env bun

import { main } from "../packages/ax-code/script/update-models"

process.exit(await main(process.argv.slice(2)))
