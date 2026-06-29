export type SettingsDeleteMutationResult<T extends { ok: boolean }> =
  | { status: "completed"; result: T }
  | { status: "unexpected-error"; error: unknown }

export const runSettingsDeleteMutation = async <T extends { ok: boolean }>(
  mutation: () => Promise<T>,
): Promise<SettingsDeleteMutationResult<T>> => {
  try {
    return { status: "completed", result: await mutation() }
  } catch (error) {
    return { status: "unexpected-error", error }
  }
}
