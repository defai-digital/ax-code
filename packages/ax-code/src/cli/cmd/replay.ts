import type { Argv } from "yargs"
import { SessionID } from "../../session/schema"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { Replay } from "../../replay/replay"
import { EventQuery } from "../../replay/query"
import { EOL } from "os"

export const ReplayCommand = cmd({
  command: "replay <sessionID>",
  describe: "inspect a recorded session event log",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session ID to inspect",
        type: "string",
        demandOption: true,
      })
      .option("mode", {
        describe: "inspection mode",
        choices: ["verify", "check", "summary", "reconstruct", "compare", "export", "execute"] as const,
        default: "summary" as const,
      })
      .option("from-step", {
        describe: "start reconstruction from this step index (R7: partial replay)",
        type: "number",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sid = SessionID.make(args.sessionID)
      const count = EventQuery.count(sid)

      if (count === 0) {
        process.stderr.write(`No events found for session ${args.sessionID}${EOL}`)
        process.exit(1)
      }

      const mode = args.mode === "check" ? ("verify" as const) : args.mode

      if (mode === "execute") {
        const fromStep = args["from-step"] ?? args.fromStep
        process.stderr.write(`Preparing replay execution for session ${args.sessionID}${EOL}`)
        const { steps, stream } = Replay.prepareExecution(sid, { fromStep })
        process.stderr.write(`Reconstructed ${steps.length} steps — ready for processor execution${EOL}`)
        process.stderr.write(`Stream prepared (use programmatically with LLM.stream mock)${EOL}`)
        // Output the steps summary
        for (const step of steps) {
          const parts = step.parts.map((p) => p.type).join(", ")
          process.stdout.write(`Step #${step.stepIndex}: ${parts} → ${step.finishReason}${EOL}`)
        }
        // Run comparison against original
        const { divergences, stepsCompared } = Replay.compare(sid)
        process.stdout.write(`${EOL}Comparison: ${stepsCompared} steps, ${divergences.length} divergences${EOL}`)
        if (divergences.length > 0) {
          for (const div of divergences) process.stdout.write(`  ${div.reason}${EOL}`)
          process.exit(1)
        }
        return
      }

      if (mode === "export") {
        process.stderr.write(`Exporting replay package for session ${args.sessionID}${EOL}`)
        const events = EventQuery.bySession(sid)
        const session = await Session.get(sid).catch(() => undefined)
        const { steps } = Replay.reconstructStream(sid)
        const pkg = {
          version: 1,
          sessionID: sid,
          session: session ? { directory: session.directory, title: session.title } : undefined,
          totalEvents: events.length,
          totalSteps: steps.length,
          events,
          steps,
        }
        process.stdout.write(JSON.stringify(pkg, null, 2) + EOL)
        process.stderr.write(`Exported ${events.length} events, ${steps.length} steps${EOL}`)
        return
      }

      if (mode === "compare") {
        process.stderr.write(`Comparing reconstructed replay against original for session ${args.sessionID}${EOL}`)
        const { divergences, stepsCompared } = Replay.compare(sid)
        process.stdout.write(`Steps compared: ${stepsCompared}${EOL}`)
        process.stdout.write(`Divergences:    ${divergences.length}${EOL}`)
        for (const div of divergences) {
          process.stdout.write(`  #${div.sequence}: ${div.reason}${EOL}`)
        }
        if (divergences.length > 0) process.exit(1)
        return
      }

      if (mode === "reconstruct") {
        const fromStep = args["from-step"] ?? args.fromStep
        process.stderr.write(
          `Reconstructing stream for session ${args.sessionID}${fromStep !== undefined ? ` from step ${fromStep}` : ""}${EOL}${EOL}`,
        )
        const { steps } = Replay.reconstructStream(sid, { fromStep })
        for (const step of steps) {
          process.stdout.write(`Step #${step.stepIndex} (${step.finishReason}, ${step.parts.length} parts)${EOL}`)
          for (const part of step.parts) {
            if (part.type === "text")
              process.stdout.write(`  [text] ${part.text.slice(0, 200)}${part.text.length > 200 ? "..." : ""}${EOL}`)
            if (part.type === "reasoning")
              process.stdout.write(
                `  [reasoning] ${part.text.slice(0, 200)}${part.text.length > 200 ? "..." : ""}${EOL}`,
              )
            if (part.type === "tool_call") process.stdout.write(`  [tool_call] ${part.tool} id=${part.callID}${EOL}`)
          }
          for (const tr of step.toolResults) {
            process.stdout.write(`  [tool_result] ${tr.tool} ${tr.status}${EOL}`)
          }
        }
        process.stdout.write(`${EOL}${steps.length} step(s) reconstructed${EOL}`)
        return
      }

      if (mode === "summary") {
        process.stderr.write(`Session ${args.sessionID} — ${count} events${EOL}${EOL}`)
        const lines = Replay.summary(sid)
        for (const line of lines) {
          process.stdout.write(line + EOL)
        }
        return
      }

      process.stderr.write(`Checking event log consistency for session ${args.sessionID} — ${count} events${EOL}`)

      const result = Replay.run({
        sessionID: sid,
        mode,
        onDivergence: (div) => {
          process.stderr.write(`  DIVERGENCE at #${div.sequence}: ${div.reason}${EOL}`)
        },
      })

      process.stdout.write(EOL)
      process.stdout.write(`Total events:  ${result.totalEvents}${EOL}`)
      process.stdout.write(`Steps:         ${result.steps}${EOL}`)
      process.stdout.write(`Tool calls:    ${result.toolCalls}${EOL}`)
      process.stdout.write(`Divergences:   ${result.divergences.length}${EOL}`)

      if (result.divergences.length > 0) {
        process.exit(1)
      }
    })
  },
})
