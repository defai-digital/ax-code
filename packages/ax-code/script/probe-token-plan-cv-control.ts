/**
 * Live CV + control probe: screenshot a fixture page, ask Token Plan models
 * where to click, then click those image-pixel coordinates.
 *
 *   ALIBABA_TOKEN_PLAN_INTL_API_KEY=… pnpm --dir packages/ax-code exec tsx script/probe-token-plan-cv-control.ts
 */
import { chromium } from "playwright-core"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const ENDPOINT = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
const MODELS = ["qwen3.7-plus", "qwen3.8-max"] as const
const FIXTURE = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>AX-WORK-CV-TEST</title>
    <style>
      html, body { height: 100%; margin: 0; background: #111; }
      body { display: flex; align-items: center; justify-content: center; }
      button {
        font: 700 48px/1.1 system-ui, sans-serif;
        padding: 48px 96px;
        background: #22c55e;
        color: #fff;
        border: 0;
        border-radius: 20px;
      }
      button.done { background: #2563eb; }
    </style>
  </head>
  <body>
    <button id="target">CLICK ME</button>
    <script>
      const button = document.getElementById("target")
      button.addEventListener("click", () => {
        button.textContent = "CLICKED OK"
        button.classList.add("done")
        document.title = "AX-WORK-CV-TEST CLICKED"
      })
    </script>
  </body>
</html>`

type Probe = { model: string; step: string; ok: boolean; detail: string }

function keyFromEnv() {
  return process.env.ALIBABA_TOKEN_PLAN_INTL_API_KEY?.trim() || process.env.ALIBABA_TOKEN_PLAN_API_KEY?.trim() || ""
}

function redact(text: string) {
  return text.replace(/sk-[A-Za-z0-9._-]+/g, "sk-[redacted]").replace(/Bearer\s+\S+/g, "Bearer [redacted]")
}

async function complete(input: {
  key: string
  model: string
  prompt: string
  imagePng: Buffer
}) {
  const res = await fetch(`${ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      enable_thinking: false,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${input.imagePng.toString("base64")}` },
            },
          ],
        },
      ],
    }),
  })
  const raw = redact(await res.text())
  if (!res.ok) throw new Error(`http=${res.status} ${raw.slice(0, 400)}`)
  const body = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return body.choices?.[0]?.message?.content ?? ""
}

function parseClick(text: string): { x: number; y: number; label?: string } | undefined {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return
  try {
    const parsed = JSON.parse(match[0]) as { x?: unknown; y?: unknown; label?: unknown }
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return
    return {
      x: parsed.x,
      y: parsed.y,
      label: typeof parsed.label === "string" ? parsed.label : undefined,
    }
  } catch {
    return
  }
}

async function main() {
  const results: Probe[] = []
  const key = keyFromEnv()
  if (!key) {
    console.log(JSON.stringify({ ok: false, error: "missing Token Plan key in env" }, null, 2))
    process.exit(2)
  }

  const tmp = path.join(os.tmpdir(), `ax-work-cv-${Date.now()}`)
  const htmlPath = path.join(tmp, "index.html")
  const { mkdir } = await import("node:fs/promises")
  await mkdir(tmp, { recursive: true })
  await writeFile(htmlPath, FIXTURE)

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM ||
      `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  })
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 })
  await page.goto(`file://${htmlPath}`)
  await page.waitForSelector("#target")

  for (const model of MODELS) {
    await page.evaluate(() => {
      const button = document.getElementById("target")
      if (!button) return
      button.textContent = "CLICK ME"
      button.classList.remove("done")
      document.title = "AX-WORK-CV-TEST"
    })
    const imagePng = await page.screenshot({ type: "png" })
    const out = path.join(os.tmpdir(), `ax-work-cv-${model}.png`)
    await writeFile(out, imagePng)
    const box = await page.locator("#target").boundingBox()
    const pngWidth = imagePng.readUInt32BE(16)
    const pngHeight = imagePng.readUInt32BE(20)
    const prompt = [
      `This PNG is exactly ${pngWidth}x${pngHeight} pixels. Origin (0,0) is the top-left corner. Y increases downward.`,
      "Find the large green button labeled CLICK ME.",
      `Return ONLY JSON: {"x": <int>, "y": <int>, "label": "<button text>"}`,
      `x must be between 0 and ${pngWidth - 1}. y must be between 0 and ${pngHeight - 1}.`,
      "Use the visual center of the green button. No markdown.",
    ].join(" ")

    try {
      const content = await complete({ key, model, prompt, imagePng })
      const click = parseClick(content)
      results.push({
        model,
        step: "vision-json",
        ok: Boolean(click),
        detail: click
          ? `png=${pngWidth}x${pngHeight} file=${out} label=${click.label ?? "?"} xy=${click.x},${click.y} box=${JSON.stringify(box)} raw=${content.slice(0, 160)}`
          : `png=${pngWidth}x${pngHeight} unparsed=${content.slice(0, 240)}`,
      })
      if (!click || !box) continue

      const inside =
        click.x >= box.x && click.x <= box.x + box.width && click.y >= box.y && click.y <= box.y + box.height
      results.push({
        model,
        step: "grounding",
        ok: inside,
        detail: `inside_button=${inside} predicted=${click.x},${click.y} button=${box.x},${box.y} ${box.width}x${box.height}`,
      })

      await page.mouse.click(click.x, click.y)
      const text = await page.locator("#target").innerText()
      results.push({
        model,
        step: "control",
        ok: text.includes("CLICKED"),
        detail: `after_click=${text}`,
      })
    } catch (error) {
      results.push({
        model,
        step: "error",
        ok: false,
        detail: String(error).slice(0, 400),
      })
    }
  }

  await browser.close()
  const ok = results.filter((row) => row.step === "control").every((row) => row.ok) && results.some((row) => row.step === "control")
  console.log(JSON.stringify({ endpoint: ENDPOINT, ok, results }, null, 2))
  process.exit(ok ? 0 : 2)
}

main().catch((error) => {
  console.error(String(error))
  process.exit(1)
})
