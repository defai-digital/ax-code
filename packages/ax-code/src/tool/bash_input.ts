import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash_input.txt"
import { BackgroundShell } from "./bash-background"

export const BashInputTool = Tool.define("bash_input", {
  description: DESCRIPTION,
  parameters: z.object({
    shell_id: z.string().describe("The background shell ID returned by bash run_in_background."),
    input: z
      .string()
      .describe("Text to write to the shell's stdin. May be empty only when eof is true (to just close stdin)."),
    eof: z
      .boolean()
      .describe(
        "Close the shell's stdin after writing, signaling end-of-input. Commands that read until EOF (e.g. cat) will then finish.",
      )
      .optional(),
  }),
  async execute(params, ctx) {
    if (params.input.length === 0 && params.eof !== true) {
      throw new Error(
        "input is empty and eof is not set — nothing to write. Pass non-empty input, or set eof: true to just close the shell's stdin.",
      )
    }
    // No permission ask: the shell was approved when it was spawned with
    // bash run_in_background, and stdin writes stay inside that grant.
    const info = await BackgroundShell.write(params.shell_id, ctx.sessionID, params.input, { eof: params.eof })
    return {
      title: info.description,
      metadata: { shell: info },
      output:
        `Wrote ${params.input.length} character(s) to shell ${info.id}` +
        `${params.eof === true ? " and closed its stdin (EOF)" : ""}. ` +
        `Shell status: ${info.status}. Use bash_output with shell_id "${info.id}" to read its reaction.`,
    }
  },
})
