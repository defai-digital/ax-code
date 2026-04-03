import { NamedError } from "@ax-code/util/error"
import { EOL } from "os"
import { Log } from "../../util/log"

export type FatalDep = {
  error?: (msg: string, data: Record<string, unknown>) => void
  format?: (err: unknown) => string | undefined
  ui?: (text: string) => void
  file?: () => string
  out?: {
    write(text: string): unknown
  }
  text?: (err: unknown) => string
}

export function data(err: unknown) {
  const data: Record<string, any> = {}

  if (err instanceof NamedError) {
    const obj = err.toObject()
    Object.assign(data, obj.data)
  }

  if (err instanceof Error) {
    Object.assign(data, {
      name: err.name,
      message: err.message,
      cause: err.cause?.toString(),
      stack: err.stack,
    })
  }

  if (err instanceof ResolveMessage) {
    Object.assign(data, {
      name: err.name,
      message: err.message,
      code: err.code,
      specifier: err.specifier,
      referrer: err.referrer,
      position: err.position,
      importKind: err.importKind,
    })
  }

  return data
}

export function fatal(err: unknown, dep: FatalDep) {
  const error = dep.error ?? ((msg: string, data: Record<string, unknown>) => Log.Default.error(msg, data))
  const format = dep.format ?? (() => undefined)
  const ui = dep.ui ?? (() => {})
  const file = dep.file ?? Log.file
  const out = dep.out ?? process.stderr
  const text = dep.text ?? NamedError.message

  error("fatal", data(err))
  const formatted = format(err)
  if (formatted) {
    ui(formatted)
    return
  }

  ui("Unexpected error, check log file at " + file() + " for more details" + EOL)
  out.write(text(err) + EOL)
}
