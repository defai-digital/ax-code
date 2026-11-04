export type ImmutableModelData<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
    ? { readonly [K in keyof T]: ImmutableModelData<T[K]> }
    : T

export function immutableModelData<T>(value: T): ImmutableModelData<T> {
  return cloneModelData(value, true) as ImmutableModelData<T>
}

/** Clone registry data, including internal non-enumerable capability evidence. */
export function cloneModelData<T>(value: T, frozen = false, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== "object") return value
  const prior = seen.get(value)
  if (prior) return prior as T
  if (value instanceof Date) return new Date(value.getTime()) as T
  // Transport handles and callbacks are connection-owned, not registry data.
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return value
  const result: any = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
  seen.set(value, result)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if ("value" in descriptor) {
      Object.defineProperty(result, key, {
        value: cloneModelData(descriptor.value, frozen, seen),
        enumerable: descriptor.enumerable,
        configurable: true,
        writable: true,
      })
    }
  }
  return frozen ? Object.freeze(result) : result
}
