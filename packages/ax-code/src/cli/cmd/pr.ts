import type { Argv } from "yargs"

export const PrCommand = {
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR Branch, then run ax-code",
  builder: (yargs: Argv) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  handler: async (args: any) => {
    const { PrCommand: real } = await import("./github-agent/pr")
    return real.handler(args)
  },
}
