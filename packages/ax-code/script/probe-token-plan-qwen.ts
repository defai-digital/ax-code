/**
 * Live qualification for Alibaba Token Plan Qwen 3.8 Max.
 *
 *   ALIBABA_TOKEN_PLAN_INTL_API_KEY=… pnpm --dir packages/ax-code exec tsx script/probe-token-plan-qwen.ts
 *
 * Does not print the API key. Writes a JSON summary to stdout.
 */
const ENDPOINT = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
const MODELS = ["qwen3.7-plus", "qwen3.8-max-preview", "qwen3.8-max"] as const
// 32x32 PNG — Token Plan rejects images with height/width <= 10.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAADUlEQVR4nGP4z8DwHwAFgwJ/lQ0T1gAAAABJRU5ErkJggg=="

type Probe = { name: string; model?: string; ok: boolean; detail: string }

function redact(text: string) {
  return text.replace(/sk-[A-Za-z0-9._-]+/g, "sk-[redacted]").replace(/Bearer\s+\S+/g, "Bearer [redacted]")
}

function keyFromEnv() {
  return (
    process.env.ALIBABA_TOKEN_PLAN_INTL_API_KEY?.trim() ||
    process.env.ALIBABA_TOKEN_PLAN_API_KEY?.trim() ||
    ""
  )
}

async function postChat(key: string, body: unknown) {
  const res = await fetch(`${ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const text = redact(await res.text())
  return { res, text }
}

async function main() {
  const results: Probe[] = []
  const key = keyFromEnv()
  if (!key) {
    results.push({
      name: "credential",
      ok: false,
      detail: "set ALIBABA_TOKEN_PLAN_INTL_API_KEY (Token Plan Team Edition key, not Coding Plan sk-sp-)",
    })
    console.log(JSON.stringify({ endpoint: ENDPOINT, results }, null, 2))
    process.exit(2)
  }
  results.push({ name: "credential", ok: true, detail: `api key present (len=${key.length})` })

  const headers = { Authorization: `Bearer ${key}` }
  const modelsRes = await fetch(`${ENDPOINT}/models`, { headers })
  const modelsText = redact(await modelsRes.text())
  let ids: string[] = []
  try {
    const body = JSON.parse(modelsText) as { data?: Array<{ id?: string }> }
    ids = (body.data ?? []).map((row) => row.id ?? "").filter(Boolean)
  } catch {
    ids = []
  }
  const qwen = ids.filter((id) => id.toLowerCase().includes("qwen3.8"))
  results.push({
    name: "list-models",
    ok: modelsRes.ok,
    detail: `http=${modelsRes.status} count=${ids.length} qwen3.8*=${qwen.join(",") || "none"} hasPreview=${ids.includes("qwen3.8-max-preview")} hasGA=${ids.includes("qwen3.8-max")}`,
  })

  for (const model of MODELS) {
    const text = await postChat(key, {
      model,
      messages: [{ role: "user", content: "Reply with the single word pong." }],
      max_tokens: 16,
    })
    results.push({
      name: "text-completion",
      model,
      ok: text.res.ok,
      detail: `http=${text.res.status} body=${text.text.slice(0, 240)}`,
    })

    const vision = await postChat(key, {
      model,
      enable_thinking: false,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image in three words." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL}` } },
          ],
        },
      ],
      max_tokens: 32,
    })
    results.push({
      name: "image-input",
      model,
      ok: vision.res.ok,
      detail: `http=${vision.res.status} body=${vision.text.slice(0, 280)}`,
    })

    const tools = await postChat(key, {
      model,
      enable_thinking: false,
      messages: [{ role: "user", content: "Call ping with value=1. Do not answer in text." }],
      tools: [
        {
          type: "function",
          function: {
            name: "ping",
            description: "Ping",
            parameters: {
              type: "object",
              properties: { value: { type: "number" } },
              required: ["value"],
            },
          },
        },
      ],
      tool_choice: "auto",
      max_tokens: 64,
    })
    results.push({
      name: "tool-call",
      model,
      ok: tools.res.ok && tools.text.includes("ping"),
      detail: `http=${tools.res.status} body=${tools.text.slice(0, 320)}`,
    })
  }

  console.log(JSON.stringify({ endpoint: ENDPOINT, results }, null, 2))
  process.exit(results.every((row) => row.ok) ? 0 : 2)
}

main().catch((error) => {
  console.error(String(error))
  process.exit(1)
})
