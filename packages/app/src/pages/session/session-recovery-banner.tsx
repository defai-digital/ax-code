import { Button } from "@ax-code/ui/button"
import { Icon } from "@ax-code/ui/icon"
import { Show } from "solid-js"

export function SessionRecoveryBanner(props: {
  title: string
  message: string
  actionLabel?: string
  dismissLabel: string
  onAction?: () => void
  onDismiss: () => void
}) {
  return (
    <div class="mb-2 rounded-xl border border-border-weak-base bg-background-base/90 px-4 py-3 shadow-[var(--shadow-xs-border-base)] backdrop-blur-sm">
      <div class="flex items-start gap-3">
        <div class="mt-0.5 shrink-0 rounded-full bg-surface-raised-base p-1.5 text-icon-warning-base">
          <Icon name="warning" size="small" />
        </div>
        <div class="min-w-0 flex-1 flex flex-col gap-1.5">
          <div class="text-13-medium text-text-strong">{props.title}</div>
          <div class="text-12-regular text-text-base">{props.message}</div>
          <div class="flex flex-wrap items-center gap-2 pt-1">
            <Show when={props.actionLabel && props.onAction}>
              <Button type="button" size="small" variant="secondary" onClick={() => props.onAction?.()}>
                {props.actionLabel}
              </Button>
            </Show>
            <Button type="button" size="small" variant="ghost" onClick={props.onDismiss}>
              {props.dismissLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
