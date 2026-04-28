#!/usr/bin/env bun
import fs from "fs/promises"
import { parseOpenApiSnapshot, validateOpenApiSnapshot } from "../src/openapi/contract.js"

const snapshotPath = new URL("../../openapi.json", import.meta.url)

let parsed: unknown
try {
  parsed = parseOpenApiSnapshot(await fs.readFile(snapshotPath, "utf8"))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Invalid OpenAPI JSON: ${message}`)
  process.exit(1)
}

const errors = validateOpenApiSnapshot(parsed)
if (errors.length > 0) {
  console.error("Invalid OpenAPI snapshot:")
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log("OpenAPI snapshot is valid")
