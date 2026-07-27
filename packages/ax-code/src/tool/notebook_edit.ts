import z from "zod"
import fs from "fs/promises"
import crypto from "crypto"
import path from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import { Tool } from "./tool"
import DESCRIPTION from "./notebook_edit.txt"
import { notifyFileEdited } from "./diagnostics"
import { parseJsonStrict } from "@/util/json-value"
import { Instance } from "@/project/instance"
import { Isolation } from "@/isolation"
import { BlastRadius } from "@/session/blast-radius"
import { FileTime } from "@/file/time"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { normalizeToWorkspacePath, resolveToolFilePath } from "./file-path"

interface NotebookCell {
  cell_type: string
  source: string[]
  metadata: Record<string, unknown>
  id?: string
  outputs?: unknown[]
  execution_count?: number | null
}

interface Notebook {
  cells: NotebookCell[]
  metadata: Record<string, unknown>
  nbformat: number
  nbformat_minor: number
}

function toSourceArray(content: string): string[] {
  if (!content) return []
  const lines = content.split("\n")
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line))
}

function findCellIndex(notebook: Notebook, cellId?: string, cellIndex?: number): number {
  if (cellId) {
    const idx = notebook.cells.findIndex((c) => c.id === cellId)
    if (idx === -1) throw new Error(`Cell with id "${cellId}" not found in notebook.`)
    return idx
  }
  if (cellIndex !== undefined) {
    if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
      throw new Error(`Cell index ${cellIndex} out of range (notebook has ${notebook.cells.length} cells).`)
    }
    return cellIndex
  }
  throw new Error("Either cell_id or cell_index must be provided.")
}

export const NotebookEditTool = Tool.define("notebook_edit", {
  description: DESCRIPTION,
  parameters: z.object({
    notebook_path: z.string().describe("The absolute path to the Jupyter notebook file to edit (must be absolute)."),
    new_source: z.string().optional().describe("The new source for replace/insert operations. Omit when deleting."),
    cell_id: z
      .string()
      .optional()
      .describe("The ID of the cell to edit. When inserting, the new cell is placed after this cell."),
    cell_index: z
      .number()
      .int()
      .optional()
      .describe("0-based index of the cell. Fallback when cell_id is not provided."),
    cell_type: z.enum(["code", "markdown"]).optional().describe("The type of the cell. Required for insert mode."),
    edit_mode: z
      .enum(["replace", "insert", "delete"])
      .optional()
      .describe("Type of edit: replace (default), insert, or delete."),
  }),
  async execute(params, ctx) {
    if (!path.isAbsolute(params.notebook_path)) {
      throw new Error("notebook_path must be an absolute path.")
    }
    if (!params.notebook_path.endsWith(".ipynb")) {
      throw new Error("notebook_path must point to a .ipynb file.")
    }

    const notebookPath = resolveToolFilePath(params.notebook_path, Instance.directory)
    const relativePath = normalizeToWorkspacePath(notebookPath, Instance.worktree)
    await assertExternalDirectory(ctx, notebookPath)
    Isolation.assertWrite(ctx.extra?.isolation, notebookPath, Instance.directory, Instance.worktree)
    BlastRadius.assertWritable(ctx.sessionID, relativePath)

    const editMode = params.edit_mode ?? "replace"
    let summary = ""
    let cellCount = 0

    await FileTime.withLock(notebookPath, async () => {
      await assertSymlinkInsideProject(notebookPath)

      const raw = await fs.readFile(notebookPath, "utf-8")
      await FileTime.read(ctx.sessionID, notebookPath)

      let notebook: Notebook
      try {
        notebook = parseJsonStrict(raw) as Notebook
      } catch {
        throw new Error(`Failed to parse notebook at ${notebookPath}: invalid JSON.`)
      }
      if (!Array.isArray(notebook.cells)) {
        throw new Error("Invalid notebook structure: missing cells array.")
      }

      switch (editMode) {
        case "replace": {
          if (params.new_source === undefined) {
            throw new Error("new_source is required when edit_mode is 'replace'.")
          }
          const idx = findCellIndex(notebook, params.cell_id, params.cell_index)
          const cell = notebook.cells[idx]
          cell.source = toSourceArray(params.new_source)
          if (params.cell_type) cell.cell_type = params.cell_type
          if (cell.cell_type === "code") {
            cell.outputs = []
            cell.execution_count = null
          } else {
            delete cell.outputs
            delete cell.execution_count
          }
          summary = `Replaced cell ${params.cell_id ?? `at index ${idx}`} (${cell.cell_type}).`
          break
        }
        case "insert": {
          if (!params.cell_type) {
            throw new Error("cell_type is required when edit_mode is 'insert'.")
          }
          if (params.new_source === undefined) {
            throw new Error("new_source is required when edit_mode is 'insert'.")
          }
          let insertAt: number
          if (params.cell_id || params.cell_index !== undefined) {
            insertAt = findCellIndex(notebook, params.cell_id, params.cell_index) + 1
          } else {
            insertAt = notebook.cells.length
          }
          const newCell: NotebookCell = {
            cell_type: params.cell_type,
            source: toSourceArray(params.new_source),
            metadata: {},
            id: crypto.randomUUID().replace(/-/g, "").slice(0, 8),
          }
          if (params.cell_type === "code") {
            newCell.outputs = []
            newCell.execution_count = null
          }
          notebook.cells.splice(insertAt, 0, newCell)
          summary = `Inserted new ${params.cell_type} cell at position ${insertAt} (id: ${newCell.id}).`
          break
        }
        case "delete": {
          const idx = findCellIndex(notebook, params.cell_id, params.cell_index)
          const removed = notebook.cells.splice(idx, 1)[0]
          summary = `Deleted cell ${params.cell_id ?? `at index ${idx}`} (${removed.cell_type}).`
          break
        }
      }

      const updated = JSON.stringify(notebook, null, 1) + "\n"
      const diff = createTwoFilesPatch(notebookPath, notebookPath, raw, updated)

      await ctx.ask({
        permission: "edit",
        patterns: [relativePath],
        always: ["*"],
        metadata: {
          filepath: notebookPath,
          edit_mode: editMode,
          diff,
        },
      })

      // Permission prompts can stay open while an editor or another process
      // changes the notebook. Re-check the path and the exact bytes that were
      // used to build the approved diff before committing the write.
      await assertSymlinkInsideProject(notebookPath)
      await FileTime.assert(ctx.sessionID, notebookPath)
      if ((await fs.readFile(notebookPath, "utf-8")) !== raw) {
        throw new Error(`File ${notebookPath} changed while edit approval was pending. Read it again and retry.`)
      }

      await fs.writeFile(notebookPath, updated, "utf-8")
      await notifyFileEdited(notebookPath, "change")
      await FileTime.read(ctx.sessionID, notebookPath)

      let additions = 0
      let deletions = 0
      for (const change of diffLines(raw, updated)) {
        if (change.added) additions += change.count || 0
        else if (change.removed) deletions += change.count || 0
      }
      BlastRadius.recordWriteAndAssert(ctx.sessionID, notebookPath, additions + deletions)
      cellCount = notebook.cells.length
    })

    return {
      title: `Edited notebook: ${summary}`,
      metadata: {
        notebookPath,
        editMode,
        cellCount,
      },
      output: `${summary}\nNotebook now has ${cellCount} cells.`,
    }
  },
})
