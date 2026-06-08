import type { Argv } from "yargs"
import { cmd } from "../cmd"
import { bootstrap } from "../../bootstrap"
import { EOL } from "os"
import { Filesystem } from "../../../util/filesystem"
import type { SessionTransfer } from "./transfer"
import { writeTransfer } from "./transfer"

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
    return { data: await Filesystem.readJson<SessionTransfer>(file) }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
    if (code === "ENOENT") {
      return { error: `File not found: ${file}` }
    }
    const message = error instanceof Error ? error.message : String(error)
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
