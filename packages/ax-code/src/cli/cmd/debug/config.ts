import { EOL } from "os"
import { bootstrapReadonly } from "../../bootstrap"
import { cmd } from "../cmd"
import { redactConfig } from "./redact-config"

export const ConfigCommand = cmd({
  command: "config",
  describe: "show resolved configuration with credentials and executable configuration redacted",
  builder: (yargs) => yargs,
  async handler() {
    const { Config } = await import("../../../config/config")
    await bootstrapReadonly(process.cwd(), async () => {
      const config = await Config.get()
      process.stdout.write(JSON.stringify(redactConfig(config), null, 2) + EOL)
    })
  },
})
