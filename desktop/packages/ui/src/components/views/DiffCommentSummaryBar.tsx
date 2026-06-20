import React, { memo } from 'react';
import { useInlineCommentDraftStore, type InlineCommentDraft } from '@/stores/useInlineCommentDraftStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useConfigStore } from '@/stores/useConfigStore';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { formatInlineCommentDrafts } from '@/lib/messages/inlineComments';
import { toast } from '@/components/ui';

interface DiffCommentSummaryBarProps {
    sessionKey: string;
}

const EMPTY_DRAFTS: InlineCommentDraft[] = [];

export const DiffCommentSummaryBar: React.FC<DiffCommentSummaryBarProps> = memo(({ sessionKey }) => {
    const { t } = useI18n();
    const drafts = useInlineCommentDraftStore(
        React.useCallback((s) => s.drafts[sessionKey] ?? EMPTY_DRAFTS, [sessionKey]),
    );
    const consumeDrafts = useInlineCommentDraftStore((s) => s.consumeDrafts);
    const clearDrafts = useInlineCommentDraftStore((s) => s.clearDrafts);
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const draftCount = drafts.length;

    if (draftCount === 0) return null;

    const handleSendToAgent = async () => {
        if (!currentSessionId) {
            toast.error(t('diffView.comments.noSession'));
            return;
        }

        const consumed = consumeDrafts(sessionKey);
        if (!consumed || consumed.length === 0) return;

        const formatted = formatInlineCommentDrafts(consumed);
        const config = useConfigStore.getState();
        const providerId = config.currentProviderId ?? '';
        const modelId = config.currentModelId ?? '';

        try {
            await useSessionUIStore.getState().sendMessage(
                formatted,
                providerId,
                modelId,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                'normal',
                { sessionId: currentSessionId },
            );
            toast.success(t('diffView.comments.sent'));
        } catch {
            toast.error(t('diffView.comments.sendFailed'));
        }
    };

    const handleDiscard = () => {
        clearDrafts(sessionKey);
    };

    return (
        <div className="sticky bottom-0 z-20 flex items-center gap-3 px-3 py-2 border-t border-border/60 bg-[var(--surface-elevated)] shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
            <Icon name="chat-1" className="h-4 w-4 text-[var(--status-info)] flex-shrink-0" aria-hidden="true" />
            <span className="typography-ui-label font-medium text-foreground flex-shrink-0">
                {t('diffView.comments.summaryTitle', { count: draftCount })}
            </span>
            <div className="flex-1" />
            <Button
                type="button"
                variant="default"
                size="xs"
                onClick={handleSendToAgent}
            >
                <Icon name="send-plane" className="h-3 w-3 mr-1" aria-hidden="true" />
                {t('diffView.comments.send')}
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={handleDiscard}
            >
                {t('diffView.comments.discard')}
            </Button>
        </div>
    );
});

DiffCommentSummaryBar.displayName = 'DiffCommentSummaryBar';