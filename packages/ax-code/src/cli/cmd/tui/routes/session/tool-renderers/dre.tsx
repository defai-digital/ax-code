import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { RefactorPlanTool } from "@/tool/refactor_plan"
import type { RefactorApplyTool } from "@/tool/refactor_apply"
import type { ImpactAnalyzeTool } from "@/tool/impact_analyze"
import type { DedupScanTool } from "@/tool/dedup_scan"
import { normalize } from "../format"
import { BlockTool, InlineTool, type ToolProps } from "./primitives"

function riskColor(theme: ReturnType<typeof useTheme>["theme"], label: string | undefined) {
  if (label === "high") return theme.error
  if (label === "medium") return theme.warning
  if (label === "low") return theme.success
  return theme.textMuted
}

export function RefactorPlan(props: ToolProps<typeof RefactorPlanTool>) {
  const { theme } = useTheme()
  const plan = createMemo(() => props.metadata.plan)
  const kind = createMemo(() => plan()?.kind ?? "plan")
  const risk = createMemo(() => plan()?.risk)
  const edits = createMemo(() => plan()?.edits ?? [])
  const affectedFiles = createMemo(() => plan()?.affectedFiles ?? [])
  const summary = createMemo(() => plan()?.summary ?? "")

  return (
    <Switch>
      <Match when={plan()}>
        <BlockTool
          title={`# Refactor plan · ${kind()} · ${affectedFiles().length} file${affectedFiles().length === 1 ? "" : "s"}`}
          part={props.part}
        >
          <box flexDirection="column" gap={1}>
            {/* Risk + plan id row — the two facts a reviewer needs at a glance */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Risk</text>
              <text fg={riskColor(theme, risk())}>{risk() ?? "unknown"}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>Plan</text>
              <text fg={theme.text}>{plan()?.planId ?? ""}</text>
            </box>

            {/* Markdown summary — plain text render since not every
                terminal has the experimental markdown element enabled. */}
            <Show when={summary()}>
              <box>
                <For each={summary().split("\n")}>{(line) => <text fg={theme.text}>{line}</text>}</For>
              </box>
            </Show>

            {/* Edits list — each edit row is a {op} {target} pair. The
                whole list is shown inline because a reviewer needs to
                see every edit before approving the apply step. */}
            <Show when={edits().length > 0}>
              <box flexDirection="column">
                <text fg={theme.textMuted}>Edits ({edits().length})</text>
                <For each={edits()}>
                  {(edit) => (
                    <box flexDirection="row" gap={1} paddingLeft={1}>
                      <text fg={theme.success}>·</text>
                      <text fg={theme.text}>{edit.op}</text>
                      <text fg={theme.textMuted}>{edit.detail}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>

            {/* Affected files — capped at 15 for visual calm; the full
                list lives in metadata for callers that need it. */}
            <Show when={affectedFiles().length > 0}>
              <box flexDirection="column">
                <text fg={theme.textMuted}>Affected files ({affectedFiles().length})</text>
                <For each={affectedFiles().slice(0, 15)}>
                  {(file) => <text fg={theme.text}>{"  " + normalize(file)}</text>}
                </For>
                <Show when={affectedFiles().length > 15}>
                  <text fg={theme.textMuted}>{`  … and ${affectedFiles().length - 15} more`}</text>
                </Show>
              </box>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="♺" pending="Planning refactor..." complete={false} part={props.part}>
          Planning refactor
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function RefactorApply(props: ToolProps<typeof RefactorApplyTool>) {
  const { theme } = useTheme()
  const result = createMemo(() => props.metadata.result)
  const applied = createMemo(() => props.metadata.applied === true)
  const abortReason = createMemo(() => props.metadata.abortReason ?? null)
  const filesChanged = createMemo(() => props.metadata.filesChanged ?? [])
  const checks = createMemo(() => result()?.checks)

  function CheckRow(p: { label: string; ok: boolean | undefined; errorCount: number }) {
    const glyph = p.ok === true ? "✓" : p.ok === false ? "✗" : "—"
    const color = p.ok === true ? theme.success : p.ok === false ? theme.error : theme.textMuted
    return (
      <box flexDirection="row" gap={1}>
        <text fg={color}>{glyph}</text>
        <text fg={theme.text}>{p.label}</text>
        <Show when={p.errorCount > 0}>
          <text fg={theme.error}>
            ({p.errorCount} error{p.errorCount === 1 ? "" : "s"})
          </text>
        </Show>
      </box>
    )
  }

  return (
    <Switch>
      <Match when={result()}>
        <BlockTool
          title={
            applied()
              ? `# Refactor applied · ${filesChanged().length} file${filesChanged().length === 1 ? "" : "s"}`
              : `# Refactor aborted · ${abortReason() ?? "unknown"}`
          }
          part={props.part}
        >
          <box flexDirection="column" gap={1}>
            {/* Applied flag + plan id row */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Applied</text>
              <text fg={applied() ? theme.success : theme.error}>{applied() ? "yes" : "no"}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>Plan</text>
              <text fg={theme.text}>{(props.metadata.planId as string) ?? ""}</text>
            </box>

            <Show when={abortReason()}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.textMuted}>Reason</text>
                <text fg={theme.error}>{abortReason() ?? ""}</text>
              </box>
            </Show>

            {/* Check matrix — the whole point of the tool. Three rows,
                one per check, with status + error count. */}
            <box flexDirection="column">
              <text fg={theme.textMuted}>Checks</text>
              <box paddingLeft={1}>
                <CheckRow
                  label="typecheck"
                  ok={checks()?.typecheck.ok}
                  errorCount={checks()?.typecheck.errors.length ?? 0}
                />
                <CheckRow label="lint" ok={checks()?.lint.ok} errorCount={checks()?.lint.errors.length ?? 0} />
                <box flexDirection="row" gap={1}>
                  <text
                    fg={
                      checks()?.tests.ok === true
                        ? theme.success
                        : checks()?.tests.ok === false
                          ? theme.error
                          : theme.textMuted
                    }
                  >
                    {checks()?.tests.ok === true ? "✓" : checks()?.tests.ok === false ? "✗" : "—"}
                  </text>
                  <text fg={theme.text}>tests</text>
                  <text fg={theme.textMuted}>
                    ({checks()?.tests.selection ?? "skipped"}, ran {checks()?.tests.ran ?? 0}, failed{" "}
                    {checks()?.tests.failed ?? 0})
                  </text>
                </box>
              </box>
            </box>

            {/* Files changed (only when applied) */}
            <Show when={applied() && filesChanged().length > 0}>
              <box flexDirection="column">
                <text fg={theme.textMuted}>Files changed</text>
                <For each={filesChanged()}>{(file) => <text fg={theme.text}>{"  " + normalize(file)}</text>}</For>
              </box>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="♺" pending="Applying refactor..." complete={false} spinner={true} part={props.part}>
          Applying refactor
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function ImpactAnalyze(props: ToolProps<typeof ImpactAnalyzeTool>) {
  const { theme } = useTheme()
  const report = createMemo(() => props.metadata.report)
  const risk = createMemo(() => report()?.riskLabel)
  const truncated = createMemo(() => report()?.truncated === true)
  const affected = createMemo(() => report()?.affectedSymbols ?? [])
  const affectedFiles = createMemo(() => report()?.affectedFiles ?? [])
  const apiBoundariesHit = createMemo(() => report()?.apiBoundariesHit ?? 0)

  // Group affected symbols by distance for the indented display.
  const grouped = createMemo(() => {
    type Entry = ReturnType<typeof affected>[number]
    const map = new Map<number, Entry[]>()
    for (const entry of affected()) {
      const list = map.get(entry.distance) ?? []
      list.push(entry)
      map.set(entry.distance, list)
    }
    return [...map.entries()].sort(([a], [b]) => a - b)
  })

  const [expanded, setExpanded] = createSignal(false)
  const MAX_INLINE = 15

  return (
    <Switch>
      <Match when={report()}>
        <BlockTool
          title={`# Impact · ${risk() ?? "unknown"} risk · ${affected().length} symbols, ${affectedFiles().length} files`}
          part={props.part}
          onClick={affected().length > MAX_INLINE ? () => setExpanded((p) => !p) : undefined}
        >
          <box flexDirection="column" gap={1}>
            {/* Risk + boundaries + truncated row */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Risk</text>
              <text fg={riskColor(theme, risk())}>{risk() ?? "unknown"}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>API boundaries hit</text>
              <text fg={theme.text}>{apiBoundariesHit()}</text>
              <Show when={truncated()}>
                <text fg={theme.textMuted}>·</text>
                <text fg={theme.warning}>truncated (budget exhausted)</text>
              </Show>
            </box>

            {/* Grouped list by distance — d=1 at the top, deeper
                dependents below. Indent signals "further from seed". */}
            <Show when={affected().length > 0}>
              <box flexDirection="column">
                <For each={grouped()}>
                  {([distance, entries]) => (
                    <box flexDirection="column">
                      <text fg={theme.textMuted}>
                        distance {distance} ({entries.length})
                      </text>
                      <For each={expanded() ? entries : entries.slice(0, MAX_INLINE)}>
                        {(entry) => (
                          <text fg={theme.text}>
                            {"  ".repeat(distance)}
                            {entry.symbol.qualifiedName}{" "}
                            <span style={{ fg: theme.textMuted }}>
                              ({normalize(entry.symbol.file)}:{entry.symbol.range.start.line + 1})
                            </span>
                          </text>
                        )}
                      </For>
                    </box>
                  )}
                </For>
                <Show when={!expanded() && affected().length > MAX_INLINE}>
                  <text fg={theme.textMuted}>{`… and ${affected().length - MAX_INLINE} more (click to expand)`}</text>
                </Show>
              </box>
            </Show>
            <Show when={affected().length === 0}>
              <text fg={theme.textMuted}>No dependents found within the traversal budget.</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⟁" pending="Analyzing impact..." complete={false} part={props.part}>
          Analyzing impact
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function DedupScan(props: ToolProps<typeof DedupScanTool>) {
  const { theme } = useTheme()
  const report = createMemo(() => props.metadata.report)
  const clusters = createMemo(() => report()?.clusters ?? [])
  const totalLines = createMemo(() => report()?.totalDuplicateLines ?? 0)
  const truncated = createMemo(() => report()?.truncated === true)

  // Cap inline cluster display so a pathological repo doesn't flood
  // the timeline. Remaining clusters are still in metadata.
  const MAX_CLUSTERS = 10
  const MAX_MEMBERS_PER_CLUSTER = 8

  function tierColor(tier: string) {
    if (tier === "exact") return theme.error
    if (tier === "structural") return theme.warning
    return theme.success
  }

  return (
    <Switch>
      <Match when={report()}>
        <BlockTool
          title={`# Dedup · ${clusters().length} cluster${clusters().length === 1 ? "" : "s"} · ${totalLines()} shared lines`}
          part={props.part}
        >
          <box flexDirection="column" gap={1}>
            <Show when={truncated()}>
              <text fg={theme.warning}>Candidate pool was truncated — results are partial.</text>
            </Show>
            <Show when={clusters().length === 0}>
              <text fg={theme.textMuted}>No duplicate clusters found.</text>
            </Show>
            <For each={clusters().slice(0, MAX_CLUSTERS)}>
              {(cluster) => (
                <box flexDirection="column">
                  {/* Cluster header: tier + similarity + member count */}
                  <box flexDirection="row" gap={2}>
                    <text fg={tierColor(cluster.tier)}>[{cluster.tier}]</text>
                    <text fg={theme.text}>similarity {cluster.similarityScore.toFixed(2)}</text>
                    <text fg={theme.textMuted}>·</text>
                    <text fg={theme.text}>
                      {cluster.members.length} copies, {cluster.sharedLines} shared lines
                    </text>
                  </box>
                  {/* Member list — each row is a file:line target */}
                  <For each={cluster.members.slice(0, MAX_MEMBERS_PER_CLUSTER)}>
                    {(m) => (
                      <text fg={theme.text}>
                        {"  " + m.qualifiedName}{" "}
                        <span style={{ fg: theme.textMuted }}>
                          ({normalize(m.file)}:{m.range.start.line + 1})
                        </span>
                      </text>
                    )}
                  </For>
                  <Show when={cluster.members.length > MAX_MEMBERS_PER_CLUSTER}>
                    <text fg={theme.textMuted}>
                      {`  … and ${cluster.members.length - MAX_MEMBERS_PER_CLUSTER} more`}
                    </text>
                  </Show>
                  <Show when={cluster.suggestedExtractionTarget}>
                    <text fg={theme.textMuted}>
                      {"  → suggest: extract to " + (cluster.suggestedExtractionTarget || "(workspace root)")}
                    </text>
                  </Show>
                </box>
              )}
            </For>
            <Show when={clusters().length > MAX_CLUSTERS}>
              <text fg={theme.textMuted}>{`… and ${clusters().length - MAX_CLUSTERS} more cluster(s)`}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⌘" pending="Scanning for duplicates..." complete={false} part={props.part}>
          Scanning for duplicates
        </InlineTool>
      </Match>
    </Switch>
  )
}
