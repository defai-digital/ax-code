import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Policy } from "../quality/policy"
import { Log } from "../util/log"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_ADR from "./template/adr.txt"
import PROMPT_IMPACT from "./template/impact.txt"
import PROMPT_PRD from "./template/prd.txt"

export namespace Command {
  const log = Log.create({ service: "command" })

  type State = {
    commands: Record<string, Info>
  }

  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string) {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    ADR: "adr",
    IMPACT: "impact",
    PRD: "prd",
  } as const

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly list: () => Effect.Effect<Info[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Command") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const init = Effect.fn("Command.state")(function* (ctx) {
        const cfg = yield* Effect.promise(() => Config.get())
        const commands: Record<string, Info> = {}

        commands[Default.INIT] = {
          name: Default.INIT,
          description: "create/update AGENTS.md",
          source: "command",
          get template() {
            return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
          },
          hints: hints(PROMPT_INITIALIZE),
        }
        commands[Default.REVIEW] = {
          name: Default.REVIEW,
          description: "review changes [commit|branch|pr], defaults to uncommitted",
          source: "command",
          get template() {
            return (async () => {
              const policy = await Policy.loadReviewPolicy({ worktree: ctx.worktree })
              const policyText = policy ? policy.trim() : "(no project-specific review policy configured)"
              // Use replacement functions so user-provided content (worktree
              // path, policy file body) is inserted verbatim. String.replace
              // with a string replacement interprets $1, $&, $$, etc. as
              // special patterns, which would mangle a worktree path that
              // contains literal $ characters or any policy content with the
              // same.
              return PROMPT_REVIEW.replace("${path}", () => ctx.worktree).replace(
                "${review_policy}",
                () => policyText,
              )
            })()
          },
          subtask: true,
          hints: hints(PROMPT_REVIEW),
        }
        commands[Default.ADR] = {
          name: Default.ADR,
          description: "generate an Architecture Decision Record",
          source: "command",
          get template() {
            return PROMPT_ADR.replace("${path}", ctx.worktree)
          },
          hints: hints(PROMPT_ADR),
        }
        commands[Default.IMPACT] = {
          name: Default.IMPACT,
          description: "generate an Impact Assessment for a proposed change",
          source: "command",
          get template() {
            return PROMPT_IMPACT.replace("${path}", ctx.worktree)
          },
          hints: hints(PROMPT_IMPACT),
        }
        commands[Default.PRD] = {
          name: Default.PRD,
          description: "generate a Product Requirements Document for a feature",
          source: "command",
          get template() {
            return PROMPT_PRD.replace("${path}", ctx.worktree)
          },
          hints: hints(PROMPT_PRD),
        }

        for (const [name, command] of Object.entries(cfg.command ?? {})) {
          commands[name] = {
            name,
            agent: command.agent,
            model: command.model,
            description: command.description,
            source: "command",
            get template() {
              return command.template
            },
            subtask: command.subtask,
            hints: hints(command.template),
          }
        }

        for (const [name, prompt] of Object.entries(yield* Effect.promise(() => MCP.prompts()))) {
          commands[name] = {
            name,
            source: "mcp",
            description: prompt.description,
            get template() {
              return new Promise<string>(async (resolve, reject) => {
                const template = await MCP.getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                ).catch(reject)
                resolve(
                  template?.messages
                    .map((message) => (message.content.type === "text" ? message.content.text : ""))
                    .join("\n") || "",
                )
              })
            },
            hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
          }
        }

        for (const skill of yield* Effect.promise(() => Skill.all())) {
          if (commands[skill.name]) continue
          commands[skill.name] = {
            name: skill.name,
            description: skill.description,
            source: "skill",
            get template() {
              return skill.content
            },
            hints: [],
          }
        }

        return {
          commands,
        }
      })

      const cache = yield* InstanceState.make<State>((ctx) => init(ctx))

      const get = Effect.fn("Command.get")(function* (name: string) {
        const state = yield* InstanceState.get(cache)
        return state.commands[name]
      })

      const list = Effect.fn("Command.list")(function* () {
        const state = yield* InstanceState.get(cache)
        return Object.values(state.commands)
      })

      return Service.of({ get, list })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function get(name: string) {
    return runPromise((svc) => svc.get(name))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }
}
