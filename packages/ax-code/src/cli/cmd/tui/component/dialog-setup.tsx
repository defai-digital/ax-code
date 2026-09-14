import { createMemo } from "solid-js"
import { SetupWizard } from "./setup-wizard"
import { useLanguage } from "../context/language"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { useCommandDialog } from "./dialog-command"
import { DialogLanguage } from "./dialog-language"
import { setupGuidance } from "./setup-guidance"
export { shouldOfferSetup } from "./setup-state"

export function DialogSetup() {
  const language = useLanguage()
  const { t } = language
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const command = useCommandDialog()
  const guidance = createMemo(() =>
    setupGuidance(
      {
        providerLoaded: sync.data.provider_loaded,
        providerFailed: sync.data.provider_failed,
        modelReady: local.model.ready,
        providers: sync.data.provider,
        model: local.model.current(),
        sessionLoaded: sync.data.session_loaded,
        sessionCount: sync.data.session.length,
      },
      t,
    ),
  )
  return (
    <SetupWizard
      guidance={guidance()}
      onLanguages={() => dialog.replace(() => <DialogLanguage onDone={() => dialog.replace(() => <DialogSetup />)} />)}
      onConnect={() => command.trigger(guidance().action?.command ?? guidance().modelCommand)}
    />
  )
}
