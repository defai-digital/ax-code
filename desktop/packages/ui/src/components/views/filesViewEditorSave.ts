import { serializeEditorContent, type FileLineEnding } from "./filesViewEditorContent"

export type FilesViewDraftWrite = (
  path: string,
  content: string,
  options?: { allowOutsideWorkspace?: boolean },
) => Promise<{ success?: boolean } | null | undefined>

export const prepareFilesViewDraft = (
  draftContent: string,
  displayedContent: string,
  lineEnding: FileLineEnding,
): { dirty: boolean; contentToWrite: string } => {
  const contentToWrite = serializeEditorContent(draftContent, lineEnding)
  return {
    dirty: draftContent !== displayedContent,
    contentToWrite,
  }
}

export const saveFilesViewDraft = async (input: {
  path: string
  draftContent: string
  displayedContent: string
  lineEnding: FileLineEnding
  writeFile?: FilesViewDraftWrite
  options?: { allowOutsideWorkspace?: boolean }
}): Promise<{ ok: true; skipped: boolean } | { ok: false; reason: "unsupported" | "write-failed" }> => {
  if (typeof input.writeFile !== "function") {
    return { ok: false, reason: "unsupported" }
  }
  const prepared = prepareFilesViewDraft(input.draftContent, input.displayedContent, input.lineEnding)
  if (!prepared.dirty) {
    return { ok: true, skipped: true }
  }
  const result = await input.writeFile(input.path, prepared.contentToWrite, input.options)
  if (!result?.success) {
    return { ok: false, reason: "write-failed" }
  }
  return { ok: true, skipped: false }
}
