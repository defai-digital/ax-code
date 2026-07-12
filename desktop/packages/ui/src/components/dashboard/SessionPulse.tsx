import React from "react"
import { Button } from "@/components/ui/button"
import { EmptySurface } from "@/components/ui/EmptySurface"
import { Icon } from "@/components/icon/Icon"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import {
  formatDurationMs,
  formatTokenCount,
  type SessionPulseChange,
  type SessionPulseModel,
  type SessionPulseReadiness,
} from "./sessionPulseModel"

type SessionPulseProps = {
  model: SessionPulseModel
  loading?: boolean
  error?: string | null
  sessionTitle?: string | null
  onRefresh?: () => void
  onOpenFullReport?: () => void
  onOpenFile?: (path: string) => void
  onOpenDiff?: () => void
  onOpenChat?: () => void
}

const readinessToneClass: Record<SessionPulseReadiness, string> = {
  ready:
    "text-[var(--status-success)] border-[color-mix(in_srgb,var(--status-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_10%,transparent)]",
  needs_validation:
    "text-[var(--status-warning)] border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)]",
  needs_review:
    "text-[var(--status-warning)] border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)]",
  blocked:
    "text-[var(--status-error)] border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)]",
  unknown: "text-muted-foreground border-border/60 bg-[var(--surface-muted)]",
}

const riskDotClass = (risk: string): string => {
  const key = risk.toLowerCase()
  if (key === "critical" || key === "high") return "bg-[var(--status-error)]"
  if (key === "medium") return "bg-[var(--status-warning)]"
  if (key === "low") return "bg-[var(--status-success)]"
  return "bg-muted-foreground/50"
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border/50 bg-[var(--surface-elevated)] px-2 py-0.5 typography-micro text-muted-foreground">
      {children}
    </span>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="typography-micro font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ChangeRow({ change, onOpenFile }: { change: SessionPulseChange; onOpenFile?: (path: string) => void }) {
  const name = change.file.split("/").pop() || change.file
  return (
    <button
      type="button"
      onClick={() => onOpenFile?.(change.file)}
      disabled={!onOpenFile}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
        onOpenFile &&
          "hover:border-border/50 hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
        !onOpenFile && "cursor-default",
      )}
      title={change.file}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", riskDotClass(change.risk))} aria-hidden />
      <span className="min-w-0 flex-1 truncate typography-meta text-foreground">{name}</span>
      <span className="shrink-0 typography-micro text-muted-foreground capitalize">{change.kind}</span>
      <span className="shrink-0 font-mono typography-micro">
        <span className="text-[var(--status-success)]">+{change.additions}</span>{" "}
        <span className="text-[var(--status-error)]">-{change.deletions}</span>
      </span>
    </button>
  )
}

export const SessionPulse: React.FC<SessionPulseProps> = ({
  model,
  loading = false,
  error = null,
  sessionTitle,
  onRefresh,
  onOpenFullReport,
  onOpenFile,
  onOpenDiff,
  onOpenChat,
}) => {
  const { t } = useI18n()
  const durationLabel = formatDurationMs(model.durationMs)
  const tokensIn = formatTokenCount(model.tokensIn)
  const tokensOut = formatTokenCount(model.tokensOut)

  if (loading && !model.hasAnalysis) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex items-center gap-2 typography-meta text-muted-foreground">
          <Icon name="loader-4" className="h-4 w-4 animate-spin" />
          {t("dashboard.pulse.loading")}
        </div>
      </div>
    )
  }

  if (error && !model.hasAnalysis) {
    return (
      <EmptySurface
        icon={<Icon name="error-warning" className="size-10 text-muted-foreground opacity-[0.32]" />}
        title={t("dashboard.pulse.errorTitle")}
        description={error}
        actions={
          onRefresh ? (
            <Button type="button" size="sm" variant="outline" onClick={onRefresh} className="gap-1.5">
              <Icon name="refresh" className="h-3.5 w-3.5" />
              {t("dashboard.pulse.refresh")}
            </Button>
          ) : null
        }
      />
    )
  }

  if (!model.hasAnalysis) {
    return (
      <EmptySurface
        icon={<Icon name="bar-chart-box" className="size-10 text-muted-foreground opacity-[0.32]" />}
        title={t("dashboard.pulse.emptyTitle")}
        description={t("dashboard.pulse.emptyDescription")}
        actions={
          onOpenChat ? (
            <Button type="button" size="sm" variant="default" onClick={onOpenChat} className="gap-1.5">
              <Icon name="chat-1" className="h-3.5 w-3.5" />
              {t("dashboard.pulse.openChat")}
            </Button>
          ) : null
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
          {sessionTitle ? (
            <div className="truncate typography-micro text-muted-foreground" title={sessionTitle}>
              {sessionTitle}
            </div>
          ) : null}

          {/* Status card — BLUF, no gauges */}
          <div className={cn("rounded-lg border px-3.5 py-3", readinessToneClass[model.readiness])}>
            <div className="typography-ui-header font-medium tracking-tight text-inherit">{model.headline}</div>
            {model.decision ? (
              <p className="mt-1.5 typography-meta leading-relaxed text-foreground/90">{model.decision}</p>
            ) : null}
            {model.reason && model.reason !== model.decision ? (
              <p className="mt-1.5 typography-meta leading-relaxed text-foreground/80">{model.reason}</p>
            ) : null}
            {model.primaryActionHint ? (
              <p className="mt-2 typography-micro text-foreground/70">{model.primaryActionHint}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {model.filesChanged > 0 ? (
                <MetaChip>
                  {model.filesChanged} {t("dashboard.pulse.files")}
                </MetaChip>
              ) : null}
              {model.additions > 0 || model.deletions > 0 ? (
                <MetaChip>
                  <span className="text-[var(--status-success)]">+{model.additions}</span>
                  {" / "}
                  <span className="text-[var(--status-error)]">-{model.deletions}</span>
                </MetaChip>
              ) : null}
              {durationLabel ? <MetaChip>{durationLabel}</MetaChip> : null}
              {tokensIn || tokensOut ? (
                <MetaChip>
                  {tokensIn ?? "—"} in · {tokensOut ?? "—"} out
                </MetaChip>
              ) : null}
            </div>
          </div>

          {/* Changes */}
          <Section
            title={t("dashboard.pulse.changes")}
            action={
              onOpenDiff && model.changes.length > 0 ? (
                <button
                  type="button"
                  onClick={onOpenDiff}
                  className="typography-micro text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("dashboard.pulse.viewDiff")}
                </button>
              ) : null
            }
          >
            {model.changes.length === 0 ? (
              <p className="typography-meta text-muted-foreground">{t("dashboard.pulse.noChanges")}</p>
            ) : (
              <div className="rounded-lg border border-border/50 bg-[var(--surface-elevated)]/40 divide-y divide-border/40">
                {model.changes.map((change) => (
                  <ChangeRow key={change.file} change={change} onOpenFile={onOpenFile} />
                ))}
              </div>
            )}
          </Section>

          {/* Validation */}
          <Section title={t("dashboard.pulse.validation")}>
            <div className="rounded-lg border border-border/50 bg-[var(--surface-elevated)]/40 px-3 py-2.5 space-y-2">
              <p className="typography-meta text-foreground">{model.validation.summary}</p>
              {model.validation.commands.length > 0 ? (
                <ul className="space-y-1">
                  {model.validation.commands.map((cmd) => (
                    <li key={cmd} className="flex items-start gap-2 font-mono typography-micro text-muted-foreground">
                      <Icon
                        name={model.validation.state === "failed" ? "close-circle" : "checkbox-circle"}
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          model.validation.state === "failed"
                            ? "text-[var(--status-error)]"
                            : model.validation.state === "passed"
                              ? "text-[var(--status-success)]"
                              : "text-muted-foreground",
                        )}
                      />
                      <span className="break-all">{cmd}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Section>

          {/* Drivers / unknowns — only when present */}
          {(model.drivers.length > 0 || model.unknowns.length > 0 || model.mitigations.length > 0) && (
            <Section title={t("dashboard.pulse.notes")}>
              <ul className="space-y-1.5">
                {model.unknowns.map((item) => (
                  <li key={`u-${item}`} className="flex gap-2 typography-meta text-foreground/90">
                    <span className="text-[var(--status-warning)] shrink-0">?</span>
                    <span>{item}</span>
                  </li>
                ))}
                {model.mitigations.map((item) => (
                  <li key={`m-${item}`} className="flex gap-2 typography-meta text-foreground/90">
                    <span className="text-[var(--status-success)] shrink-0">→</span>
                    <span>{item}</span>
                  </li>
                ))}
                {model.drivers.map((item) => (
                  <li key={`d-${item}`} className="flex gap-2 typography-meta text-muted-foreground">
                    <span className="shrink-0">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {onOpenFullReport ? (
            <div className="pt-1 pb-2">
              <Button type="button" size="sm" variant="ghost" onClick={onOpenFullReport} className="gap-1.5 w-full">
                <Icon name="external-link" className="h-3.5 w-3.5" />
                {t("dashboard.pulse.fullReport")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
