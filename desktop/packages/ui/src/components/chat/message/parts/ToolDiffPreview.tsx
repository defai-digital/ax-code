import React from 'react';
import { PatchDiff } from '@pierre/diffs/react';

import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { ensurePierreThemeRegistered } from '@/lib/shiki/appThemeRegistry';
import { getDefaultTheme } from '@/lib/theme/themes';
import type { ToolDiffPreviewProps } from './LazyToolDiffPreview';

const TOOL_DIFF_UNSAFE_CSS = `
  [data-diff-header],
  [data-diff] {
    [data-separator] {
      height: 24px !important;
    }
  }
`;

const TOOL_DIFF_METRICS = {
  hunkLineCount: 50,
  lineHeight: 24,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 24,
  spacing: 0,
};

const PlainDiffFallback: React.FC<{ diff: string }> = ({ diff }) => (
  <pre
    className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-lg p-2 typography-code"
    style={{
      backgroundColor: 'var(--syntax-base-background)',
      color: 'var(--syntax-base-foreground)',
    }}
  >
    {diff}
  </pre>
);

class DiffPreviewErrorBoundary extends React.Component<{
  resetKey: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
}, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Tool diff preview failed; rendering raw patch instead.', error);
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const usePierreThemeConfig = () => {
  const themeSystem = useOptionalThemeSystem();
  const fallbackLightTheme = React.useMemo(() => getDefaultTheme(false), []);
  const fallbackDarkTheme = React.useMemo(() => getDefaultTheme(true), []);

  const availableThemes = React.useMemo(
    () => themeSystem?.availableThemes ?? [fallbackLightTheme, fallbackDarkTheme],
    [fallbackDarkTheme, fallbackLightTheme, themeSystem?.availableThemes],
  );
  const lightThemeId = themeSystem?.lightThemeId ?? fallbackLightTheme.metadata.id;
  const darkThemeId = themeSystem?.darkThemeId ?? fallbackDarkTheme.metadata.id;

  const lightTheme = React.useMemo(
    () => availableThemes.find((theme) => theme.metadata.id === lightThemeId) ?? fallbackLightTheme,
    [availableThemes, fallbackLightTheme, lightThemeId],
  );
  const darkTheme = React.useMemo(
    () => availableThemes.find((theme) => theme.metadata.id === darkThemeId) ?? fallbackDarkTheme,
    [availableThemes, darkThemeId, fallbackDarkTheme],
  );

  React.useEffect(() => {
    ensurePierreThemeRegistered(lightTheme);
    ensurePierreThemeRegistered(darkTheme);
  }, [darkTheme, lightTheme]);

  const currentVariant = themeSystem?.currentTheme.metadata.variant ?? 'light';

  return {
    pierreTheme: { light: lightTheme.metadata.id, dark: darkTheme.metadata.id },
    pierreThemeType: currentVariant === 'dark' ? ('dark' as const) : ('light' as const),
  };
};

export const ToolDiffPreview: React.FC<ToolDiffPreviewProps> = React.memo(({ diff, diffViewMode }) => {
  const { pierreTheme, pierreThemeType } = usePierreThemeConfig();
  const options = React.useMemo(
    () => ({
      diffStyle: diffViewMode === 'side-by-side' ? 'split' as const : 'unified' as const,
      diffIndicators: 'none' as const,
      hunkSeparators: 'line-info-basic' as const,
      lineDiffType: 'none' as const,
      disableFileHeader: true,
      maxLineDiffLength: 1000,
      expansionLineCount: 20,
      overflow: 'wrap' as const,
      theme: pierreTheme,
      themeType: pierreThemeType,
      unsafeCSS: TOOL_DIFF_UNSAFE_CSS,
    }),
    [diffViewMode, pierreTheme, pierreThemeType],
  );

  const fallback = <PlainDiffFallback diff={diff} />;

  return (
    <div className="typography-code px-1 pb-1 pt-0">
      <DiffPreviewErrorBoundary resetKey={diff} fallback={fallback}>
        <PatchDiff
          patch={diff}
          metrics={TOOL_DIFF_METRICS}
          options={options}
          className="block w-full"
        />
      </DiffPreviewErrorBoundary>
    </div>
  );
});

ToolDiffPreview.displayName = 'ToolDiffPreview';
