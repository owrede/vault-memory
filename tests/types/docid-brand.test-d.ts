/**
 * Compile-time negative test for the branded `DocId` type (ADP-05).
 *
 * This file is NOT a vitest test — it is a compile-time assertion that
 * runs under `tsc --noEmit` (= `npm run lint`). The assertion mechanism
 * is the `@ts-expect-error` directive: if TypeScript stops emitting an
 * error on a directive line, the directive ITSELF becomes the compile
 * error ("Unused '@ts-expect-error' directive"). That's the test.
 *
 * Approach: option (A) from `01-PATTERNS.md` — no new devDep; relies
 * only on `tsc --noEmit` which already runs in `npm run lint:check`.
 *
 * To break this test on purpose (smoke check): remove one
 * `@ts-expect-error` line and re-run `npm run lint`. It MUST fail.
 *
 * Cases covered:
 *   1. Raw string literal cannot be assigned to a `DocId` variable.
 *   2. Raw string-typed variable cannot be assigned to a `DocId`.
 *   3. Raw string literal cannot be passed to a function expecting `DocId`.
 *   4. Positive sanity case: `parseDocId(...)` returns a real `DocId`.
 */

import type { DocId } from "../../src/types.js";
import { parseDocId } from "../../src/adapters/registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// Case 1 — raw string literal is not assignable to DocId
// ─────────────────────────────────────────────────────────────────────────────

// @ts-expect-error — raw string literal is not assignable to DocId
const _case1: DocId = "obsidian-fs://my-vault/a.md";

// ─────────────────────────────────────────────────────────────────────────────
// Case 2 — string-typed variable is not assignable to DocId
// ─────────────────────────────────────────────────────────────────────────────

const _raw: string = "obsidian-fs://my-vault/a.md";
// @ts-expect-error — string variable is not assignable to DocId
const _case2: DocId = _raw;

// ─────────────────────────────────────────────────────────────────────────────
// Case 3 — function-call site rejects raw string
// ─────────────────────────────────────────────────────────────────────────────

function takesDocId(_id: DocId): void {
  // body is intentionally empty
}

// @ts-expect-error — raw string is not assignable to DocId at the call site
takesDocId("obsidian-fs://my-vault/a.md");

// ─────────────────────────────────────────────────────────────────────────────
// Case 4 — positive sanity. parseDocId returns a real DocId; MUST compile.
// (no @ts-expect-error here — if tsc errors on this line, the brand is broken)
// ─────────────────────────────────────────────────────────────────────────────

const _valid: DocId = parseDocId("obsidian-fs://my-vault/note.md");
takesDocId(_valid);

// Mark the local bindings as "used" so strict unused-locals settings
// would not flag them. Each binding is consumed below.
void _case1;
void _case2;
void _valid;
