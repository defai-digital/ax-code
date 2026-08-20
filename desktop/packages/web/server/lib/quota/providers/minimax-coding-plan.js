import { readAuthFile } from "../../ax-code/auth.js"
import { getAuthEntry, normalizeAuthEntry, buildResult } from "../utils/index.js"
import { transformMinimaxWindows } from "./minimax-shared.js"

export const providerId = "minimax-coding-plan"
export const providerName = "MiniMax Token Plan (minimax.io)"
export const aliases = ["minimax-coding-plan"]

export const isConfigured = () => {
  const auth = readAuthFile()
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases))
  return Boolean(entry?.key || entry?.token)
}

export const fetchQuota = async () => {
  const auth = readAuthFile()
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases))
  const apiKey = entry?.key ?? entry?.token

  if (!apiKey) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: false,
      error: "Not configured",
    })
  }

  try {
    const response = await fetch("https://api.minimax.io/v1/api/openplatform/coding_plan/remains", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      response.body?.cancel()
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: `API error: ${response.status}`,
      })
    }

    const payload = await response.json()
    const baseResp = payload?.base_resp
    if (baseResp && baseResp.status_code !== 0) {
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: baseResp.status_msg || `API error: ${baseResp.status_code}`,
      })
    }

    const firstModel = payload?.model_remains?.[0]
    if (!firstModel) {
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: "No model quota data available",
      })
    }

    const windows = transformMinimaxWindows(firstModel)

    return buildResult({
      providerId,
      providerName,
      ok: true,
      configured: true,
      usage: { windows },
    })
  } catch (error) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : "Request failed",
    })
  }
}
