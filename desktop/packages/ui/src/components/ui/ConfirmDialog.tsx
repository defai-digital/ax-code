import React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"

type ConfirmRequest = {
  message: string
  destructive: boolean
  resolve: (confirmed: boolean) => void
}

type RequestConfirmOptions = {
  destructive?: boolean
}

/**
 * Promise-based replacement for window.confirm backed by the design-system
 * Dialog (focus trap, Escape to dismiss, proper styling). Render the returned
 * `confirmDialog` once near the root of the page and `await requestConfirm(...)`
 * wherever a yes/no decision is needed.
 */
export function useConfirmDialog(): {
  requestConfirm: (message: string, options?: RequestConfirmOptions) => Promise<boolean>
  confirmDialog: React.ReactNode
} {
  const { t } = useI18n()
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null)

  const requestConfirm = React.useCallback(
    (message: string, options?: RequestConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest({ message, destructive: options?.destructive ?? false, resolve })
      }),
    [],
  )

  const settle = React.useCallback((confirmed: boolean) => {
    setRequest((current) => {
      current?.resolve(confirmed)
      return null
    })
  }, [])

  const confirmDialog = (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false)
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-sm gap-5">
        <DialogHeader>
          <DialogTitle>{t("common.confirmDialog.title")}</DialogTitle>
          <DialogDescription>{request?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={() => settle(false)}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 typography-ui-label text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className={
              request?.destructive
                ? "inline-flex h-8 items-center justify-center rounded-md bg-destructive px-3 typography-ui-label text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                : "inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 typography-ui-label text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            }
          >
            {t("common.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { requestConfirm, confirmDialog }
}
