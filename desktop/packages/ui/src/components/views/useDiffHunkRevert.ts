import React from "react"
import { toast } from "@/components/ui"
import { useGitStore } from "@/stores/useGitStore"
import { useRuntimeAPIs } from "@/hooks/useRuntimeAPIs"
import { useI18n } from "@/lib/i18n"
import { revertHunk } from "./diffHunkRevert"

interface UseDiffHunkRevertOptions {
  directory: string | null
  filePath: string
  diff: { original: string; modified: string } | null
}

/**
 * Shared per-hunk revert logic for both the single-file and stacked diff
 * viewers in DiffView.tsx — reconstructs the file with one hunk reverted,
 * writes it back via the same endpoint the file editor's save action uses,
 * then updates the local diff cache so the view re-renders immediately.
 */
export function useDiffHunkRevert({ directory, filePath, diff }: UseDiffHunkRevertOptions) {
  const { t } = useI18n()
  const { files } = useRuntimeAPIs()
  const setDiff = useGitStore((state) => state.setDiff)
  const [revertingHunkIndex, setRevertingHunkIndex] = React.useState<number | null>(null)

  const handleRevertHunk = React.useCallback(
    async (hunkIndex: number) => {
      if (!directory || !diff || !files.writeFile) {
        toast.error(t("diffView.hunk.revertUnsupported"))
        return
      }

      setRevertingHunkIndex(hunkIndex)
      try {
        const reconstructed = revertHunk(diff.original, diff.modified, hunkIndex, filePath)
        const result = await files.writeFile(filePath, reconstructed)
        if (!result?.success) {
          throw new Error("write failed")
        }
        setDiff(directory, filePath, { original: diff.original, modified: reconstructed })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("diffView.hunk.revertFailed"))
      } finally {
        setRevertingHunkIndex(null)
      }
    },
    [diff, directory, files, filePath, setDiff, t],
  )

  return { revertingHunkIndex, handleRevertHunk }
}
