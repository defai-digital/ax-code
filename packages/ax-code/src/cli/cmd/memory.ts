import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { generate } from "../../memory/generator"
import * as store from "../../memory/store"
import { getMetadata } from "../../memory/injector"
import { recordEntry, removeEntry, listEntries } from "../../memory/recorder"
import { recall } from "../../memory/recall"
import type { MemoryEntryKind } from "../../memory/types"

const KIND_BY_FLAG: Record<string, MemoryEntryKind> = {
  user: "userPrefs",
  feedback: "feedback",
  decision: "decisions",
  reference: "reference",
}

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage project memory (pre-cached context)",
  builder: (yargs) =>
    yargs
      .command(MemoryWarmupCommand)
      .command(MemoryStatusCommand)
      .command(MemoryClearCommand)
      .command(MemoryRememberCommand)
      .command(MemoryForgetCommand)
      .command(MemoryListCommand)
      .command(MemoryRecallCommand)
      .demandCommand(),
  async handler() {},
})

export const MemoryWarmupCommand = cmd({
  command: "warmup",
  describe: "scan project and generate cached memory",
  builder: (yargs) =>
    yargs
      .option("max-tokens", {
        describe: "maximum tokens for memory (default: 4000)",
        type: "number",
        default: 4000,
      })
      .option("depth", {
        describe: "directory scan depth (default: 3)",
        type: "number",
        default: 3,
      })
      .option("dry-run", {
        describe: "show what would be cached without saving",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Memory Warmup")

    const spinner = prompts.spinner()
    spinner.start("Scanning project...")

    const memory = await generate(process.cwd(), {
      maxTokens: args.maxTokens,
      depth: args.depth,
    })

    spinner.stop("Scan complete")

    prompts.log.info("Context breakdown:")
    for (const [key, section] of Object.entries(memory.sections)) {
      if (section && section.tokens > 0) {
        prompts.log.info(`  ${key}: ${section.tokens} tokens`)
      }
    }
    prompts.log.info(`  Total: ${memory.totalTokens} tokens`)

    if (args.dryRun) {
      prompts.log.warn("Dry run — nothing saved")
      prompts.outro("Done")
      return
    }

    const savePath = await store.save(process.cwd(), memory)
    prompts.log.success(`Saved to ${savePath}`)
    prompts.outro(`Memory cached: ${memory.totalTokens} tokens`)
  },
})

export const MemoryStatusCommand = cmd({
  command: "status",
  describe: "show current memory status",
  async handler() {
    UI.empty()
    prompts.intro("Memory Status")

    const meta = await getMetadata(process.cwd())
    if (!meta) {
      prompts.log.warn("No memory cached. Run: ax-code memory warmup")
      prompts.outro("Done")
      return
    }

    prompts.log.info(`Tokens: ${meta.totalTokens}`)
    prompts.log.info(`Sections: ${meta.sections.join(", ")}`)
    prompts.log.info(`Last updated: ${meta.lastUpdated}`)
    prompts.log.info(`Hash: ${meta.contentHash}`)
    if (meta.stale) prompts.log.warn("Project scan is over 30 days old. Run: ax-code memory warmup")
    prompts.outro("Done")
  },
})

export const MemoryClearCommand = cmd({
  command: "clear",
  describe: "delete cached memory",
  builder: (yargs) =>
    yargs.option("global", {
      alias: "g",
      describe: "clear global memory (~/.ax-code/memory.json) instead of project memory",
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Clear Memory")

    if (args.global) {
      const exists = await store.existsGlobal()
      if (!exists) {
        prompts.log.warn("No global memory to clear")
        prompts.outro("Done")
        return
      }
      await store.clearGlobal()
      prompts.log.success("Global memory cleared")
      prompts.outro("Done")
      return
    }

    const exists = await store.exists(process.cwd())
    if (!exists) {
      prompts.log.warn("No memory to clear")
      prompts.outro("Done")
      return
    }

    await store.clear(process.cwd())
    prompts.log.success("Memory cleared")
    prompts.outro("Done")
  },
})

export const MemoryRememberCommand = cmd({
  command: "remember",
  describe: "record a user preference, feedback rule, project decision, or reference",
  builder: (yargs) =>
    yargs
      .option("kind", {
        describe: "memory kind",
        choices: ["user", "feedback", "decision", "reference"] as const,
        demandOption: true,
      })
      .option("name", {
        describe: "short name (used to dedupe within kind)",
        type: "string",
        demandOption: true,
      })
      .option("body", {
        describe: "memory body — the rule, preference, decision, or pointer itself",
        type: "string",
        demandOption: true,
      })
      .option("why", { describe: "rationale", type: "string" })
      .option("apply", { describe: "when this applies", type: "string" })
      .option("agents", {
        describe: "comma-separated agent names that should see this entry (default: all)",
        type: "string",
      })
      .option("global", {
        alias: "g",
        describe: "save to global memory (~/.ax-code/memory.json) instead of project memory",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Memory Remember")

    const kind = KIND_BY_FLAG[args.kind]
    const agents = args.agents
      ? args.agents
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
      : undefined
    const scope = args.global ? "global" : "project"
    await recordEntry(process.cwd(), kind, {
      name: args.name,
      body: args.body,
      why: args.why,
      howToApply: args.apply,
      agents,
      scope,
    })

    prompts.log.success(`Saved ${args.kind} memory (${scope}): ${args.name}`)
    prompts.outro("Done")
  },
})

export const MemoryForgetCommand = cmd({
  command: "forget",
  describe: "remove a recorded memory entry by name",
  builder: (yargs) =>
    yargs
      .option("kind", {
        describe: "memory kind",
        choices: ["user", "feedback", "decision", "reference"] as const,
        demandOption: true,
      })
      .option("name", {
        describe: "entry name to remove",
        type: "string",
        demandOption: true,
      })
      .option("global", {
        alias: "g",
        describe: "remove from global memory instead of project memory",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Memory Forget")

    const kind = KIND_BY_FLAG[args.kind]
    const scope = args.global ? "global" : "project"
    const removed = await removeEntry(process.cwd(), kind, args.name, scope)
    if (removed) prompts.log.success(`Removed ${args.kind} memory (${scope}): ${args.name}`)
    else prompts.log.warn(`No ${args.kind} memory named "${args.name}"`)
    prompts.outro("Done")
  },
})

export const MemoryRecallCommand = cmd({
  command: "recall [query]",
  describe: "search recorded memory entries by free-text query, kind, and agent",
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "free-text search across name/body/why/apply",
        type: "string",
      })
      .option("kind", {
        describe: "restrict to one kind",
        choices: ["user", "feedback", "decision", "reference"] as const,
      })
      .option("agent", {
        describe: "filter to entries applicable to this agent",
        type: "string",
      })
      .option("limit", {
        describe: "cap on result count",
        type: "number",
      })
      .option("global", {
        alias: "g",
        describe: "search global memory instead of project memory (use --scope=all for both)",
        type: "boolean",
        default: false,
      })
      .option("scope", {
        describe: 'which store to search: "project", "global", or "all"',
        choices: ["project", "global", "all"] as const,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Memory Recall")

    const kind = args.kind ? KIND_BY_FLAG[args.kind] : undefined
    const scope = args.scope ?? (args.global ? "global" : "project")
    const results = await recall(process.cwd(), {
      query: args.query,
      kind,
      agent: args.agent,
      limit: args.limit,
      scope,
    })

    if (results.length === 0) {
      prompts.log.warn("No matching entries")
      prompts.outro("Done")
      return
    }

    for (const r of results) {
      prompts.log.info(`[${r.kind}/${r.source}] ${r.entry.name}: ${r.entry.body}  (score ${r.score})`)
      if (r.entry.why) prompts.log.info(`  why: ${r.entry.why}`)
      if (r.entry.howToApply) prompts.log.info(`  apply: ${r.entry.howToApply}`)
      if (r.entry.agents?.length) prompts.log.info(`  agents: ${r.entry.agents.join(", ")}`)
    }
    prompts.outro(`${results.length} matches`)
  },
})

export const MemoryListCommand = cmd({
  command: "list",
  describe: "list recorded memory entries",
  builder: (yargs) =>
    yargs
      .option("kind", {
        describe: "filter by kind",
        choices: ["user", "feedback", "decision", "reference"] as const,
      })
      .option("global", {
        alias: "g",
        describe: "list global memory entries instead of project entries",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Memory Entries")

    const kind = args.kind ? KIND_BY_FLAG[args.kind] : undefined
    const scope = args.global ? "global" : "project"
    const entries = await listEntries(process.cwd(), kind, scope)
    if (entries.length === 0) {
      prompts.log.warn("No entries recorded")
      prompts.outro("Done")
      return
    }

    for (const entry of entries) {
      prompts.log.info(`${entry.name}: ${entry.body}`)
      if (entry.why) prompts.log.info(`  why: ${entry.why}`)
      if (entry.howToApply) prompts.log.info(`  apply: ${entry.howToApply}`)
    }
    prompts.outro(`${entries.length} entries`)
  },
})
