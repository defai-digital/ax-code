import { Provider } from "@/provider/provider"
import { askFixedContext } from "@/provider/fixed-context-operation"
import { validateFixedContextQuestion } from "@/provider/fixed-context"
import { bootstrapReadonly } from "../bootstrap"
import { cmd } from "./cmd"

export const AskCommand = cmd({
  command: "ask <question..>",
  describe: "ask about selected files with AX Trust fixed-context caching",
  builder: (yargs) =>
    yargs
      .positional("question", {
        type: "string",
        array: true,
        demandOption: true,
        describe: "question answered only from the selected files",
      })
      .option("file", {
        alias: "f",
        type: "string",
        array: true,
        nargs: 1,
        demandOption: true,
        describe: "context file inside the current directory (repeatable)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        demandOption: true,
        describe: "connected AX Trust model in provider/model format",
      })
      .option("max-tokens", { type: "number", default: 512, describe: "maximum answer tokens (1 through 4096)" })
      .option("format", {
        type: "string",
        choices: ["text", "json"] as const,
        default: "text",
        describe: "answer output format",
      }),
  async handler(args) {
    const question = args.question.join(" ")
    validateFixedContextQuestion(question)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    process.once("SIGINT", cancel)
    process.once("SIGTERM", cancel)
    try {
      await bootstrapReadonly(process.cwd(), async () => {
        const selected = Provider.parseModel(args.model)
        const output = await askFixedContext(
          { ...selected, files: args.file, question, maxTokens: args.maxTokens },
          process.cwd(),
          controller.signal,
        )
        if (args.format === "json") process.stdout.write(JSON.stringify(output) + "\n")
        else {
          process.stdout.write(output.answer + "\n")
          process.stderr.write(`AX Trust cache: ${output.cache.status}\n`)
        }
      })
    } finally {
      process.off("SIGINT", cancel)
      process.off("SIGTERM", cancel)
    }
  },
})
