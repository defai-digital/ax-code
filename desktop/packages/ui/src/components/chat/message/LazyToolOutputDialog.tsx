import React from 'react';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import type { ToolOutputDialogProps } from './ToolOutputDialog';

const ToolOutputDialog = lazyWithChunkRecovery(() => import('./ToolOutputDialog'));
const CLOSE_UNMOUNT_DELAY_MS = 200;

export const LazyToolOutputDialog: React.FC<ToolOutputDialogProps> = (props) => {
  const [shouldRender, setShouldRender] = React.useState(props.popup.open);

  React.useEffect(() => {
    if (props.popup.open) {
      setShouldRender(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      setShouldRender(false);
    }, CLOSE_UNMOUNT_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [props.popup.open]);

  if (!shouldRender) {
    return null;
  }

  return (
    <React.Suspense fallback={null}>
      <ToolOutputDialog {...props} />
    </React.Suspense>
  );
};
