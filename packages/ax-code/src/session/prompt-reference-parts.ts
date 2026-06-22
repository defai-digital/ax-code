import path from "path"
import os from "os"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { Agent } from "../agent/agent"
import { ConfigMarkdown } from "../config/markdown"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

export async function resolvePromptParts(template: string): Promise<any[]> {
  const parts: any[] = [
    {
      type: "text",
      text: template,
    },
  ]
  const files = ConfigMarkdown.files(template)
  const seen = new Set<string>()
  for (const match of files) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    const filepath = name.startsWith("~/")
      ? path.resolve(os.homedir(), name.slice(2))
      : path.resolve(Instance.worktree, name)
    const checkedPath = await fs.realpath(filepath).catch((error) => {
      if (!Filesystem.isMissingPathError(error)) throw error
      return undefined
    })
    if (!checkedPath) {
      const agent = await Agent.get(name)
      if (agent) {
        parts.push({
          type: "agent",
          name: agent.name,
        })
      }
      continue
    }

    if (name.startsWith("~/") && !Filesystem.contains(os.homedir(), checkedPath)) {
      continue
    }

    if (!name.startsWith("~/") && !Filesystem.contains(Instance.worktree, checkedPath)) {
      continue
    }

    const stats = await fs.stat(checkedPath).catch((error) => {
      if (!Filesystem.isMissingPathError(error)) throw error
      return undefined
    })
    if (!stats) continue

    if (stats.isDirectory()) {
      parts.push({
        type: "file",
        url: pathToFileURL(checkedPath).href,
        filename: name,
        mime: "application/x-directory",
      })
      continue
    }

    parts.push({
      type: "file",
      url: pathToFileURL(checkedPath).href,
      filename: name,
      mime: "text/plain",
    })
  }
  return parts
}
