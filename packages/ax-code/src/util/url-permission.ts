export function originPermissionPatterns(url: string | URL): string[] {
  const parsed = typeof url === "string" ? new URL(url) : url
  return [parsed.origin, `${parsed.origin}/*`]
}
