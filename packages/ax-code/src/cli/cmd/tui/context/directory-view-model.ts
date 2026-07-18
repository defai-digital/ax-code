import { Filesystem } from "@/util/filesystem"

export function directoryLabel(input: {
  directory?: string
  fallbackDirectory: string
  homeDirectory: string
  branch?: string
}) {
  const directory = input.directory || input.fallbackDirectory
  const display = Filesystem.shortenHome(directory, input.homeDirectory)
  return input.branch ? `${display}:${input.branch}` : display
}
