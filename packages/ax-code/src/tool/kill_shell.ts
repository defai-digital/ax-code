import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./kill_shell.txt"
import { BackgroundShell } from "./bash-background"

export const KillShellTool = Tool.define("kill_shell", {
  description: DESCRIPTION,
  parameters: z.object({
    shell_id: z.string().describe("The background shell ID returned by bash run_in_background."),
  }),
  async execute(params, ctx) {
    const info = await BackgroundShell.kill(params.shell_id, ctx.sessionID)
    if (!info) {
      throw new Error(
        `No background shell with ID "${params.shell_id}" in this session. Call bash_output without shell_id to list available shells.`,
      )
    }
    return {
      title: info.description,
      metadata: { shell: info },
      output: `Shell ${info.id} ${info.status}${info.exitCode === null ? "" : ` (exit ${info.exitCode})`}. Any remaining output is readable via bash_output.`,
    }
  },
})
