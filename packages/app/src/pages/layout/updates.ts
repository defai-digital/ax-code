import { createEffect, onCleanup, onMount } from "solid-js"
import { showToast } from "@ax-code/ui/toast"

type Input = {
  language: {
    t: (key: string, vars?: Record<string, string | number | boolean>) => string
  }
  platform: {
    checkUpdate?: () => Promise<{ updateAvailable: boolean; version?: string | null }>
    update?: () => Promise<unknown>
    restart?: () => Promise<unknown>
  }
  settings: {
    ready: () => boolean
    updates: {
      startup: () => boolean
    }
  }
}

export function useUpdatePolling(input: Input) {
  onMount(() => {
    if (!input.platform.checkUpdate || !input.platform.update || !input.platform.restart) return

    let toastId: number | undefined
    let interval: ReturnType<typeof setInterval> | undefined

    const poll = () =>
      input.platform.checkUpdate!().then(({ updateAvailable, version }) => {
        if (!updateAvailable) return
        if (toastId !== undefined) return
        toastId = showToast({
          persistent: true,
          icon: "download",
          title: input.language.t("toast.update.title"),
          description: input.language.t("toast.update.description", { version: version ?? "" }),
          actions: [
            {
              label: input.language.t("toast.update.action.installRestart"),
              onClick: async () => {
                await input.platform.update!()
                await input.platform.restart!()
              },
            },
            {
              label: input.language.t("toast.update.action.notYet"),
              onClick: "dismiss",
            },
          ],
        })
      })

    createEffect(() => {
      if (!input.settings.ready()) return

      if (!input.settings.updates.startup()) {
        if (interval === undefined) return
        clearInterval(interval)
        interval = undefined
        return
      }

      if (interval !== undefined) return
      void poll()
      interval = setInterval(poll, 10 * 60 * 1000)
    })

    onCleanup(() => {
      if (interval === undefined) return
      clearInterval(interval)
    })
  })
}
