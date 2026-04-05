export const nextInList = <T>(list: readonly T[], current: T | undefined, direction = 1) => {
  if (list.length === 0) return
  const index = current === undefined ? -1 : list.indexOf(current)
  return list[index === -1 ? 0 : (index + direction + list.length) % list.length]
}
