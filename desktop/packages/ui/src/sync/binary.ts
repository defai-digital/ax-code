// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Binary {
  // All helpers in this module assume the array is sorted by compare(item).
  export function search<T>(
    array: readonly T[],
    id: string,
    compare: (item: T) => string,
  ): { found: boolean; index: number } {
    let left = 0
    let right = array.length - 1

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const midId = compare(array[mid])

      if (midId === id) {
        return { found: true, index: mid }
      } else if (midId < id) {
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    return { found: false, index: left }
  }

  export function has<T>(array: readonly T[], id: string, compare: (item: T) => string): boolean {
    return search(array, id, compare).found
  }

  export function find<T>(array: readonly T[], id: string, compare: (item: T) => string): T | undefined {
    const result = search(array, id, compare)
    return result.found ? array[result.index] : undefined
  }

  export function findIndex<T>(array: readonly T[], id: string, compare: (item: T) => string): number {
    const result = search(array, id, compare)
    return result.found ? result.index : -1
  }

  export function insert<T>(array: T[], item: T, compare: (item: T) => string): T[] {
    const id = compare(item)
    let left = 0
    let right = array.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      const midId = compare(array[mid])

      if (midId < id) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    array.splice(left, 0, item)
    return array
  }
}
