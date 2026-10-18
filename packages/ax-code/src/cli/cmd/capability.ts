import { EOL } from "os"
import type { Argv } from "yargs"
import type { Capability } from "../../capability"
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
      .option("path", {
        type: "string",
        array: true,
        nargs: 1,
        describe: "file paths used to mark path-matching skills as recommended",
      }),
  async handler(args) {
    const { bootstrapReadonly } = await import("../bootstrap")
    await bootstrapReadonly(process.cwd(), async () => {
      const { Capability } = await import("../../capability")
      const capabilities = await Capability.list({
        filePaths: (args.path as string[] | undefined)?.map(String),
        // One-shot inventory must not spawn MCP children; HTTP /capability keeps the default.
        mcp: false,
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
