import React from 'react';
import { AxCodeIcon } from '@/components/ui/AxCodeIcon';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useGlobalSyncStore } from '@/sync/global-sync-store';
import { useI18n } from '@/lib/i18n';

const ChatEmptyState: React.FC = () => {
    const { t } = useI18n();
    const { currentTheme } = useThemeSystem();
    const initError = useGlobalSyncStore((s) => s.error);

    const textColor = currentTheme?.colors?.surface?.mutedForeground || 'var(--muted-foreground)';

    return (
        <div className="flex flex-col items-center justify-center min-h-full w-full gap-6">
            <AxCodeIcon width={140} height={140} className="opacity-[0.13]" />
            {initError ? (
                <div className="flex flex-col items-center gap-2 max-w-md text-center px-4">
                    <span className="text-body-md font-medium text-destructive">{t('chat.emptyState.axCodeUnreachable')}</span>
                    <span className="text-body-sm" style={{ color: textColor }}>
                        {initError.message}
                    </span>
                </div>
            ) : (
                <div className="flex flex-col items-center gap-1.5 text-center">
                    <span className="text-body-md" style={{ color: textColor }}>{t('chat.emptyState.startNewChat')}</span>
                    <span className="text-body-sm opacity-60" style={{ color: textColor }}>{t('chat.emptyState.tagline')}</span>
                </div>
            )}
        </div>
    );
};

export default React.memo(ChatEmptyState);
