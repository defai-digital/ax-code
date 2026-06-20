import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import { isDesktopShell, isTauriShell } from '@/lib/desktop';
import { API_ENDPOINTS } from '@/lib/http';
import { updateDesktopSettings } from '@/lib/persistence';
import { reloadAxCodeConfiguration } from '@/stores/useAgentsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';

export const AxCodeCliSettings: React.FC = () => {
  const { t } = useI18n();
  const [value, setValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const showAxCodeUpdateNotifications = useUIStore((state) => state.showAxCodeUpdateNotifications);
  const setShowAxCodeUpdateNotifications = useUIStore((state) => state.setShowAxCodeUpdateNotifications);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(API_ENDPOINTS.config.settings, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json().catch(() => null)) as null | { axCodeBinary?: unknown };
        if (cancelled || !data) {
          return;
        }
        const next = typeof data.axCodeBinary === 'string' ? data.axCodeBinary.trim() : '';
        setValue(next);
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBrowse = React.useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!isDesktopShell() || !isTauriShell()) {
      return;
    }

    const tauri = (window as unknown as { __TAURI__?: { dialog?: { open?: (opts: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__;
    if (!tauri?.dialog?.open) {
      return;
    }

    try {
      const selected = await tauri.dialog.open({
        title: t('settings.openchamber.axCodeCli.dialog.selectBinaryTitle'),
        multiple: false,
        directory: false,
      });
      if (typeof selected === 'string' && selected.trim().length > 0) {
        setValue(selected.trim());
      }
    } catch {
      // ignore
    }
  }, [t]);

  const handleSaveAndReload = React.useCallback(async () => {
    setIsSaving(true);
    try {
      await updateDesktopSettings({ axCodeBinary: value.trim() });
      await reloadAxCodeConfiguration({
        message: t('settings.openchamber.axCodeCli.actions.restartingAxCode'),
        mode: 'projects',
        scopes: ['all'],
      });
    } finally {
      setIsSaving(false);
    }
  }, [t, value]);

  return (
    <div className="mb-8">
      <div className="mb-1 px-1">
        <div className="flex items-center gap-2">
          <h3 className="typography-ui-header font-medium text-foreground">
            {t('settings.openchamber.axCodeCli.title')}
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Icon name="information" className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent sideOffset={8} className="max-w-xs">
              {t('settings.openchamber.axCodeCli.tooltipPrefix')}
              {' '}
              <code className="font-mono text-xs">ax-code</code>
              {t('settings.openchamber.axCodeCli.tooltipSuffix')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <section className="px-2 pb-2 pt-0 space-y-0.5">
        <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-col shrink-0">
            <span className="typography-ui-label text-foreground">{t('settings.openchamber.axCodeCli.field.binaryPath')}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:w-[20rem]">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('settings.openchamber.axCodeCli.field.binaryPathPlaceholder')}
              disabled={isLoading || isSaving}
              className="h-7 min-w-0 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleBrowse}
              disabled={isLoading || isSaving || !isDesktopShell() || !isTauriShell()}
              className="h-7 w-7 p-0"
              aria-label={t('settings.openchamber.axCodeCli.actions.browseAria')}
              title={t('settings.openchamber.axCodeCli.actions.browse')}
            >
              <Icon name="folder" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="py-1.5">
          <div className="typography-micro text-muted-foreground/70">
            {t('settings.openchamber.axCodeCli.tipPrefix')}
            {' '}
            <span className="font-mono">AX_CODE_BINARY</span>
            {' '}
            {t('settings.openchamber.axCodeCli.tipMiddle')}
            {' '}
            <span className="font-mono">~/.config/openchamber/settings.json</span>
            {'.'}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 py-1.5">
          <Checkbox
            checked={showAxCodeUpdateNotifications}
            onChange={setShowAxCodeUpdateNotifications}
            ariaLabel={t('settings.openchamber.axCodeCli.field.showUpdateNotificationsAria')}
          />
          <span className="typography-ui-label text-foreground">
            {t('settings.openchamber.axCodeCli.field.showUpdateNotifications')}
          </span>
        </label>

        <div className="flex justify-start py-1.5">
          <Button
            type="button"
            size="xs"
            onClick={handleSaveAndReload}
            disabled={isLoading || isSaving}
            className="shrink-0 !font-normal"
          >
            {isSaving ? t('settings.common.actions.saving') : t('settings.openchamber.axCodeCli.actions.saveAndReload')}
          </Button>
        </div>
      </section>
    </div>
  );
};
