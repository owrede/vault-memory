import { afterEach, expect, it } from "vitest";
import { Database } from "../database.js";
import { parseObservations } from "../../observations/parse.js";
let db: Database;
afterEach(() => db?.close());
it("backfills a version-17 database without rewriting canonical content or losing statement IDs", () => {
  db = new Database(":memory:", "lab");
  const content = '- [fact] Old rule <!-- validity: {"valid_to":"2026-02-01T00:00:00Z"} -->';
  const id = db.notes.upsertByPath({
    path: "a.md",
    title: "A",
    content,
    frontmatter: JSON.stringify({ valid_from: "2026-01-01T01:00:00+01:00" }),
    hash: "canonical",
    bodyHash: "body",
    mtime: 0,
    wordCount: 1,
  }).id;
  db.observations.replaceForNote(id, "canonical", parseObservations(content));
  const observation = db.observations.listForNote(id)[0]!;
  db.handle.exec(
    "DROP INDEX notes_validity; DROP INDEX observations_validity; ALTER TABLE notes DROP COLUMN valid_from_ms; ALTER TABLE notes DROP COLUMN valid_to_ms; ALTER TABLE notes DROP COLUMN validity_error; ALTER TABLE observations DROP COLUMN valid_from_ms; ALTER TABLE observations DROP COLUMN valid_to_ms; ALTER TABLE observations DROP COLUMN validity_error; ALTER TABLE observations DROP COLUMN validity_origin; PRAGMA user_version=17;",
  );
  db.migrate();
  db.migrate();
  expect(db.notes.getById(id)).toMatchObject({
    content,
    hash: "canonical",
    valid_from_ms: Date.parse("2026-01-01T00:00:00Z"),
    valid_to_ms: null,
    validity_error: null,
  });
  expect(
    db.handle.prepare("SELECT * FROM observations WHERE id=?").get(observation.id),
  ).toMatchObject({
    id: observation.id,
    text: "Old rule",
    doc_hash: "canonical",
    valid_from_ms: Date.parse("2026-01-01T00:00:00Z"),
    valid_to_ms: Date.parse("2026-02-01T00:00:00Z"),
    validity_origin: "mixed",
    validity_error: null,
  });
});
it("never opens an interval from a malformed statement annotation", () => {
  expect(
    parseObservations('- [fact] Claim <!-- validity: {"confidence":"direct"} -->')[0],
  ).toMatchObject({ text: "Claim", validity_error: "annotation" });
  expect(parseObservations("- [fact] Claim <!-- validity: broken -->")[0]).toMatchObject({
    text: "Claim",
    validity_error: "annotation",
  });
});
