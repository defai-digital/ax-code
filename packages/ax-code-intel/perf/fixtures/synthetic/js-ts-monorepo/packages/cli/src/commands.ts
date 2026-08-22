import { add, greet } from "@perf/core"

export function greetCommand(name: string): string {
  return greet(name)
}

export function calcCommand(a: number, b: number): number {
  return add(a, b)
}
