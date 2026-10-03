import type { FieldProfile } from "./profile.js";
export interface SchemaField {
  key: string;
  types: string[];
  required: boolean;
}
export interface SchemaDrift {
  key: string;
  kind: "missing" | "unexpected" | "type_changed";
}
export function diffSchema(expected: SchemaField[], observed: FieldProfile[]): SchemaDrift[] {
  const drift: SchemaDrift[] = [];
  for (const field of expected) {
    const profile = observed.find((row) => row.key === field.key);
    if (field.required && (!profile || profile.present < profile.total))
      drift.push({ key: field.key, kind: "missing" });
    if (profile && profile.types.some((type) => !field.types.includes(type)))
      drift.push({ key: field.key, kind: "type_changed" });
  }
  for (const profile of observed)
    if (!expected.some((field) => field.key === profile.key))
      drift.push({ key: profile.key, kind: "unexpected" });
  return drift.sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
  );
}
