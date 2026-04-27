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
  if (compare !== undefined && compare <= 0) return

  if (Flag.AX_CODE_ALWAYS_NOTIFY_UPDATE) {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (Installation.VERSION === latest) return
  if (config.autoupdate === false || Flag.AX_CODE_DISABLE_AUTOUPDATE) return

  const kind = Installation.getReleaseType(Installation.VERSION, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (method === "unknown") return
  // Log upgrade failures and publish an UpdateAvailable event so the user
  // is not silently left stuck on an outdated version — a silent
  // `.catch(() => {})` would make them believe the upgrade succeeded.
  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(async (err) => {
      log.error("upgrade failed", { method, version: latest, err })
      await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    })
}
