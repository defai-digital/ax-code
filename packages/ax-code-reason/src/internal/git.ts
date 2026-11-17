import { createGit } from "@ax-code/util/git"
import { Process } from "./process"

export type { GitResult } from "@ax-code/util/git"

export const git = createGit(Process)
