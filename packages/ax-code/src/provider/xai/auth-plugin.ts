import type { Hooks, Plugin } from "@ax-code/plugin"

const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code"
const TOKEN_URL = "https://auth.x.ai/oauth2/token"
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const SCOPE = "openid offline_access"
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const OAUTH_POLLING_SAFETY_MARGIN_MS = 500
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000

const hooks: Hooks = {
  auth: {
    provider: "xai",
    methods: [
      {
        type: "oauth",
        label: "Sign in with xAI (device code)",
        authorize: async () => {
          const res = await fetch(DEVICE_AUTHORIZATION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }).toString(),
          })

          if (!res.ok) {
            throw new Error(`xAI device code request failed: ${res.status} ${await res.text()}`)
          }

          const device = (await res.json()) as {
            device_code: string
            user_code: string
            verification_uri: string
            verification_uri_complete?: string
            expires_in?: number
            interval?: number
          }

          const expiresAt = Date.now() + (device.expires_in ?? DEFAULT_EXPIRY_MS / 1000) * 1000
          let intervalMs = (device.interval ?? 5) * 1000

          const url = device.verification_uri_complete ?? device.verification_uri
          const instructions = `Open ${device.verification_uri} and enter code: ${device.user_code}`

          return {
            url,
            method: "auto" as const,
            instructions,
            async callback() {
              while (Date.now() < expiresAt) {
                const remaining = expiresAt - Date.now()
                await new Promise((r) => setTimeout(r, Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining)))

                let body: { error?: string; access_token?: string; refresh_token?: string; expires_in?: number }
                try {
                  const tokenRes = await fetch(TOKEN_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                      device_code: device.device_code,
                      client_id: CLIENT_ID,
                    }).toString(),
                  })
                  body = (await tokenRes.json()) as typeof body
                } catch {
                  continue
                }

                if (body.error === "authorization_pending") continue
                if (body.error === "slow_down") { intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS; continue }
                if (body.error || !body.access_token) return { type: "failed" as const }

                return {
                  type: "success" as const,
                  access: body.access_token,
                  refresh: body.refresh_token ?? "",
                  expires: body.expires_in ? Date.now() + body.expires_in * 1000 : expiresAt,
                }
              }

              return { type: "failed" as const }
            },
          }
        },
      },
    ],
  },
}

export const xaiAuthPlugin: Plugin = Object.assign(async () => hooks, { name: "xai-auth" })
