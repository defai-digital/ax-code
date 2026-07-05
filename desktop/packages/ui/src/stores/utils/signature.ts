export const buildRecordSignature = <T>(
  records: T[],
  selectFields: (record: T) => Array<string | number | boolean | null | undefined>,
): string =>
  records
    .map((record) =>
      selectFields(record)
        .map((field) => field ?? "")
        .join("|"),
    )
    .join("||")
