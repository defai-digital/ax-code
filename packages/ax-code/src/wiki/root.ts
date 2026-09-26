import { realpath } from "node:fs/promises"
import { Instance } from "../project/instance"

/** One evidence root for subdirectory sessions and linked Git worktrees. */
export async function wikiProjectRoot() {
  return realpath(Instance.project.vcs === "git" ? Instance.worktree : Instance.directory)
}
