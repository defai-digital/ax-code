export function levenshtein(a: string, b: string): number {
  const MAX_LENGTH = 2_000
  if (a.length > MAX_LENGTH || b.length > MAX_LENGTH) {
    return Math.max(a.length, b.length)
  }
  if (a === "" || b === "") return Math.max(a.length, b.length)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  let curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[b.length]
}
