import React, { useMemo, useEffect, useRef, useState } from 'react';
import type { SupportedLanguages } from '@pierre/diffs';
import type { WorkerPoolManager } from '@pierre/diffs/worker';

import { useOptionalThemeSystem } from './useThemeSystem';
import { workerFactory } from '@/lib/diff/workerFactory';
import { getDefaultTheme } from '@/lib/theme/themes';
// NOTE: keep provider lightweight; avoid main-thread diff parsing here.

// Preload common languages for faster initial diff rendering
const PRELOAD_LANGS: SupportedLanguages[] = [
  // Keep small; workers load others on-demand.
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'markdown',
];

interface DiffWorkerProviderProps {
  children: React.ReactNode;
}

type WorkerPoolStyle = 'unified' | 'split';

const WORKER_POOL_CONFIG: Record<WorkerPoolStyle, { poolSize: number; totalASTLRUCacheSize: number; lineDiffType: 'none' | 'word-alt' }> = {
  unified: {
    poolSize: 1,
    totalASTLRUCacheSize: 24,
    lineDiffType: 'none',
  },
  split: {
    poolSize: 2,
    totalASTLRUCacheSize: 56,
    lineDiffType: 'word-alt',
  },
};

let unifiedWorkerPool: WorkerPoolManager | undefined;
let splitWorkerPool: WorkerPoolManager | undefined;
let unifiedWorkerPoolPromise: Promise<WorkerPoolManager | undefined> | undefined;
let splitWorkerPoolPromise: Promise<WorkerPoolManager | undefined> | undefined;

const createWorkerPool = async (style: WorkerPoolStyle): Promise<WorkerPoolManager | undefined> => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const { WorkerPoolManager: WorkerPoolManagerConstructor } = await import('@pierre/diffs/worker');
  const config = WORKER_POOL_CONFIG[style];
  const pool = new WorkerPoolManagerConstructor(
    {
      workerFactory,
      poolSize: config.poolSize,
      totalASTLRUCacheSize: config.totalASTLRUCacheSize,
    },
    {
      theme: {
        light: 'pierre-light',
        dark: 'pierre-dark',
      },
      langs: PRELOAD_LANGS,
      lineDiffType: config.lineDiffType,
      preferredHighlighter: 'shiki-wasm',
    }
  );
  void pool.initialize();
  return pool;
};

const getExistingWorkerPool = (style: WorkerPoolStyle): WorkerPoolManager | undefined => {
  return style === 'split' ? splitWorkerPool : unifiedWorkerPool;
};

const ensureWorkerPool = (style: WorkerPoolStyle): Promise<WorkerPoolManager | undefined> => {
  if (typeof window === 'undefined') {
    return Promise.resolve(undefined);
  }

  if (style === 'split') {
    if (splitWorkerPool) {
      return Promise.resolve(splitWorkerPool);
    }
    splitWorkerPoolPromise ??= createWorkerPool('split')
      .then((pool) => {
        splitWorkerPool = pool;
        return pool;
      })
      .catch((error) => {
        // Clear the cached promise so a later call can retry instead of
        // permanently resolving to a rejected import.
        splitWorkerPoolPromise = undefined;
        console.warn('[DiffWorkerProvider] Failed to create split worker pool:', error);
        return undefined;
      });
    return splitWorkerPoolPromise;
  }

  if (unifiedWorkerPool) {
    return Promise.resolve(unifiedWorkerPool);
  }
  unifiedWorkerPoolPromise ??= createWorkerPool('unified')
    .then((pool) => {
      unifiedWorkerPool = pool;
      return pool;
    })
    .catch((error) => {
      unifiedWorkerPoolPromise = undefined;
      console.warn('[DiffWorkerProvider] Failed to create unified worker pool:', error);
      return undefined;
    });
  return unifiedWorkerPoolPromise;
};

const syncPoolRenderTheme = (renderTheme: { light: string; dark: string }) => {
  // Only sync pools that already exist — never create them here.
  if (unifiedWorkerPool) {
    void unifiedWorkerPool.setRenderOptions({
      theme: renderTheme,
      lineDiffType: WORKER_POOL_CONFIG.unified.lineDiffType,
    });
  }
  if (splitWorkerPool) {
    void splitWorkerPool.setRenderOptions({
      theme: renderTheme,
      lineDiffType: WORKER_POOL_CONFIG.split.lineDiffType,
    });
  }
};

const WorkerPoolWarmup: React.FC<{
  children: React.ReactNode;
  renderTheme: { light: string; dark: string };
}> = ({ children, renderTheme }) => {
  const renderThemeRef = useRef(renderTheme);
  useEffect(() => {
    renderThemeRef.current = renderTheme;
  }, [renderTheme]);

  // Defer worker-pool creation off the cold-start critical path. Creating a pool
  // loads the Shiki highlighter + preload languages inside the worker (a separate,
  // chunk-split ~7MB payload); doing that during initial app load competes with
  // first paint. Warm the pools once the main thread goes idle instead. If the
  // user opens a diff before then, useWorkerPool creates the pool on demand and
  // PierreDiffViewer passes its own per-diff theme, so nothing is lost by waiting.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void Promise.all([ensureWorkerPool('unified'), ensureWorkerPool('split')]).then(() => {
        syncPoolRenderTheme(renderThemeRef.current);
      });
    };

    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') {
      const handle = idle(warm, { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(handle);
      };
    }
    const handle = window.setTimeout(warm, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  // Keep already-warmed pools in sync with theme changes.
  useEffect(() => {
    syncPoolRenderTheme(renderTheme);
  }, [renderTheme]);

  return <>{children}</>;
};

export const DiffWorkerProvider: React.FC<DiffWorkerProviderProps> = ({ children }) => {
  const themeSystem = useOptionalThemeSystem();

  const fallbackLight = getDefaultTheme(false);
  const fallbackDark = getDefaultTheme(true);

  const lightThemeId = themeSystem?.lightThemeId ?? fallbackLight.metadata.id;
  const darkThemeId = themeSystem?.darkThemeId ?? fallbackDark.metadata.id;

  const lightTheme =
    themeSystem?.availableThemes.find((theme) => theme.metadata.id === lightThemeId) ??
    fallbackLight;
  const darkTheme =
    themeSystem?.availableThemes.find((theme) => theme.metadata.id === darkThemeId) ??
    fallbackDark;

  useEffect(() => {
    let cancelled = false;

    void import('@/lib/shiki/appThemeRegistry').then(({ ensurePierreThemeRegistered }) => {
      if (cancelled) {
        return;
      }
      ensurePierreThemeRegistered(lightTheme);
      ensurePierreThemeRegistered(darkTheme);
    });

    return () => {
      cancelled = true;
    };
  }, [darkTheme, lightTheme]);

  const renderTheme = useMemo(
    () => ({
      light: lightTheme.metadata.id,
      dark: darkTheme.metadata.id,
    }),
    [darkTheme.metadata.id, lightTheme.metadata.id],
  );

  return (
    <WorkerPoolWarmup renderTheme={renderTheme}>
      {children}
    </WorkerPoolWarmup>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useWorkerPool = (style: WorkerPoolStyle = 'unified'): WorkerPoolManager | undefined => {
  const [pool, setPool] = useState<WorkerPoolManager | undefined>(() => getExistingWorkerPool(style));

  useEffect(() => {
    let cancelled = false;
    setPool(getExistingWorkerPool(style));
    void ensureWorkerPool(style).then((nextPool) => {
      if (!cancelled) {
        setPool(nextPool);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [style]);

  return pool;
};
