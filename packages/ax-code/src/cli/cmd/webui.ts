import type { Argv } from "yargs"
import { launchWebUi, runWebUiDesktopCommand } from "@/desktop/webui"
import { cmd } from "./cmd"

type WebUiAction = "start" | "status" | "stop" | "logs"

export const WebUiCommand = cmd({
  command: "webui [action]",
  describe: "open or manage the AX Code Desktop browser UI",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "action to run",
        choices: ["start", "status", "stop", "logs"] as const,
        default: "start",
      })
      .option("port", {
        describe: "preferred browser UI port; conflicts fail when explicit",
        type: "number",
      })
      .option("ui-password", {
        describe: "protect the browser UI with a single password",
        type: "string",
      })
      .option("open", {
        describe: "open the browser automatically",
        type: "boolean",
        default: true,
      }),
  handler: async (args) => {
    const action = (args.action ?? "start") as WebUiAction
    if (action !== "start") {
      await runWebUiDesktopCommand(action)
      return
    }

    const result = await launchWebUi({
      port: typeof args.port === "number" ? args.port : undefined,
      uiPassword: typeof args.uiPassword === "string" ? args.uiPassword : undefined,
      openBrowser: args.open !== false,
    })
    console.log(result.message)
  },
})
