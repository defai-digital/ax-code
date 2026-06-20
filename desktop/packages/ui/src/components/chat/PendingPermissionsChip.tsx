import React, { memo } from 'react';
import { useI18n } from '@/lib/i18n';
import { useDirectorySync } from '@/sync/sync-context';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessions } from '@/sync/sync-context';
import { Icon } from '@/components/icon/Icon';
import { collectVisibleSessionIdsForBlockingRequests, flattenBlockingRequests } from './lib/blockingRequests';

export const PendingPermissionsChip = memo(() => {
    const { t } = useI18n();
    const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
    const sessions = useSessions();
    const allPermissions = useDirectorySync(
        React.useCallback((s) => s.permission ?? {}, []),
    );

    const scopedSessionIds = React.useMemo(
        () => collectVisibleSessionIdsForBlockingRequests(
            sessions.map((session) => ({ id: session.id, parentID: session.parentID })),
            currentSessionId,
        ),
        [sessions, currentSessionId],
    );

    const permissionsMap = React.useMemo(() => {
        const m = new Map<string, import('@/types/permission').PermissionRequest[]>();
        for (const [k, v] of Object.entries(allPermissions)) m.set(k, v as import('@/types/permission').PermissionRequest[]);
        return m;
    }, [allPermissions]);

    const permissionCount = React.useMemo(
        () => flattenBlockingRequests(permissionsMap, scopedSessionIds).length,
        [permissionsMap, scopedSessionIds],
    );

    if (permissionCount <= 1) return null;

    return (
        <div className="pb-1.5 w-full px-1">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/60 bg-[var(--surface-elevated)] text-[var(--surface-elevated-foreground)] shadow-sm">
                <Icon name="shield-user" className="h-4 w-4 text-[var(--status-warning)] flex-shrink-0" aria-hidden="true" />
                <span className="typography-ui-label font-medium text-foreground">
                    {t('chat.permissionCard.pendingSummary.title', { count: permissionCount })}
                </span>
                <Icon name="arrow-down-s" className="h-3.5 w-3.5 text-muted-foreground ml-auto flex-shrink-0" aria-hidden="true" />
            </div>
        </div>
    );
});

PendingPermissionsChip.displayName = 'PendingPermissionsChip';