import { Skeleton } from './skeleton';

/**
 * Content-shaped placeholder for a main view's initial load — a header bar
 * and a fading list of rows — so first paint suggests the layout instead of
 * a blank pane or a lone spinner.
 */
export function ViewLoadingSkeleton({ rows = 6, label }: { rows?: number; label?: string }) {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-4" role="status" aria-busy="true" aria-label={label}>
      <Skeleton className="h-7 w-1/3" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" style={{ opacity: Math.max(0.2, 1 - index * 0.15) }} />
      ))}
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
