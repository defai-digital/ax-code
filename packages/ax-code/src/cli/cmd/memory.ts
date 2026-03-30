import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { generate } from "../../memory/generator"
import * as store from "../../memory/store"
import { getMetadata } from "../../memory/injector"

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage project memory (pre-cached context)",
  builder: (yargs) =>
    yargs
      .command(MemoryWarmupCommand)
      .command(MemoryStatusCommand)
      .command(MemoryClearCommand)
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

    // Show breakdown
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
    prompts.outro("Done")
  },
})

export const MemoryClearCommand = cmd({
  command: "clear",
  describe: "delete cached memory",
  async handler() {
    UI.empty()
    prompts.intro("Clear Memory")

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
