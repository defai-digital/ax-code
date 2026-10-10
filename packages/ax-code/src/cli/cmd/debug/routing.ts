import { Config } from "../../../config/config"
import { Provider } from "../../../provider/provider"
import { RoutePolicy } from "../../../provider/route-policy"
import { SessionRetry } from "../../../session/retry"
import { bootstrapReadonly } from "../../bootstrap"
import { cmd } from "../cmd"

export const RoutingCommand = cmd({
  command: "routing",
  describe: "explain configured model selection and recovery without calling a model",
  builder: (yargs) => yargs.option("model", { type: "string", describe: "Exact primary provider/model to explain" }),
  async handler(args) {
    await bootstrapReadonly(process.cwd(), async () => {
      const config = await Config.get()
      const primary = args.model ? Provider.parseModel(args.model) : await Provider.defaultModel()
      const fallback = (config.llm_routing?.fallback ?? []).filter(
        (target) => RoutePolicy.key(target) !== RoutePolicy.key(primary),
      )
      process.stdout.write(
        JSON.stringify(
          {
            primary,
            selectionSource: args.model ? "command" : config.model ? "config" : "recent",
            fallback,
            auxiliary: config.small_model ? Provider.parseModel(config.small_model) : "inherit-primary",
            agentPins: Object.fromEntries(
              Object.entries(config.agent ?? {}).flatMap(([name, agent]) => (agent.model ? [[name, agent.model]] : [])),
            ),
            maxSameTargetRetries: SessionRetry.RETRY_MAX_ATTEMPTS,
            maxConcurrencyRetries: SessionRetry.CONCURRENCY_RETRY_MAX_ATTEMPTS,
            dispatch: false,
            availability: "not-probed",
            notes: [
              "Only configured targets may be used; an unavailable next target stops recovery.",
              "Auth, permanent quota, cancellation and output/tool replay constraints can stop the sequence early.",
              "Configuration loading may fetch configured remote settings; no model requests are sent.",
              "External CLI and gateway internal routing are outside this local preview.",
            ],
          },
          null,
          2,
        ) + "\n",
      )
    })
  },
})
