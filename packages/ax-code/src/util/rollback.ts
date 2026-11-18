/** Compensate a failed operation while retaining both failures for its caller. */
export async function withRollback<T>(
  run: () => Promise<T>,
  rollback: (() => Promise<unknown>) | undefined,
  rollbackFailureMessage: string,
): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    try {
      await rollback?.()
    } catch (rollbackError) {
      throw new AggregateError([cause, rollbackError], rollbackFailureMessage)
    }
    throw cause
  }
}
