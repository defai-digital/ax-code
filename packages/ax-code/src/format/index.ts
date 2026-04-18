import path from "path"
import { mergeDeep } from "remeda"
import z from "zod"
import { Bus } from "../bus"
import { Config } from "../config/config"
import { Env } from "../util/env"
import { File } from "../file"
import { Instance } from "../project/instance"
import { Process } from "../util/process"
import { Log } from "../util/log"
import * as Formatter from "./formatter"

export namespace Format {
  const log = Log.create({ service: "format" })

  export const Status = z
    .object({
      name: z.string(),
      extensions: z.string().array(),
      enabled: z.boolean(),
    })
    .meta({
      ref: "FormatterStatus",
    })
  export type Status = z.infer<typeof Status>

  interface State {
    formatters: Record<string, Formatter.Info>
    isEnabled: (item: Formatter.Info) => Promise<boolean>
    unsubscribe: () => void
  }

  const state = Instance.state(
    async () => {
      const enabled: Record<string, boolean> = {}
      const formatters: Record<string, Formatter.Info> = {}

      const cfg = await Config.get()

      if (cfg.formatter !== false) {
        for (const item of Object.values(Formatter)) {
          formatters[item.name] = item
        }
        for (const [name, item] of Object.entries(cfg.formatter ?? {})) {
          if (item.disabled) {
            delete formatters[name]
            continue
          }
          const info = mergeDeep(formatters[name] ?? {}, {
            command: [],
            extensions: [],
            ...item,
          })

          if (info.command.length === 0) continue

          formatters[name] = {
            ...info,
            name,
            enabled: async () => true,
          }
        }
      } else {
        log.info("all formatters are disabled")
      }

      async function isEnabled(item: Formatter.Info) {
        let status = enabled[item.name]
        if (status === undefined) {
          status = await item.enabled()
          enabled[item.name] = status
        }
        return status
      }

      async function getFormatter(ext: string) {
        const matching = Object.values(formatters).filter((item) => item.extensions.includes(ext))
        const checks = await Promise.all(
          matching.map(async (item) => {
            log.info("checking", { name: item.name, ext })
            const on = await isEnabled(item)
            if (on) {
              log.info("enabled", { name: item.name, ext })
            }
            return {
              item,
              enabled: on,
            }
          }),
        )
        return checks.filter((x) => x.enabled).map((x) => x.item)
      }

      const unsubscribe = Bus.subscribe(
        File.Event.Edited,
        Instance.bind(async (payload) => {
          const file = payload.properties.file
          log.info("formatting", { file })
          const ext = path.extname(file)

          for (const item of await getFormatter(ext)) {
            log.info("running", { command: item.command })
            try {
              const proc = Process.spawn(
                item.command.map((x) => x.replace("$FILE", file)),
                {
                  cwd: Instance.directory,
                  env: { ...Env.sanitize(), ...item.environment },
                  stdout: "ignore",
                  stderr: "ignore",
                },
              )
              const FORMATTER_TIMEOUT = 30_000
              let timer: ReturnType<typeof setTimeout>
              const exit = await Promise.race([
                proc.exited,
                new Promise<number>((resolve) => {
                  timer = setTimeout(() => {
                    proc.kill()
                    log.warn("formatter timed out", { command: item.command, file })
                    resolve(-1)
                  }, FORMATTER_TIMEOUT)
                }),
              ])
              clearTimeout(timer!)
              if (exit !== 0) {
                log.error("failed", {
                  command: item.command,
                })
              }
            } catch (error) {
              log.error("failed to format file", {
                error,
                command: item.command,
                file,
              })
            }
          }
        }),
      )

      log.info("init")

      return {
        formatters,
        isEnabled,
        unsubscribe,
      } satisfies State
    },
    async (entry) => {
      entry.unsubscribe()
    },
  )

  export async function init() {
    await state()
  }

  export async function status() {
    const { formatters, isEnabled } = await state()
    const result: Status[] = []
    for (const formatter of Object.values(formatters)) {
      const enabled = await isEnabled(formatter)
      result.push({
        name: formatter.name,
        extensions: formatter.extensions,
        enabled,
      })
    }
    return result
  }
}
