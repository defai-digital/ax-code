#!/usr/bin/env bun
import { fileURLToPath } from "url"
import fs from "fs/promises"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const tmp = path.join(dir, ".tmp", "xdg")

try {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true })
  await fs.mkdir(path.join(tmp, "config"), { recursive: true })
  await fs.mkdir(path.join(tmp, "cache"), { recursive: true })
  await fs.mkdir(path.join(tmp, "state"), { recursive: true })

  await $`bun dev generate > ${dir}/openapi.json`
    .cwd(path.resolve(dir, "../../ax-code"))
    .env({
      ...process.env,
      XDG_DATA_HOME: path.join(tmp, "data"),
      XDG_CONFIG_HOME: path.join(tmp, "config"),
      XDG_CACHE_HOME: path.join(tmp, "cache"),
      XDG_STATE_HOME: path.join(tmp, "state"),
    })

  await createClient({
    input: "./openapi.json",
    output: {
      path: "./src/v2/gen",
      tsConfigPath: path.join(dir, "tsconfig.json"),
      clean: true,
    },
    plugins: [
      {
        name: "@hey-api/typescript",
        exportFromIndex: false,
      },
      {
        name: "@hey-api/sdk",
        instance: "OpencodeClient",
        exportFromIndex: false,
        auth: false,
        paramsStructure: "flat",
      },
      {
        name: "@hey-api/client-fetch",
        exportFromIndex: false,
        baseUrl: "http://localhost:4096",
      },
    ],
  })

  await $`bun prettier --write src/gen`
  await $`bun prettier --write src/v2`
  await $`rm -rf dist`
  await $`bun tsc`
  await $`rm openapi.json`
} finally {
  await fs.rm(path.join(dir, ".tmp"), { recursive: true, force: true })
}
