export function subagentPanelLayout(input: { terminalHeight: number; activeCount: number; collapsed: boolean }) {
  if (input.activeCount <= 0) return { rows: 0, visible: 0, hidden: 0 }
  if (input.collapsed) return { rows: 2, visible: 0, hidden: input.activeCount }
  const budget = Math.max(4, Math.min(10, Math.floor(input.terminalHeight * 0.25)))
  const capacity = Math.max(1, Math.floor((budget - 2) / 2))
  const visible = input.activeCount <= capacity ? input.activeCount : Math.max(1, Math.floor((budget - 3) / 2))
  const hidden = input.activeCount - visible
  return { rows: 2 + visible * 2 + (hidden > 0 ? 1 : 0), visible, hidden }
}

export function hasNewActiveSubagent(previous: ReadonlySet<string>, current: readonly string[]) {
  return current.some((id) => !previous.has(id))
}
