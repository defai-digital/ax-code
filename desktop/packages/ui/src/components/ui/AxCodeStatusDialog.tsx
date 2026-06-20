import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui';
import { useUIStore } from '@/stores/useUIStore';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';

export const AxCodeStatusDialog: React.FC = () => {
  const { t } = useI18n();
  const isAxCodeStatusDialogOpen = useUIStore((state) => state.isAxCodeStatusDialogOpen);
  const setAxCodeStatusDialogOpen = useUIStore((state) => state.setAxCodeStatusDialogOpen);
  const axCodeStatusText = useUIStore((state) => state.axCodeStatusText);

  const handleCopy = React.useCallback(async () => {
    if (!axCodeStatusText) {
      return;
    }

    const result = await copyTextToClipboard(axCodeStatusText);
    if (result.ok) {
      toast.success(t('axCodeStatusDialog.toast.copiedTitle'), { description: t('axCodeStatusDialog.toast.copiedDescription') });
      return;
    }
    toast.error(t('axCodeStatusDialog.toast.copyFailed'));
  }, [axCodeStatusText, t]);

  return (
    <Dialog open={isAxCodeStatusDialogOpen} onOpenChange={setAxCodeStatusDialogOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('axCodeStatusDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('axCodeStatusDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleCopy}
            className="app-region-no-drag inline-flex h-9 items-center justify-center rounded-md px-3 typography-ui-label font-medium text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('axCodeStatusDialog.actions.copy')}
          </button>
        </div>

        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-surface-muted p-4 typography-code text-foreground whitespace-pre-wrap">
          {axCodeStatusText || t('axCodeStatusDialog.empty.noData')}
        </pre>
      </DialogContent>
    </Dialog>
  );
};
