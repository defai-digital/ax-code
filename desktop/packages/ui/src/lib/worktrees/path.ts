export const normalizeWorktreePath = (value: string): string => {
  if (!value) {
    return ""
  }
  const replaced = value.replace(/\\/g, "/")
  if (/^\/+$/.test(replaced)) {
    return "/"
  }
  return replaced.replace(/\/+$/, "") || value
}
