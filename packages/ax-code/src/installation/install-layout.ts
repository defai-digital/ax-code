import path from "node:path"

/** Identify managed files, never arbitrary files somewhere under the user's home. */
export function standaloneInstallRoot(
  activePath: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
  canonicalRoot?: string,
) {
  const paths = platform === "win32" ? path.win32 : path.posix
  const root = canonicalRoot ?? paths.resolve(home, ".ax-code")
  const relative = paths.relative(root, paths.resolve(activePath)).replaceAll("\\", "/")
  if (/^(?:bin\/ax-code(?:\.exe|\.cmd)?|node\/bin\/[^/]+|lib\/index-(?:node-tui|node|compiled)\.js)$/.test(relative))
    return root
  if (
    /^versions\/[^/]+\/runtime\/(?:bin\/ax-code(?:\.cmd)?|node\/bin\/[^/]+|lib\/index-(?:node-tui|node|compiled)\.js)$/.test(
      relative,
    )
  )
    return root
}

export function isWithinInstallPrefix(activePath: string, prefix: string, platform: NodeJS.Platform) {
  const paths = platform === "win32" ? path.win32 : path.posix
  const relative = paths.relative(prefix, activePath)
  return relative !== "" && !relative.startsWith(`..${paths.sep}`) && relative !== ".." && !paths.isAbsolute(relative)
}
