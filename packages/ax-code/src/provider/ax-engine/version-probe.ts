import semver from "semver"
import { Process } from "@/util/process"
import { parseJsonResult } from "@/util/json-value"

function installVersion(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined
  const install = (payload as Record<string, unknown>).install
  if (!install || typeof install !== "object") return undefined
  const value = (install as Record<string, unknown>).version
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function installVersionFromDoctorText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const direct = parseJsonResult(trimmed)
  const directVersion = direct.ok ? installVersion(direct.value) : undefined
  if (directVersion) return directVersion
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  const embedded = parseJsonResult(trimmed.slice(start, end + 1))
  return embedded.ok ? installVersion(embedded.value) : undefined
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
