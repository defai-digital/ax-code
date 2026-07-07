import path from "path"
import z from "zod"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { ProjectID } from "../project/schema"
import { Filesystem } from "../util/filesystem"
import { git } from "../util/git"
import { uniqueStrings } from "../util/string-list"
import { Session } from "."
import { SessionID } from "./schema"

export namespace SessionMove {
  export const ValidationReason = z.enum([
    "ok",
    "target_missing",
    "target_not_directory",
    "outside_current_project",
    "same_directory",
  ])
  export type ValidationReason = z.output<typeof ValidationReason>

  export const GitContext = z.object({
    worktree: z.string().nullable(),
    branch: z.string().nullable(),
    dirty: z.boolean().nullable(),
  })
  export type GitContext = z.output<typeof GitContext>

  export const Validation = z
    .object({
      sessionID: SessionID.zod,
      valid: z.boolean(),
      reason: ValidationReason,
      current: z.object({
        directory: z.string(),
        projectID: ProjectID.zod,
        worktree: z.string(),
      }),
      target: z.object({
        directory: z.string(),
        exists: z.boolean(),
        isDirectory: z.boolean(),
        sameDirectory: z.boolean(),
        withinCurrentProject: z.boolean(),
        git: GitContext,
      }),
      warnings: z.string().array(),
    })
    .meta({
      ref: "SessionMoveValidation",
    })
  export type Validation = z.output<typeof Validation>

  export const ValidateInput = z
    .object({
      sessionID: SessionID.zod,
      targetDirectory: z.string().trim().min(1),
    })
    .meta({
      ref: "SessionMoveValidateInput",
    })
  export type ValidateInput = z.output<typeof ValidateInput>

  function resolveTargetDirectory(input: string) {
    const candidate = path.isAbsolute(input) ? input : path.join(Instance.directory, input)
    return Filesystem.resolve(candidate)
  }

  function samePath(a: string, b: string) {
    return path.resolve(Filesystem.resolve(a)) === path.resolve(Filesystem.resolve(b))
  }

  async function projectBoundaryRoots() {
    const roots = [Instance.directory]
    if (Instance.worktree !== "/") roots.push(Instance.worktree)
    roots.push(...(await Project.sandboxes(Instance.project.id)))
    return uniqueStrings(roots.map((item) => Filesystem.resolve(item)))
  }

  function withinProjectBoundary(target: string, roots: string[]) {
    return roots.some((root) => Filesystem.contains(root, target))
  }

  async function readGitContext(directory: string): Promise<GitContext> {
    const topLevel = await git(["rev-parse", "--show-toplevel"], { cwd: directory })
    if (topLevel.exitCode !== 0) return { worktree: null, branch: null, dirty: null }

    const branchResult = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: directory })
    const branchText = branchResult.exitCode === 0 ? branchResult.text().trim() : ""
    const branch = branchText && branchText !== "HEAD" ? branchText : null

    const statusResult = await git(["status", "--porcelain"], { cwd: directory })
    const dirty = statusResult.exitCode === 0 ? statusResult.text().trim().length > 0 : null

    return {
      worktree: Filesystem.resolve(topLevel.text().trim()),
      branch,
      dirty,
    }
  }

  function selectReason(input: {
    exists: boolean
    isDirectory: boolean
    withinCurrentProject: boolean
    sameDirectory: boolean
  }): ValidationReason {
    if (!input.exists) return "target_missing"
    if (!input.isDirectory) return "target_not_directory"
    if (!input.withinCurrentProject) return "outside_current_project"
    if (input.sameDirectory) return "same_directory"
    return "ok"
  }

  function warnings(input: { reason: ValidationReason; git: GitContext }) {
    const result: string[] = []
    if (input.reason === "same_directory") {
      result.push("Target directory is already the session directory.")
    }
    if (input.reason === "outside_current_project") {
      result.push("Target directory is outside the current project boundary.")
    }
    if (input.git.dirty) {
      result.push("Target git worktree has uncommitted changes.")
    }
    return result
  }

  export async function validate(input: ValidateInput): Promise<Validation> {
    const session = await Session.get(input.sessionID)
    const targetDirectory = resolveTargetDirectory(input.targetDirectory)
    const exists = await Filesystem.exists(targetDirectory)
    const isDirectory = exists ? await Filesystem.isDir(targetDirectory) : false
    const roots = await projectBoundaryRoots()
    const withinCurrentProject = isDirectory && withinProjectBoundary(targetDirectory, roots)
    const sameDirectory = samePath(session.directory, targetDirectory)
    const gitContext = isDirectory
      ? await readGitContext(targetDirectory)
      : { worktree: null, branch: null, dirty: null }
    const reason = selectReason({
      exists,
      isDirectory,
      withinCurrentProject,
      sameDirectory,
    })

    return Validation.parse({
      sessionID: input.sessionID,
      valid: reason === "ok",
      reason,
      current: {
        directory: session.directory,
        projectID: session.projectID,
        worktree: Instance.worktree,
      },
      target: {
        directory: targetDirectory,
        exists,
        isDirectory,
        sameDirectory,
        withinCurrentProject,
        git: gitContext,
      },
      warnings: warnings({ reason, git: gitContext }),
    })
  }
}
