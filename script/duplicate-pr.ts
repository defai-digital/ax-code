#!/usr/bin/env -S npx tsx

import path from "path"
import { pathToFileURL } from "url"
import { existsSync } from "fs"
import { parseArgs } from "util"

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string", short: "f" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Usage: pnpm exec tsx script/duplicate-pr.ts [options] <message>

Options:
  -f, --file <path>   File to attach to the prompt
  -h, --help          Show this help message

Examples:
  pnpm exec tsx script/duplicate-pr.ts -f pr_info.txt "Check the attached file for PR details"
`)
    process.exit(0)
  }

  const message = positionals.join(" ")
  if (!message) {
    console.error("Error: message is required")
    process.exit(1)
  }

  const { createAxCode } = await import("@ax-code/sdk/v2")
  const ax = await createAxCode({ port: 0 })

  try {
    const parts: Array<{ type: "text"; text: string } | { type: "file"; url: string; filename: string; mime: string }> =
      []

    if (values.file) {
      const resolved = path.resolve(process.cwd(), values.file)
      if (!existsSync(resolved)) {
        console.error(`Error: file not found: ${values.file}`)
        process.exit(1)
      }
      parts.push({
        type: "file",
        url: pathToFileURL(resolved).href,
        filename: path.basename(resolved),
        mime: "text/plain",
      })
    }

    parts.push({ type: "text", text: message })

    const session = await ax.client.session.create()
    const result = await ax.client.session
      .prompt({
        path: { id: session.data!.id },
        body: {
          agent: "duplicate-pr",
          parts,
        },
        signal: AbortSignal.timeout(120_000),
      })
      .then((x) => x.data?.parts?.find((y) => y.type === "text")?.text ?? "")

    console.log(result.trim())
  } finally {
    ax.server.close()
  }
}

main()
