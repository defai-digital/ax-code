export type FilesViewAutoSaveStatus = "idle" | "saved"

type TimeoutRef = {
  current: ReturnType<typeof setTimeout> | null
}

export const clearFilesViewAutoSaveIdleTimer = (idleTimerRef: TimeoutRef): void => {
  if (!idleTimerRef.current) {
    return
  }

  clearTimeout(idleTimerRef.current)
  idleTimerRef.current = null
}

export const resetFilesViewAutoSaveStatus = (
  setStatus: (status: FilesViewAutoSaveStatus) => void,
  idleTimerRef: TimeoutRef,
): void => {
  clearFilesViewAutoSaveIdleTimer(idleTimerRef)
  setStatus("idle")
}

export const showFilesViewAutoSaveSavedStatus = (
  setStatus: (status: FilesViewAutoSaveStatus) => void,
  idleTimerRef: TimeoutRef,
  idleDelayMs = 2000,
): void => {
  clearFilesViewAutoSaveIdleTimer(idleTimerRef)
  setStatus("saved")
  idleTimerRef.current = setTimeout(() => {
    idleTimerRef.current = null
    setStatus("idle")
  }, idleDelayMs)
}
