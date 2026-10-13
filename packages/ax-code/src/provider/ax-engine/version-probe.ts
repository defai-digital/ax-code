import semver from "semver"
import { Process } from "@/util/process"
import { parseJsonResult } from "@/util/json-value"

function installVersion(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined
  const install = (payload as Record<string, unknown>).install
  if (!install || typeof install !== "object") return undefined
  const value = (install as Record<string, unknown>).version
  return typeof value === "string" && semver.valid(value.trim()) ? value.trim() : undefined
}

function installVersionFromDoctorText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const direct = parseJsonResult(trimmed)
  const directVersion = direct.ok ? installVersion(direct.value) : undefined
  if (directVersion) return directVersion
  // Scan complete objects once; diagnostic braces must not poison the payload.
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    if (start < 0) {
      if (char !== "{") continue
      start = i
      depth = 1
      continue
    }
    if (quoted) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) {
      const embedded = parseJsonResult(trimmed.slice(start, i + 1))
      const version = embedded.ok ? installVersion(embedded.value) : undefined
      if (version) return version
      start = -1
    }
  }
  return undefined
}

function directVersion(text: string) {
  for (const line of text.split(/\r?\n/)) {
    const label = line.trim()
    const value = label.replace(/^ax-engine\s+/i, "")
    if (semver.valid(value)) return label
  }
  return undefined
}

export async function probeVersion(binaryPath: string) {
  const direct = await Process.text([binaryPath, "--version"], { timeout: 3000, nothrow: true }).catch(() => undefined)
  if (direct?.code === 0) {
    const detected = directVersion(direct.text) ?? directVersion(direct.stderr.toString())
    if (detected) return detected
  }

  // Older native and Python-distributed launchers expose their version through
  // the structured doctor response instead of a --version flag. Doctor
  // exits non-zero when the host is not ready (Metal toolchain, MLX files).
  // That exit code is host readiness, not version knowability: install.version
  // is still authoritative.
  const doctor = await Process.text([binaryPath, "doctor", "--json"], { timeout: 10_000, nothrow: true }).catch(
    () => undefined,
  )
  if (!doctor) return undefined
  return (
    installVersionFromDoctorText(doctor.text) ?? installVersionFromDoctorText(doctor.stderr.toString()) ?? undefined
  )
}
