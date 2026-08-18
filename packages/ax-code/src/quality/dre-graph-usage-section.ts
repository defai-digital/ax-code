import { SessionUsage } from "../session/usage"
import { compact, num, time } from "./dre-graph-format"
import { barChart, stat } from "./dre-graph-widgets"

/**
 * "What did this session use?" — tokens by kind, cache share, per-model
 * breakdown. Leads the session report because it answers the question every
 * session has data for, unlike the risk/trust sections which need validations
 * or branches to say anything meaningful.
 */
export function usageSection(input: { usage: SessionUsage.Info; duration?: number }) {
  const usage = input.usage
  if (usage.totalTokens === 0 && usage.messages === 0) return ""

  const models = Object.entries(usage.models)
    .sort((a, b) => b[1].tokens - a[1].tokens || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([model, entry]) => ({
      label: model,
      value: entry.tokens,
      detail: `${num(entry.messages)} message${entry.messages === 1 ? "" : "s"}`,
    }))

  return [
    `<section class="band" id="usage">`,
    `<div class="wrap">`,
    `<div class="panel">`,
    `<h3>Usage</h3>`,
    `<div class="summary-stats">`,
    stat({ label: "Input tokens", value: compact(usage.tokens.input), icon: "→" }),
    stat({ label: "Output tokens", value: compact(usage.tokens.output + usage.tokens.reasoning), icon: "←" }),
    stat({
      label: "Cache share",
      value: usage.cacheShare === undefined ? "—" : `${Math.round(usage.cacheShare * 100)}%`,
      kind: usage.cacheShare !== undefined && usage.cacheShare >= 0.5 ? "low" : "neutral",
      icon: "▣",
    }),
    stat({ label: "Duration", value: time(input.duration), icon: "⏱" }),
    `</div>`,
    `<p class="muted" style="font-size:12px;margin-top:10px">${num(usage.tokens.input)} in · ${num(
      usage.tokens.output,
    )} out · ${num(usage.tokens.reasoning)} reasoning · ${num(usage.tokens.cache.read)} cache read · ${num(
      usage.tokens.cache.write,
    )} cache write · ${num(usage.messages)} messages</p>`,
    models.length
      ? [
          `<h4 style="margin:14px 0 8px;font-size:13px">Model usage</h4>`,
          barChart({ items: models, format: compact }),
        ].join("")
      : "",
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}
