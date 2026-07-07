import React from "react"
import type { Session, SessionMoveValidation } from "@ax-code/sdk/v2/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui"
import { Icon } from "@/components/icon/Icon"
import { useI18n } from "@/lib/i18n"
import type { I18nKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { normalizeProjectPath } from "@/lib/projectResolution"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { buildSessionMoveTargets } from "./sessionMoveDialogModel"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: Session
  currentDirectory: string | null
}

const CUSTOM_TARGET_ID = "__custom__"

function validationText(t: (key: I18nKey) => string, validation: SessionMoveValidation): string {
  switch (validation.reason) {
    case "ok":
      return t("sessions.sidebar.sessionMove.validation.ok")
    case "target_missing":
      return t("sessions.sidebar.sessionMove.validation.targetMissing")
    case "target_not_directory":
      return t("sessions.sidebar.sessionMove.validation.targetNotDirectory")
    case "outside_current_project":
      return t("sessions.sidebar.sessionMove.validation.outsideCurrentProject")
    case "same_directory":
      return t("sessions.sidebar.sessionMove.validation.sameDirectory")
    default:
      return t("sessions.sidebar.sessionMove.validation.invalid")
  }
}

function directoryLabel(path: string): string {
  const normalized = normalizeProjectPath(path) ?? path
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

export function SessionMoveDialog({ open, onOpenChange, session, currentDirectory }: Props): React.ReactElement {
  const { t } = useI18n()
  const projects = useProjectsStore((state) => state.projects)
  const availableWorktreesByProject = useSessionUIStore((state) => state.availableWorktreesByProject)
  const validateSessionMoveTarget = useSessionUIStore((state) => state.validateSessionMoveTarget)
  const moveSession = useSessionUIStore((state) => state.moveSession)

  const targets = React.useMemo(
    () =>
      buildSessionMoveTargets({
        projects,
        availableWorktreesByProject,
        currentDirectory,
      }),
    [availableWorktreesByProject, currentDirectory, projects],
  )

  const firstMovableTarget = React.useMemo(() => targets.find((target) => !target.current) ?? targets[0], [targets])

  const [selectedTargetId, setSelectedTargetId] = React.useState<string>(firstMovableTarget?.id ?? CUSTOM_TARGET_ID)
  const [customTarget, setCustomTarget] = React.useState("")
  const [validation, setValidation] = React.useState<SessionMoveValidation | null>(null)
  const [validatedInput, setValidatedInput] = React.useState<string | null>(null)
  const [isValidating, setIsValidating] = React.useState(false)
  const [isMoving, setIsMoving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setSelectedTargetId(firstMovableTarget?.id ?? CUSTOM_TARGET_ID)
    setCustomTarget("")
    setValidation(null)
    setValidatedInput(null)
    setError(null)
    setIsValidating(false)
    setIsMoving(false)
  }, [firstMovableTarget?.id, open])

  const selectedTarget = targets.find((target) => target.id === selectedTargetId)
  const targetInput = selectedTargetId === CUSTOM_TARGET_ID ? customTarget.trim() : selectedTarget?.path || ""
  const canValidate = targetInput.length > 0 && !isValidating && !isMoving
  const canMove = Boolean(validation?.valid && validatedInput === targetInput && !isMoving && !isValidating)

  const handleSelectTarget = (targetId: string) => {
    setSelectedTargetId(targetId)
    setValidation(null)
    setValidatedInput(null)
    setError(null)
  }

  const handleValidate = async () => {
    if (!canValidate) return
    setIsValidating(true)
    setError(null)
    try {
      const result = await validateSessionMoveTarget(session.id, targetInput)
      setValidation(result)
      setValidatedInput(targetInput)
    } catch (err) {
      const message = err instanceof Error ? err.message : t("sessions.sidebar.sessionMove.validation.failed")
      setValidation(null)
      setValidatedInput(null)
      setError(message)
      toast.error(t("sessions.sidebar.sessionMove.validation.failed"), { description: message })
    } finally {
      setIsValidating(false)
    }
  }

  const handleMove = async () => {
    if (!canMove) return
    setIsMoving(true)
    setError(null)
    try {
      await moveSession(session.id, targetInput)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t("sessions.sidebar.sessionMove.moveFailed")
      setError(message)
      toast.error(t("sessions.sidebar.sessionMove.moveFailed"), { description: message })
    } finally {
      setIsMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="drag-move-2" className="h-5 w-5" />
            {t("sessions.sidebar.sessionMove.title")}
          </DialogTitle>
          <DialogDescription>{t("sessions.sidebar.sessionMove.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-2">
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                aria-pressed={selectedTargetId === target.id}
                onClick={() => handleSelectTarget(target.id)}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-left transition-colors",
                  "hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  selectedTargetId === target.id && "border-primary/50 bg-interactive-selection",
                )}
              >
                <Icon name={target.current ? "folder-open" : "folder"} className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate typography-ui-label">{target.label}</span>
                    {target.current ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 typography-micro text-muted-foreground">
                        {t("sessions.sidebar.sessionMove.current")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-2 typography-meta text-muted-foreground">
                    {target.branch ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Icon name="git-branch" className="h-3 w-3" />
                        <span className="truncate">{target.branch}</span>
                      </span>
                    ) : null}
                    <span className="truncate">{target.description || target.path}</span>
                    {target.dirty ? (
                      <span className="shrink-0 text-[var(--status-warning)]">
                        {t("sessions.sidebar.sessionMove.dirty")}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}

            <button
              type="button"
              aria-pressed={selectedTargetId === CUSTOM_TARGET_ID}
              onClick={() => handleSelectTarget(CUSTOM_TARGET_ID)}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-left transition-colors",
                "hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                selectedTargetId === CUSTOM_TARGET_ID && "border-primary/50 bg-interactive-selection",
              )}
            >
              <Icon name="folder-open" className="h-4 w-4 flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="typography-ui-label">{t("sessions.sidebar.sessionMove.customTarget")}</span>
                <span className="block truncate typography-meta text-muted-foreground">
                  {customTarget || t("sessions.sidebar.sessionMove.customTargetPlaceholder")}
                </span>
              </span>
            </button>
          </div>

          {selectedTargetId === CUSTOM_TARGET_ID ? (
            <Input
              value={customTarget}
              onChange={(event) => {
                setCustomTarget(event.target.value)
                setValidation(null)
                setValidatedInput(null)
                setError(null)
              }}
              placeholder={t("sessions.sidebar.sessionMove.customTargetPlaceholder")}
            />
          ) : null}

          <div className="rounded-md border border-border/60 px-3 py-2">
            <div className="flex items-start gap-2">
              <Icon
                name={validation?.valid ? "check" : error || validation ? "alert" : "folder"}
                className={cn(
                  "mt-0.5 h-4 w-4 flex-shrink-0",
                  validation?.valid
                    ? "text-[var(--status-success)]"
                    : error || validation
                      ? "text-[var(--status-warning)]"
                      : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="typography-ui-label">
                  {error
                    ? error
                    : validation
                      ? validationText(t, validation)
                      : t("sessions.sidebar.sessionMove.validation.pending")}
                </div>
                <div className="mt-0.5 truncate typography-meta text-muted-foreground">
                  {validation?.target.directory || targetInput || directoryLabel(currentDirectory ?? "")}
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMoving}>
            {t("sessions.sidebar.dialogs.cancel")}
          </Button>
          <Button variant="secondary" onClick={handleValidate} disabled={!canValidate}>
            {isValidating ? <Icon name="loader-4" className="h-4 w-4 animate-spin" /> : null}
            {t("sessions.sidebar.sessionMove.validate")}
          </Button>
          <Button onClick={handleMove} disabled={!canMove}>
            {isMoving ? <Icon name="loader-4" className="h-4 w-4 animate-spin" /> : null}
            {t("sessions.sidebar.sessionMove.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
