// ADR-246: `ax-code providers auth export` and `ax-code providers auth import`.
//
// Export walks the auth store, builds a shareable envelope that contains ONLY
// reference data (profile names, project ids, subscription ids) and a
// placeholder summary for any secret-bearing entry (api / oauth / wellknown).
// The envelope never carries a key, refresh, access, or token.
//
// Import reads an envelope, plans the changes, and applies them only with
// `--write`. The default mode is dry-run: `ax-code providers auth import --input-file
// path.json` prints the would-be `willCreate` and `willSkip` lists and exits
// 0 without writing. Existing connections are never overwritten; secret
// placeholders cannot be re-created (the user must re-login instead).

import { Auth } from "../../auth"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"

function defaultExportPath() {
  return path.join(process.cwd(), "ax-code-auth-export.json")
}

export async function runExport(args: { file?: string }) {
  const { envelope } = await Auth.exportEnvelope()
  const target = args.file ?? defaultExportPath()
  await Filesystem.write(target, JSON.stringify(envelope, null, 2))
  const count = Object.keys(envelope.providers).length
  prompts.log.success(`Wrote ${count} provider entr${count === 1 ? "y" : "ies"} to ${target}`)
  prompts.log.info(
    "Envelope contains reference data only. Secret-bearing entries (api/oauth/wellknown) are summarized as placeholders.",
  )
  prompts.outro("Done")
}

export async function runImport(args: { file?: string; write?: boolean; yes?: boolean }) {
  const file = args.file
  if (!file) {
    prompts.log.error("Missing --input-file <path>. `ax-code providers auth import --input-file path.json`")
    process.exitCode = 2
    return
  }
  let parsed: unknown
  try {
    // readJson parses with the repository's safe JSON helper; the file holds the exported envelope object.
    parsed = await Filesystem.readJson<unknown>(file)
  } catch (cause) {
    prompts.log.error(`Could not read ${file}: ${(cause as Error).message ?? String(cause)}`)
    process.exitCode = 1
    return
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
    prompts.log.error("Envelope must be version 1 (from `ax-code providers auth export`).")
    process.exitCode = 1
    return
  }
  const envelope = parsed as Auth.ExportEnvelope
  const plan = await Auth.planImport(envelope)
  const header = args.write ? "Import plan (will apply)" : "Import plan (dry-run; pass --write to apply)"
  prompts.log.info(header)
  prompts.log.info(`  willCreate (${plan.willCreate.length}): ${plan.willCreate.join(", ") || "(none)"}`)
  prompts.log.info(`  willSkip (${plan.willSkip.length}):`)
  for (const skipped of plan.willSkip) prompts.log.info(`    - ${skipped.providerID}: ${skipped.reason}`)

  if (!args.write) {
    prompts.outro("Done (dry-run)")
    return
  }
  if (plan.willCreate.length === 0) {
    prompts.outro("Nothing to import")
    return
  }
  if (!args.yes && process.stdin.isTTY) {
    const answer = await prompts.confirm({
      message: `Apply import? (will create ${plan.willCreate.length} reference${plan.willCreate.length === 1 ? "" : "s"})`,
    })
    if (prompts.isCancel(answer) || !answer) throw new UI.CancelledError()
  }
  const { created, skipped } = await Auth.applyImport(envelope, plan)
  prompts.log.success(`Created ${created.length} reference${created.length === 1 ? "" : "s"}`)
  for (const id of created) prompts.log.info(`  - ${id}`)
  if (skipped.length) {
    prompts.log.info(`Skipped ${skipped.length}:`)
    for (const s of skipped) prompts.log.info(`  - ${s.providerID}: ${s.reason}`)
  }
  prompts.outro("Done")
}

export const ProvidersAuthCommand = cmd({
  command: "auth <action>",
  describe: "export or import a shareable (non-secret) provider reference envelope",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "action to run",
        choices: ["export", "import"] as const,
      })
      .option("input-file", {
        describe: "provider reference envelope to import",
        type: "string",
      })
      .option("output-file", {
        alias: "o",
        describe: "export destination (default: ./ax-code-auth-export.json)",
        type: "string",
      })
      .option("write", {
        describe: "apply the import (default: dry-run)",
        type: "boolean",
        default: false,
      })
      .option("yes", {
        describe: "skip the confirmation prompt when --write is set",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    const action = args.action
    if (action === "export" && args["input-file"] !== undefined)
      throw new Error("--input-file is only valid for import")
    if (action === "import" && args["output-file"] !== undefined)
      throw new Error("--output-file is only valid for export")
    if (action === "export") {
      await runExport({ file: args["output-file"] })
      return
    }
    if (action === "import") {
      await runImport({ file: args["input-file"], write: args.write, yes: args.yes })
      return
    }
  },
})
