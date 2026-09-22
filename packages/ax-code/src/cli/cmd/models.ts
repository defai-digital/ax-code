import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { providerModelKey } from "../../provider/model-key"
import { Provider } from "../../provider/provider"
import { modelSelectableForProvider } from "../../provider/model-selectability"
import { ProviderID } from "../../provider/schema"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"

// Loose structural shape for a model, matching what `modelSelectableForProvider`
// accepts. Derived (the upstream `SelectableModel` type is not exported) so the
// JSON builder stays testable with the same stub shapes used by the run tests.
type SelectableModel = NonNullable<Parameters<typeof modelSelectableForProvider>[1]>

type ModelsProvider = {
  id: string
  models: Record<string, SelectableModel>
}

export type ModelsJSONEntry = {
  id: string
  provider: string
  model: string
  connected: boolean
  metadata?: SelectableModel
}

export type ModelsJSONDocument = {
  models: ModelsJSONEntry[]
}

function orderedProviderIDs(providers: Record<string, unknown>): string[] {
  return Object.keys(providers).sort((a, b) => {
    const aIsOpencode = a.startsWith("ax-code")
    const bIsOpencode = b.startsWith("ax-code")
    if (aIsOpencode && !bIsOpencode) return -1
    if (!aIsOpencode && bIsOpencode) return 1
    return a.localeCompare(b)
  })
}

export function buildModelsDocument(input: {
  providers: Record<string, ModelsProvider>
  connected: readonly string[]
  provider?: string
  verbose?: boolean
}): { document: ModelsJSONDocument } | { error: string } {
  const connected = new Set(input.connected)

  let providerIDs: string[]
  if (input.provider) {
    if (!input.providers[input.provider]) return { error: `Provider not found: ${input.provider}` }
    providerIDs = [input.provider]
  } else {
    providerIDs = orderedProviderIDs(input.providers)
  }

  const models: ModelsJSONEntry[] = []
  for (const providerID of providerIDs) {
    const provider = input.providers[providerID]
    const sorted = Object.entries(provider.models)
      .filter(([, model]) => modelSelectableForProvider(providerID, model))
      .sort(([a], [b]) => a.localeCompare(b))
    for (const [modelID, model] of sorted) {
      const entry: ModelsJSONEntry = {
        id: providerModelKey({ providerID, modelID }),
        provider: providerID,
        model: modelID,
        connected: connected.has(providerID),
      }
      if (input.verbose) entry.metadata = model
      models.push(entry)
    }
  }

  return { document: { models } }
}

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list provider/model IDs for ax-code run --model",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (full model metadata)",
        type: "boolean",
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      })
      .epilog(
        "Each line is a provider/model ID for --model. Family aliases: deepseek, glm, qwen. " +
          'Bare SKUs such as qwen3.8-max are invalid. Example: ax-code run --model qwen -- "Review this change"',
      )
  },
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        // Wait for background discovery (CLI/local model lists) so the listing
        // is complete — unlike the TUI, this command has nothing to refresh.
        await Provider.ready()
        const providers = await Provider.list()

        if (args.json) {
          const providerMap: Record<string, ModelsProvider> = {}
          for (const [providerID, info] of Object.entries(providers)) providerMap[providerID] = info
          const result = buildModelsDocument({
            providers: providerMap,
            connected: Object.keys(providers),
            provider: args.provider,
            verbose: args.verbose,
          })
          if ("error" in result) {
            UI.error(result.error)
            process.exitCode = 1
            return
          }
          process.stdout.write(JSON.stringify(result.document, null, 2))
          process.stdout.write(EOL)
          return
        }

        function printModels(providerID: ProviderID, verbose?: boolean) {
          const provider = providers[providerID]
          const sortedModels = Object.entries(provider.models)
            .filter(([, model]) => modelSelectableForProvider(providerID, model))
            .sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(providerModelKey({ providerID, modelID }))
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        if (args.provider) {
          const requestedProviderID = ProviderID.make(args.provider)
          const provider = providers[requestedProviderID]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            process.exitCode = 1
            return
          }

          printModels(requestedProviderID, args.verbose)
          return
        }

        const providerIDs = orderedProviderIDs(providers)

        for (const providerID of providerIDs) {
          printModels(ProviderID.make(providerID), args.verbose)
        }
      },
    })
  },
})
