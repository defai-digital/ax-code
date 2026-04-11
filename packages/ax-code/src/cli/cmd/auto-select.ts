import { EOL } from "os"
import { cmd } from "./cmd"
import { RunCommand } from "./run"
import { Instance } from "../../project/instance"
import { SessionBranchRank } from "../../session/branch"
import { SessionID } from "../../session/schema"

type RunArgs = Parameters<NonNullable<typeof RunCommand.handler>>[0]

export namespace AutoSelect {
  export function apply(input: { message?: string[]; command?: string }) {
    return (input.message?.length ?? 0) > 0 || !!input.command
  }

  export function runArgs(input: {
    sessionID: string
    message?: string[]
    command?: string
    file?: string[]
    model?: string
    agent?: string
    format?: "default" | "json"
    dir?: string
    variant?: string
    thinking?: boolean
  }): RunArgs {
    return {
      _: [],
      $0: "ax-code",
      message: input.message ?? [],
      command: input.command,
      continue: false,
      session: input.sessionID,
      fork: false,
      share: false,
      model: input.model,
      agent: input.agent,
      format: input.format ?? "default",
      file: input.file,
      title: undefined,
      attach: undefined,
      password: undefined,
      dir: input.dir,
      port: undefined,
      variant: input.variant,
      thinking: input.thinking ?? false,
      "--": [],
    }
  }

  export async function handoff(
    input: Parameters<typeof runArgs>[0],
    deps: { run?: NonNullable<typeof RunCommand.handler> } = {},
  ) {
    const run = deps.run ?? RunCommand.handler
    if (!run) throw new Error("run handler unavailable")
    return run(runArgs(input))
  }
}

export const AutoSelectCommand = cmd({
  command: "auto-select <sessionID> [message..]",
  describe: "recommend the best branch in a session family",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "Session in the branch family", type: "string", demandOption: true })
      .positional("message", {
        describe: "message to send to the recommended branch",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "command to run on the recommended branch, using message as arguments",
        type: "string",
      })
      .option("agent", {
        describe: "agent to use when applying the recommendation",
        type: "string",
      })
      .option("model", {
        describe: "model to use in the format of provider/model when applying the recommendation",
        type: "string",
      })
      .option("format", {
        describe: "format for apply mode: default or json event stream",
        type: "string",
        choices: ["default", "json"],
        default: "default",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach when applying the recommendation",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run the follow-up prompt in",
      })
      .option("variant", {
        type: "string",
        describe: "model variant for apply mode",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show reasoning blocks in apply mode",
        default: false,
      })
      .option("deep", {
        describe: "Include replay divergence signals in branch comparison",
        type: "boolean",
        default: false,
      })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const ranked = await SessionBranchRank.family(sessionID, { deep: args.deep })
        const next = AutoSelect.apply({
          message: args.message as string[],
          command: args.command as string | undefined,
        })

        if (args.json && next) {
          throw new Error("--json cannot be combined with apply mode; use --format json for event output")
        }

        if (args.json) {
          console.log(
            JSON.stringify(
              {
                root: { id: ranked.root.id, title: ranked.root.title },
                current: { id: ranked.current.id, title: ranked.current.title },
                recommended: {
                  id: ranked.recommended.id,
                  title: ranked.recommended.title,
                  confidence: ranked.confidence,
                  reasons: ranked.reasons,
                  decision: ranked.recommended.decision,
                  semantic: ranked.recommended.semantic,
                },
                sessions: ranked.items.map((item, idx) => ({
                  rank: idx + 1,
                  id: item.id,
                  title: item.title,
                  current: item.current,
                  recommended: item.recommended,
                  risk: item.risk,
                  decision: item.decision,
                  semantic: item.semantic,
                  plan: item.view.plan,
                  notes: item.view.notes,
                })),
              },
              null,
              2,
            ),
          )
          return
        }

        if (next) {
          if (args.format === "json") {
            process.stdout.write(
              JSON.stringify({
                type: "auto_select",
                sessionID: ranked.recommended.id,
                currentID: ranked.current.id,
                confidence: ranked.confidence,
                reasons: ranked.reasons,
                semantic: ranked.recommended.semantic,
              }) + EOL,
            )
          } else {
            console.log("\n  Auto Select Apply")
            console.log("  " + "=".repeat(50))
            console.log("")
            console.log(`  Selected: ${ranked.recommended.id}`)
            console.log(`            ${ranked.recommended.title}`)
            if (ranked.recommended.semantic)
              console.log(`            ${ranked.recommended.semantic.headline} (${ranked.recommended.semantic.risk})`)
            console.log(`            confidence ${ranked.confidence}`)
            console.log("")
          }

          await AutoSelect.handoff({
            sessionID: ranked.recommended.id,
            message: args.message as string[],
            command: args.command as string | undefined,
            file: args.file as string[] | undefined,
            model: args.model as string | undefined,
            agent: args.agent as string | undefined,
            format: args.format as "default" | "json",
            dir: args.dir as string | undefined,
            variant: args.variant as string | undefined,
            thinking: args.thinking as boolean | undefined,
          })
          return
        }

        console.log("\n  Auto Select")
        console.log("  " + "=".repeat(50))
        console.log("")
        console.log(`  Root: ${ranked.root.id}`)
        console.log(`        ${ranked.root.title}`)
        console.log("")
        console.log(`  Current: ${ranked.current.id}`)
        console.log(`           ${ranked.current.title}`)
        console.log("")
        console.log(`  Recommended: ${ranked.recommended.id}`)
        console.log(`               ${ranked.recommended.title}`)
        console.log(`               ${ranked.recommended.headline}`)
        if (ranked.recommended.semantic)
          console.log(`               ${ranked.recommended.semantic.headline} (${ranked.recommended.semantic.risk})`)
        console.log(`               confidence ${ranked.confidence}`)
        for (const reason of ranked.reasons) {
          console.log(`               - ${reason}`)
        }
        console.log("")
        console.log(`  Continue with: ax-code run --session ${ranked.recommended.id} "your next prompt"`)
        console.log("")
      },
    })
  },
})
