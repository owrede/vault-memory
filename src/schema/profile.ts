export interface FieldProfile {
  key: string;
  types: string[];
  present: number;
  total: number;
}
export function inferFieldProfile(rows: Record<string, unknown>[]): FieldProfile[] {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  return keys.map((key) => {
    const values = rows.filter((row) => Object.hasOwn(row, key)).map((row) => row[key]);
    return {
      key,
      types: [
        ...new Set(
          values.map((value) =>
            value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
          ),
        ),
      ].sort(),
      present: values.length,
      total: rows.length,
    };
  });
}
