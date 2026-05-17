import type { Session } from "../session"
import { live, themeScript, themeToggle } from "./dre-graph-assets"
import { esc, stamp } from "./dre-graph-format"
import { style } from "./dre-graph-style"
import { chip } from "./dre-graph-widgets"

export function index(input: { list: Session.Info[]; search: string }) {
  const base = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search)
  const dir = base.get("directory") ?? input.list[0]?.directory ?? undefined
  const link = (path: string, label: string, query?: Record<string, string>) => {
    const url = new URL(path, "http://ax-code.local")
    for (const [key, value] of base.entries()) url.searchParams.set(key, value)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    return `<a href="${esc(url.pathname + url.search)}">${esc(label)}</a>`
  }

  return [
    "<!doctype html>",
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>AX Code · DRE Sessions</title>`,
    themeScript(),
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    `<nav class="nav"><div class="nav-inner">`,
    `<span class="nav-brand">AX Code DRE</span>`,
    `<span class="live" id="live-status">connecting</span>`,
    themeToggle(),
    `</div></nav>`,
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div class="hero-title">Sessions</div>`,
    `<p class="hero-subtitle">${input.list.length} session${input.list.length === 1 ? "" : "s"} in this workspace</p>`,
    `</div>`,
    `</header>`,
    `<section class="band">`,
    `<div class="wrap">`,
    `<div class="panel">`,
    input.list.length
      ? `<div class="session-list">${input.list
          .map((item) =>
            [
              `<div class="session-card">`,
              `<div class="session-head">`,
              `<strong>${esc(item.title)}</strong>`,
              link(`/dre-graph/session/${item.id}`, "View →"),
              `</div>`,
              `<div class="tag-row">`,
              chip({ label: stamp(item.time.updated) }),
              chip({ label: item.parentID ? "fork" : "root" }),
              `</div>`,
              `<span class="muted" style="font-size:12px">${esc(item.id)}</span>`,
              `</div>`,
            ].join(""),
          )
          .join("")}</div>`
      : `<p class="empty">No sessions recorded. Run ax-code to create your first session.</p>`,
    `</div>`,
    `</div>`,
    `</section>`,
    live({ directory: dir }),
    `</body>`,
    `</html>`,
  ].join("")
}
