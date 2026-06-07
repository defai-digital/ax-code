import { EOL } from "os"
import type { Argv } from "yargs"
import { Capability } from "../../capability"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"

export function formatCapabilityList(capabilities: Capability.Info[]) {
  if (capabilities.length === 0) return `No capabilities found.${EOL}`

  return capabilities
    .map((capability) => {
      const source = [capability.sourceTool, capability.scope].filter(Boolean).join("/")
      const suffix = source ? `  ${source}` : ""
      const status = capability.warnings?.length ? "warn" : "ok"
      return `${status.padEnd(4)}  ${capability.kind.padEnd(8)}  ${capability.name.padEnd(32)}${suffix}`
    })
    .join(EOL)
    .concat(EOL)
}

const CapabilityListCommand = cmd({
  command: "list",
  describe: "list reusable commands, skills, agents, and workflow templates",
  builder: (yargs: Argv) =>
    yargs
      .option("json", {
        type: "boolean",
        describe: "output machine-readable JSON",
      })
      .option("file", {
        type: "array",
        describe: "file paths used to mark path-matching skills as recommended",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const capabilities = await Capability.list({
        filePaths: (args.file as string[] | undefined)?.map(String),
      })
      if (args.json) {
        process.stdout.write(JSON.stringify(capabilities, null, 2) + EOL)
        return
      }
      process.stdout.write(formatCapabilityList(capabilities))
    })
  },
})

export const CapabilityCommand = cmd({
  command: "capability",
  describe: "list reusable AX Code capabilities",
  builder: (yargs: Argv) => yargs.command(CapabilityListCommand).demandCommand(),
  async handler() {},
})
