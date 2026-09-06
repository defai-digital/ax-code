import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash_output.txt"
import { BackgroundShell } from "./bash-background"
import { ToolNumber } from "./schema"
import { formatDuration } from "../util/format"

function formatStatus(info: BackgroundShell.Info) {
  const exit = info.exitCode === null ? "" : ` (exit ${info.exitCode})`
  return `${info.status}${exit}`
}

export const BashOutputTool = Tool.define("bash_output", {
  description: DESCRIPTION,
  parameters: z.object({
    shell_id: z
      .string()
      .describe("The background shell ID returned by bash run_in_background. Omit to list all background shells.")
      .optional(),
    filter: z
      .string()
      .describe(
        "Optional regular expression; only output lines matching it are returned. Non-matching lines are still consumed and will not be returned by later calls.",
      )
      .optional(),
    timeout_ms: ToolNumber(z.number().int().min(0).max(120_000))
      .describe("How long to wait for new output or exit before returning, from 0 to 120000 ms. Default 30000.")
      .optional(),
  }),
  async execute(params, ctx) {
    type Metadata = {
      shells?: BackgroundShell.Info[]
      shell?: BackgroundShell.Info
      dropped?: boolean
      elapsedMs?: number
    }
    if (params.shell_id === undefined) {
      const shells = BackgroundShell.list(ctx.sessionID)
      if (shells.length === 0) {
        const metadata: Metadata = { shells: [] }
        return {
          title: "background shells",
          metadata,
          output: "No background shells in this session.",
        }
      }
      const lines = shells.map((s) => `${s.id}: ${formatStatus(s)} — ${s.description} — ${s.command}`)
      const metadata: Metadata = { shells }
      return {
        title: "background shells",
        metadata,
        output: lines.join("\n"),
      }
    }

    const timeoutMs = params.timeout_ms ?? 30_000
    const result = await BackgroundShell.waitAndRead(params.shell_id, ctx.sessionID, {
      timeoutMs,
      signal: ctx.abort,
    })
    if (!result) {
      throw new Error(
        `No background shell with ID "${params.shell_id}" in this session. Call bash_output without shell_id to list available shells.`,
      )
    }

    let filterInvalid: string | undefined
    let output = result.output
    if (params.filter !== undefined && output.length > 0) {
      try {
        const regex = new RegExp(params.filter)
        output = output
          .split("\n")
          .filter((line) => regex.test(line))
          .join("\n")
      } catch {
        filterInvalid = params.filter
      }
    }

    const stillIdle = result.info.status === "running" && result.output.length === 0
    const elapsedMs = Math.max(0, (result.info.endedAt ?? Date.now()) - result.info.startedAt)
    const header = [
      `<status>${formatStatus(result.info)}</status>`,
      `<elapsed>${formatDuration(Math.floor(elapsedMs / 1_000)) || "0s"}</elapsed>`,
      result.dropped ? "<notice>oldest unread output was dropped (buffer limit)</notice>" : "",
      filterInvalid !== undefined
        ? `<notice>invalid filter regex ${JSON.stringify(filterInvalid)}; returning unfiltered output</notice>`
        : "",
      stillIdle
        ? `<notice>still running after waiting ${timeoutMs}ms with no new output. Silence does not indicate how much work remains. Continue other work or wait again with timeout_ms up to 120000; avoid repeated non-blocking polls.</notice>`
        : "",
    ]
      .filter(Boolean)
      .join("\n")

    const metadata: Metadata = { shell: result.info, dropped: result.dropped, elapsedMs }
    return {
      title: result.info.description,
      metadata,
      output: output.length > 0 ? `${header}\n<output>\n${output}\n</output>` : `${header}\n(no new output)`,
    }
  },
})
