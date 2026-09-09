import fs from "node:fs/promises"
import type { Argv } from "yargs"
import { SkillCandidate } from "@/skill/candidate"
import { parseJsonStrict } from "@/util/json-value"
import { bootstrapReadonly } from "../bootstrap"
import { cmd } from "./cmd"

export const SkillCandidateCommand = cmd({
  command: "candidate <action> [name]",
  describe: "propose, independently validate, promote or retire an evidence-backed skill",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["propose", "validate", "promote", "retire", "show"],
        demandOption: true,
      })
      .positional("name", { type: "string", describe: "candidate name (propose reads the name from its JSON file)" })
      .option("file", {
        type: "string",
        describe: "JSON proposal for propose, or sessionID/messageID/partID evidence for validate",
      }),
  async handler(args) {
    // Candidate operations need canonical storage, not interactive model warmups.
    await bootstrapReadonly(process.cwd(), async () => {
      const action = args.action
      let input: unknown
      if (action === "propose" || action === "validate") {
        if (!args.file) throw new Error("--file is required for proposal or validation")
        const handle = await fs.open(args.file, "r")
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size > 40_000)
            throw new Error("Candidate input must be a regular file of at most 40KB")
          const buffer = Buffer.alloc(40_001)
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          if (bytesRead > 40_000) throw new Error("Candidate input exceeds 40KB")
          input = parseJsonStrict(buffer.subarray(0, bytesRead).toString("utf8"))
        } finally {
          await handle.close()
        }
      }
      if (action !== "propose" && !args.name) throw new Error("Candidate name is required")
      const result =
        action === "propose"
          ? await SkillCandidate.propose(SkillCandidate.Proposal.parse(input))
          : action === "validate"
            ? await SkillCandidate.validate(args.name!, SkillCandidate.Evidence.parse(input))
            : action === "promote"
              ? await SkillCandidate.promote(args.name!)
              : action === "retire"
                ? await SkillCandidate.retire(args.name!)
                : await SkillCandidate.get(args.name!)
      process.stdout.write(JSON.stringify(result, null, 2) + "\n")
    })
  },
})
