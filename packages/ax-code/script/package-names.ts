export const NPM_SCOPE = "@defai.digital"
export const META_PACKAGE_NAME = `${NPM_SCOPE}/ax-code`
export const SOURCE_PACKAGE_NAME = `${NPM_SCOPE}/ax-code-source`

export function scopePackageName(name: string) {
  return `${NPM_SCOPE}/${name}`
}

export function isScopedBinaryPackageName(name: string, basePackageName: string) {
  return name.startsWith(`${NPM_SCOPE}/${basePackageName}-`)
}
