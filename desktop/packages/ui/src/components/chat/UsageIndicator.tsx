import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSession } from '@/sync/sync-context';
import { useConfigStore } from '@/stores/useConfigStore';
import { ContextUsageDisplay } from '@/components/ui/ContextUsageDisplay';
import { useUIStore } from '@/stores/useUIStore';

export const UsageIndicator: React.FC = React.memo(() => {
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
  const getContextUsage = useSessionUIStore((s) => s.getContextUsage);
  const getCurrentModel = useConfigStore((s) => s.getCurrentModel);
  const setSettingsPage = useUIStore((s) => s.setSettingsPage);
  const setSettingsDialogOpen = useUIStore((s) => s.setSettingsDialogOpen);
  // getContextUsage reads sync state imperatively; subscribing to the session
  // is what re-renders this component as turns complete (same pattern as
  // Header's context usage display).
  const session = useSession(currentSessionId ?? null);

  const currentModel = getCurrentModel();
  const limit = currentModel && typeof currentModel.limit === 'object' && currentModel.limit !== null
    ? (currentModel.limit as Record<string, unknown>)
    : null;
  const contextLimit = (limit && typeof limit.context === 'number' ? limit.context : 0);
  const outputLimit = (limit && typeof limit.output === 'number' ? limit.output : 0);

  const usage = currentSessionId && session ? getContextUsage(contextLimit, outputLimit) : null;

  const handleClick = React.useCallback(() => {
    setSettingsPage('usage');
    setSettingsDialogOpen(true);
  }, [setSettingsPage, setSettingsDialogOpen]);

  if (!usage || !currentSessionId || contextLimit <= 0) return null;

  return (
    <ContextUsageDisplay
      totalTokens={usage.totalTokens}
      percentage={usage.percentage}
      colorPercentage={usage.percentage}
      contextLimit={usage.contextLimit}
      outputLimit={usage.outputLimit}
      size="compact"
      hideIcon
      showPercentIcon
      onClick={handleClick}
    />
  );
});

UsageIndicator.displayName = 'UsageIndicator';
