import React, { memo } from 'react';
import type { PermissionRequest } from '@/types/permission';
import { suggestAllowPattern } from '@/lib/permissions/patternGeneralizer';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

interface AllowPatternBuilderProps {
    permission: PermissionRequest;
    onConfirm: (pattern: string) => void;
    onCancel: () => void;
}

export const AllowPatternBuilder: React.FC<AllowPatternBuilderProps> = memo(({ permission, onConfirm, onCancel }) => {
    const { t } = useI18n();
    const suggestions = React.useMemo(() => suggestAllowPattern(permission), [permission]);
    const [selectedPattern, setSelectedPattern] = React.useState(suggestions[0] ?? `${permission.permission} *`);
    const [isCustom, setIsCustom] = React.useState(false);

    return (
        <div className="px-2 py-2 border-t border-border/20">
            <div className="typography-meta font-medium text-muted-foreground mb-1.5">
                {t('chat.permissionCard.patternBuilder.title')}
            </div>
            {suggestions.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                    {suggestions.map((pattern) => (
                        <button
                            key={pattern}
                            type="button"
                            onClick={() => {
                                setSelectedPattern(pattern);
                                setIsCustom(false);
                            }}
                            className={cn(
                                'typography-meta px-2 py-1 rounded text-left transition-colors',
                                selectedPattern === pattern && !isCustom
                                    ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selectionForeground)]'
                                    : 'bg-muted/30 hover:bg-muted/50',
                            )}
                        >
                            {pattern}
                        </button>
                    ))}
                </div>
            )}
            <div className="flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={() => setIsCustom(true)}
                    className={cn(
                        'typography-meta px-2 py-1 rounded transition-colors',
                        isCustom
                            ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selectionForeground)]'
                            : 'bg-muted/30 hover:bg-muted/50',
                    )}
                >
                    {t('chat.permissionCard.patternBuilder.custom')}
                </button>
                {isCustom && (
                    <input
                        type="text"
                        value={selectedPattern}
                        onChange={(e) => setSelectedPattern(e.target.value)}
                        className="flex-1 typography-meta px-2 py-1 rounded border border-border/30 bg-transparent text-foreground min-w-0"
                        placeholder={`${permission.permission} <pattern>`}
                        autoFocus
                    />
                )}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
                <Button
                    type="button"
                    variant="default"
                    size="xs"
                    disabled={!selectedPattern.trim()}
                    onClick={() => onConfirm(selectedPattern.trim())}
                >
                    {t('chat.permissionCard.patternBuilder.confirm')}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={onCancel}
                >
                    {t('chat.permissionCard.patternBuilder.cancel')}
                </Button>
            </div>
        </div>
    );
});

AllowPatternBuilder.displayName = 'AllowPatternBuilder';

function cn(...inputs: (string | false | null | undefined | Record<string, boolean>)[]): string {
    return inputs
        .flat()
        .filter(Boolean)
        .join(' ');
}