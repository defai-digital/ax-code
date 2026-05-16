export function directoryLabel(input: {
  directory?: string
  fallbackDirectory: string
  homeDirectory: string
  branch?: string
}) {
  const directory = input.directory || input.fallbackDirectory
  const display =
    directory === input.homeDirectory || directory.startsWith(input.homeDirectory + "/")
      ? directory.replace(input.homeDirectory, "~")
      : directory
  return input.branch ? `${display}:${input.branch}` : display
}
