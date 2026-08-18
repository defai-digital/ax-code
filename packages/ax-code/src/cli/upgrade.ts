import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { Log } from "@/util/log"

const log = Log.create({ service: "cli.upgrade" })

export async function upgrade() {
  const config = await Config.global()
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch((err) => {
    log.debug("version check failed, skipping upgrade", { method, err })
    return undefined
  })
  if (!latest) return
  const compare = Installation.compareVersions(Installation.VERSION, latest)
  if (compare === undefined) {
    log.debug("version compare failed, skipping upgrade", { current: Installation.VERSION, latest })
    return
  }
  if (compare <= 0) return

  if (Flag.AX_CODE_ALWAYS_NOTIFY_UPDATE) {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (config.autoupdate === false || Flag.AX_CODE_DISABLE_AUTOUPDATE) return

  const kind = Installation.getReleaseType(Installation.VERSION, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  // An unrecognized install channel is unsafe to mutate automatically, but
  // hiding patch releases entirely leaves those users permanently stale.
  if (method === "unknown") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }
  // Log upgrade failures and publish an UpdateAvailable event so the user
  // is not silently left stuck on an outdated version — a silent
  // `.catch(() => {})` would make them believe the upgrade succeeded.
  await Installation.upgrade(method, latest)
    .then(async () => {
      const launcher = await Installation.verifyActiveLauncher(latest).catch(() => undefined)
      const warnings = launcher ? Installation.launcherWarnings(latest, launcher) : []
      await Bus.publish(
        Installation.Event.Updated,
        warnings.length ? { version: latest, warnings } : { version: latest },
      )
    })
    .catch(async (err) => {
      log.error("upgrade failed", { method, version: latest, err })
      await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    })
}
