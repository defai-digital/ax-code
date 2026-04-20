export function footerToggleLabel(label: string, active: boolean) {
  return ` ${active ? "●" : "○"} ${label} `
}
