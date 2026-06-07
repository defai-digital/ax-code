import { ConfigMarkdown } from "../config/markdown"
import { Shell } from "../shell/shell"
import { Process } from "../util/process"

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
const bashRegex = /!`([^`]+)`/g

function commandArgs(input: string) {
  const raw = input.match(argsRegex) ?? []
  return raw.map((item) => item.replace(quoteTrimRegex, ""))
}

function commandTemplate(template: string, input: string) {
  const args = commandArgs(input)
  const placeholders = template.match(placeholderRegex) ?? []
  const hasArgumentsPlaceholder = template.includes("$ARGUMENTS")
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  const withArgs = template.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const arg = position - 1
    // Guard both ends of the range. The upper bound catches missing
    // trailing args; the lower bound catches `$0` which would produce
    // `args[-1]` = undefined and stringify to the literal "undefined"
    // in the rendered template. See BUG-72.
    if (arg < 0 || arg >= args.length) return ""
    if (!hasArgumentsPlaceholder && position === last) return args.slice(arg).join(" ")
    return args[arg]
  })

  if (placeholders.length === 0 && !hasArgumentsPlaceholder && input.trim()) {
    return withArgs + "\n\n" + input
  }

  if (!hasArgumentsPlaceholder) return withArgs

  const remaining = placeholders.length > 0 ? args.slice(last).join(" ") : input
  return withArgs.replaceAll("$ARGUMENTS", remaining)
}

export async function commandTemplateText(input: {
  template: string
  arguments: string
  run?: (cmd: string) => Promise<string>
  allowShell?: boolean
}) {
  let text = commandTemplate(input.template, input.arguments)
  if (input.allowShell === false) return text.trim()
  const matches = ConfigMarkdown.shell(text)
  if (matches.length === 0) return text.trim()

  const run =
    input.run ??
    (async (cmd: string) => {
      const out = await Process.text([cmd], { shell: Shell.preferred(), nothrow: true })
      return out.text
    })

  const settled = await Promise.allSettled(matches.map(async ([, cmd]) => run(cmd)))
  const results = settled.map((r) => (r.status === "fulfilled" ? r.value : "<shell command failed>"))
  let index = 0
  text = text.replace(bashRegex, () => results[index++])
  return text.trim()
}
