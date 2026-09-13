import { Flag } from "../flag/flag"

export function evidenceCacheMode(): "off" | "memory" | "rocksdb" {
  const value = Flag.AX_CODE_EVIDENCE_CACHE
  return value === "memory" || value === "rocksdb" ? value : "off"
}
