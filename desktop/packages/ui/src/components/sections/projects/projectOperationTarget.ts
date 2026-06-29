export type ProjectOperationTarget = {
  id: string
  path: string
}

export const isCurrentProjectOperationTarget = (
  started: ProjectOperationTarget | null,
  current: ProjectOperationTarget | null,
): boolean => {
  return Boolean(started && current && started.id === current.id && started.path === current.path)
}
