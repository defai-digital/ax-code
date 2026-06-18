import type { Argv } from "yargs"
import { cmd } from "../cmd"
import { bootstrap } from "../../bootstrap"
import { EOL } from "os"
import { Filesystem } from "../../../util/filesystem"
import { toErrorMessage } from "../../../util/error-message"
import type { SessionTransfer } from "./transfer"
import { writeTransfer } from "./transfer"
import z from "zod"

const TransferRecord = z.object({ id: z.string().min(1) }).passthrough()
const TransferEvent = z
  .object({
    id: z.string().optional(),
    stepID: z.string().optional(),
    sequence: z.number(),
    timeCreated: z.number(),
    event: z.object({ type: z.string().min(1) }).passthrough(),
  })
  .passthrough()
const SessionTransferFile = z
  .object({
    info: TransferRecord,
    messages: z.array(
      z
        .object({
          info: TransferRecord,
          parts: z.array(z.unknown()),
        })
        .passthrough(),
    ),
    events: z.array(TransferEvent).optional(),
  })
  .passthrough()

function formatTransferFileIssue(error: z.ZodError) {
  const issue = error.issues[0]
  if (!issue) return "unknown schema error"
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>"
  return `${path}: ${issue.message}`
}

export async function readSessionTransferFile(file: string): Promise<
  | {
      data: SessionTransfer
      error?: undefined
    }
  | {
      data?: undefined
      error: string
    }
> {
  try {
    const raw = await Filesystem.readJson<unknown>(file)
    const parsed = SessionTransferFile.safeParse(raw)
    if (!parsed.success) {
      return { error: `Invalid session transfer file ${file}: ${formatTransferFileIssue(parsed.error)}` }
    }
    return { data: parsed.data as SessionTransfer }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
    if (code === "ENOENT") {
      return { error: `File not found: ${file}` }
    }
    const message = toErrorMessage(error)
    return { error: `Failed to read ${file}: ${message}` }
  }
}

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from a JSON file",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to session JSON file",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await readSessionTransferFile(args.file)
      if (result.error) {
        process.stdout.write(result.error)
        process.stdout.write(EOL)
        return
      }

      const exportData = result.data
      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        return
      }

      writeTransfer(exportData)

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
