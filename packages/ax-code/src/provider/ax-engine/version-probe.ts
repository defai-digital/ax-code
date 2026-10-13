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
  // Recover compact doctor payloads independently of malformed diagnostic
  // braces or quotes on preceding lines. Each line is visited only once.
  for (const line of trimmed.split(/\r?\n/)) {
    const parsed = parseJsonResult(line)
    const version = parsed.ok ? installVersion(parsed.value) : undefined
    if (version) return version
  }
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
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  // A branded engine banner outranks unrelated bare toolchain versions.
  for (const label of lines) {
    if (/^ax-engine\s+/i.test(label) && semver.valid(label.replace(/^ax-engine\s+/i, ""))) return label
  }
  return lines.find((label) => semver.valid(label))
  return undefined
}

export async function probeVersion(binaryPath: string) {
  const direct = await Process.text([binaryPath, "--version"], { timeout: 3000, nothrow: true }).catch(() => undefined)
  if (direct?.code === 0) {
    const detected = directVersion(`${direct.text}\n${direct.stderr.toString()}`)
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
