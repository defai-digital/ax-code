import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { SessionRevert } from "../../session/revert"
import { Risk } from "../../risk/score"
import { ExecutionGraph } from "../../graph"

export const RollbackCommand = cmd({
  command: "rollback <sessionID>",
  describe: "rollback file changes from a session",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "Session to rollback", type: "string", demandOption: true })
      .option("dry-run", {
        describe: "Show what would be rolled back without applying",
        type: "boolean",
        default: false,
      })
      .option("force", { describe: "Skip confirmation", type: "boolean", default: false })
      .option("list", {
        describe: "Show available rollback points from the execution graph",
        type: "boolean",
        default: false,
      })
      .option("step", { describe: "Rollback to a specific step index instead of the full session", type: "number" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const session = await Session.get(sessionID)
        const risk = Risk.fromSession(sessionID)

        console.log(`\nSession: ${sessionID}`)
        console.log(`Title: ${session.title}`)
        console.log(`Risk: ${risk.level} (${risk.score}/100)`)

        // --list: show rollback points from execution graph
        if (args.list) {
          const graph = ExecutionGraph.build(sessionID)
          const stepNodes = graph.nodes
            .filter((n) => n.type === "step")
            .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))

          if (stepNodes.length === 0) {
            console.log("\nNo steps found in session.")
            return
          }

          console.log(`\nRollback points (${stepNodes.length} steps):`)
          for (const node of stepNodes) {
            const dur = node.duration != null ? ` (${node.duration}ms)` : ""
            const tok = node.tokens ? ` tokens: ${node.tokens.input}/${node.tokens.output}` : ""
            // Find tools used in this step
            const childIDs = graph.edges
              .filter((e) => e.from === node.id && e.type === "step_contains")
              .map((e) => e.to)
            const toolCalls = childIDs
              .map((id) => graph.nodes.find((n) => n.id === id))
              .filter((n) => n?.type === "tool_call")
              .map((n) => n!.label)
            const toolSummary = toolCalls.length > 0 ? ` [${toolCalls.join(", ")}]` : ""
            console.log(`  Step #${node.stepIndex}${dur}${tok}${toolSummary}`)
          }
          console.log(`\nUsage: ax-code rollback ${sessionID} --step <N>`)
          return
        }

        const diff = await Session.diff(sessionID)

        if (!diff || diff.length === 0) {
          console.log("\nNo file changes to rollback.")
          return
        }

        console.log(`\nFiles to rollback (${diff.length}):`)
        for (const d of diff) {
          const status =
            d.status === "added" ? "\x1b[32m+\x1b[0m" : d.status === "deleted" ? "\x1b[31m-\x1b[0m" : "\x1b[33m~\x1b[0m"
          console.log(`  ${status} ${d.file} (+${d.additions} -${d.deletions})`)
        }

        if (args.dryRun) {
          console.log("\n(dry run — no changes applied)")
          return
        }

        if (!args.force) {
          const readline = await import("readline")
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
          const answer = await new Promise<string>((resolve) => {
            rl.question("\nProceed with rollback? (y/N) ", resolve)
          })
          rl.close()
          if (answer.toLowerCase() !== "y") {
            console.log("Cancelled.")
            return
          }
        }

        const msgs = await Session.messages({ sessionID })
        if (msgs.length === 0) {
          console.log("No messages in session.")
          return
        }

        // --step: find the message/part boundary for the target step
        if (args.step != null) {
          const target = args.step as number
          // Walk assistant messages to find the part corresponding to step boundary
          for (const msg of msgs) {
            if (msg.info.role !== "assistant") continue
            for (const part of msg.parts) {
              if (part.type === "step-start" && "stepIndex" in part) {
                const partAny = part as unknown as { stepIndex?: number }
                if (partAny.stepIndex === target) {
                  await SessionRevert.revert({
                    sessionID,
                    messageID: msg.info.id,
                    partID: part.id,
                  })
                  await SessionRevert.cleanup(session)
                  console.log(`\n\x1b[32mRolled back to step #${target}.\x1b[0m`)
                  return
                }
              }
            }
          }
          console.log(`\nStep #${target} not found. Use --list to see available steps.`)
          return
        }

        // Default: rollback entire session (revert to before first assistant message)
        const firstAssistant = msgs.find((m) => m.info.role === "assistant")
        if (!firstAssistant) {
          console.log("No assistant messages to rollback.")
          return
        }

        await SessionRevert.revert({
          sessionID,
          messageID: firstAssistant.info.id,
        })
        await SessionRevert.cleanup(session)

        console.log(`\n\x1b[32mRolled back ${diff.length} files.\x1b[0m`)
      },
    })
  },
})
