import { Button } from "@/components/ui/button"
import { CommitInput } from "./CommitInput"
import { AIHighlightsBox } from "./AIHighlightsBox"
import { useDeviceInfo } from "@/lib/device"
import { Icon } from "@/components/icon/Icon"
import { useI18n } from "@/lib/i18n"
import type { CommitAction } from "./types"

interface CommitSectionProps {
  stagedCount: number
  commitMessage: string
  onCommitMessageChange: (value: string) => void
  generatedHighlights: string[]
  onInsertHighlights: (highlights: string[]) => void
  onGenerateMessage: () => void
  isGeneratingMessage: boolean
  onCommit: () => void
  commitAction: CommitAction
  hasPendingIndexMutation?: boolean
  gitmojiEnabled: boolean
  onOpenGitmojiPicker: () => void
}

export const CommitSection: React.FC<CommitSectionProps> = ({
  stagedCount,
  commitMessage,
  onCommitMessageChange,
  generatedHighlights,
  onInsertHighlights,
  onGenerateMessage,
  isGeneratingMessage,
  onCommit,
  commitAction,
  hasPendingIndexMutation = false,
  gitmojiEnabled,
  onOpenGitmojiPicker,
}) => {
  const { t } = useI18n()
  const hasStagedFiles = stagedCount > 0
  const canCommit = commitMessage.trim() && hasStagedFiles && commitAction === null && !hasPendingIndexMutation
  const { isMobile, hasTouchInput } = useDeviceInfo()

  const containerClassName = "border-0 bg-transparent rounded-none"
  const headerClassName = "flex w-full items-baseline gap-2 px-0 pt-2 pb-1"
  const contentClassName = "flex flex-col gap-3 px-0 pt-1 pb-3"

  return (
    <section className={containerClassName}>
      <div className={headerClassName}>
        <h3 className="typography-ui-header font-semibold text-foreground">{t("gitView.commit.title")}</h3>
        {!hasStagedFiles ? (
          <span className="min-w-0 truncate typography-meta text-muted-foreground">
            {t("gitView.commit.stageFilesHint")}
          </span>
        ) : null}
      </div>

      <div className={contentClassName}>
        <AIHighlightsBox highlights={generatedHighlights} onInsert={onInsertHighlights} />

        <CommitInput
          value={commitMessage}
          onChange={onCommitMessageChange}
          placeholder={t("gitView.commit.messagePlaceholder")}
          disabled={commitAction !== null}
          hasTouchInput={hasTouchInput}
          isMobile={isMobile}
        />

        {gitmojiEnabled && (
          <Button variant="outline" size="sm" onClick={onOpenGitmojiPicker} className="w-fit" type="button">
            <Icon name="emotion-happy" className="size-4" />
            {t("gitView.commit.addGitmoji")}
          </Button>
        )}

        <div className="@container/commit-actions flex items-center gap-2 min-w-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerateMessage}
            disabled={isGeneratingMessage || commitAction !== null || hasPendingIndexMutation || stagedCount === 0}
            type="button"
            aria-label={t("gitView.commit.generateAria")}
            className="commit-actions__btn"
          >
            {isGeneratingMessage ? (
              <Icon name="loader-4" className="size-4 animate-spin" />
            ) : (
              <Icon name="ai-generate-2" className="size-4 text-primary" />
            )}
            <span className="commit-actions__label">{t("gitView.commit.generate")}</span>
          </Button>

          <div className="flex-1" />

          <Button
            size="sm"
            variant="outline"
            onClick={onCommit}
            disabled={!canCommit || isGeneratingMessage}
            className="commit-actions__btn whitespace-nowrap"
            aria-label={t("gitView.commit.commitAria")}
          >
            {commitAction === "commit" ? (
              <>
                <Icon name="loader-4" className="size-4 animate-spin" />
                <span className="commit-actions__label">{t("gitView.commit.committing")}</span>
              </>
            ) : (
              <>
                <Icon name="git-commit" className="size-4" />
                <span className="commit-actions__label">{t("gitView.commit.commit")}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}
