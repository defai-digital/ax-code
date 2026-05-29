export function desktopMainArgs(argv: string[]) {
  const args = argv.slice(1)
  const first = args[0]
  if (!first || first.startsWith("-")) return args
  return looksLikeEntrypoint(first) ? args.slice(1) : args
}

function looksLikeEntrypoint(value: string) {
  return (
    value.endsWith(".ts") ||
    value.endsWith(".js") ||
    value.endsWith(".mjs") ||
    value.endsWith(".cjs") ||
    value.endsWith(".asar") ||
    value.endsWith(".app") ||
    value.includes("/Contents/Resources/app")
  )
}
