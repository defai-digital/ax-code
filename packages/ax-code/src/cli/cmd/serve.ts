import type { Argv } from "yargs"
import { withNetworkOptions } from "../network"

export const ServeCommand = {
  command: "serve",
  describe: "starts a headless ax-code server",
  builder: (yargs: Argv) =>
    withNetworkOptions(yargs).option("ipc-socket", {
      type: "string",
      describe: "path to a Unix domain socket for the local IPC transport",
    }),
  handler: async (args: any) => {
    const { ServeCommand: real } = await import("./runtime/serve")
    return real.handler(args)
  },
}
