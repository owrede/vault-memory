/**
 * Unit tests for ContractFileSchema (Phase 6 / CON-01).
 *
 * Validates the three reference contracts from RESEARCH Examples 1/6/7
 * by parsing the YAML literal via `parseDocument` and feeding the
 * `.toJS()` result through the Zod schema. Loader-level concerns (file
 * scan, ChangeFeed events) land in Plan 06-02.
 *
 * NOTE: test files are exempt from `lint-adapters.sh` filename
 * exclusion — `yaml` is allowed here.
 */

import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";
import { ContractFileSchema } from "./schema.js";

// ── Reference contracts (RESEARCH §Example 1/6/7) ──────────────────────
const MEETING_PREP_YAML = `
version: 1
name: meeting-prep
description: |
  Compile a meeting prep brief from the meeting note + linked context.
  Output is a brief written into the briefs sink.
inputs:
  meeting_doc_id:
    $ref: '#/types/DocId'
    description: DocId of the meeting note.
  context_hops:
    type: integer
    minimum: 1
    maximum: 2
    default: 1
    description: How many wikilink hops to expand from the meeting note.
required: [meeting_doc_id]
sources:
  default_source:
    handle: 'obsidian-fs://my-vault'
    required: true
sinks:
  default_sink:
    handle: '_memory/_briefs'
    required: true
assembly:
  - as: meeting
    verb: read_note
    args:
      doc_id: '{{inputs.meeting_doc_id}}'
  - as: linked
    verb: expand
    args:
      seed_doc_ids: ['{{inputs.meeting_doc_id}}']
      hops: '{{inputs.context_hops}}'
      direction: both
  - as: clustered
    verb: cluster
    args:
      seed_doc_ids: '{{linked.doc_ids}}'
      method: edge-community
  - as: compiled
    verb: compile_brief
    args:
      vault: my-vault
      target: '{{inputs.meeting_doc_id}}--prep'
      source_doc_ids: '{{linked.doc_ids}}'
      purpose: 'Meeting prep brief for {{meeting.title}}'
      max_tokens: 2000
output_shape:
  type: object
  properties:
    brief_doc_id:
      $ref: '#/types/DocId'
    cluster_count:
      type: integer
  required: [brief_doc_id]
write_back:
  sink: '{{default_sink}}'
  document_kind: brief
  properties:
    target: '{{inputs.meeting_doc_id}}--prep'
    source: agent
  body_from: '{{compiled.body}}'
`;

const PROJECT_STATUS_YAML = `
version: 1
name: project-status
description: Compile a status brief for a project tracked in the vault.
inputs:
  project_key:
    type: string
    description: 'Project key, e.g. "atlas-1"'
  freshness_days:
    type: integer
    default: 30
required: [project_key]
sources:
  default_source:
    handle: 'obsidian-fs://my-vault'
    required: true
sinks:
  default_sink:
    handle: '_memory/_briefs'
    required: true
assembly:
  - as: project_notes
    verb: query_frontmatter
    args:
      vault: my-vault
      where:
        project: '{{inputs.project_key}}'
      limit: 100
  - as: grouped
    verb: cluster
    args:
      seed_doc_ids: '{{project_notes.doc_ids}}'
      method: edge-community
  - as: compiled
    verb: compile_brief
    args:
      vault: my-vault
      target: '{{inputs.project_key}}--status'
      source_doc_ids: '{{project_notes.doc_ids}}'
      purpose: 'Project status for {{inputs.project_key}}'
output_shape:
  type: object
  properties:
    brief_doc_id: { $ref: '#/types/DocId' }
    note_count: { type: integer }
  required: [brief_doc_id]
write_back:
  sink: '{{default_sink}}'
  document_kind: brief
  properties:
    target: '{{inputs.project_key}}--status'
    source: agent
  body_from: '{{compiled.body}}'
`;

const CODE_REVIEW_YAML = `
version: 1
name: code-review-brief
description: Compile a code-review-context brief.
inputs:
  pr_doc_id:
    $ref: '#/types/DocId'
  search_query:
    type: string
required: [pr_doc_id, search_query]
sources:
  default_source:
    handle: 'obsidian-fs://my-vault'
    required: true
sinks:
  default_sink:
    handle: '_memory/_briefs'
    required: true
assembly:
  - as: pr
    verb: read_note
    args:
      doc_id: '{{inputs.pr_doc_id}}'
  - as: related
    verb: search_hybrid
    args:
      query: '{{inputs.search_query}}'
      top_k: 20
  - as: compiled
    verb: compile_brief
    args:
      vault: my-vault
      target: '{{inputs.pr_doc_id}}--review'
      source_doc_ids: '{{related.doc_ids}}'
      purpose: 'Code review context for {{pr.title}}'
output_shape:
  type: object
  properties:
    brief_doc_id: { $ref: '#/types/DocId' }
  required: [brief_doc_id]
write_back:
  sink: '{{default_sink}}'
  document_kind: brief
  properties:
    target: '{{inputs.pr_doc_id}}--review'
    source: agent
  body_from: '{{compiled.body}}'
`;

function parse(yaml: string): unknown {
  return parseDocument(yaml).toJS();
}

describe("ContractFileSchema (CON-01)", () => {
  it("Test 13: validates Example 1 — meeting-prep", () => {
    const result = ContractFileSchema.safeParse(parse(MEETING_PREP_YAML));
    if (!result.success) {
      throw new Error(
        `meeting-prep failed: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.success).toBe(true);
    expect(result.data.name).toBe("meeting-prep");
    expect(result.data.assembly).toHaveLength(4);
    expect(result.data.required).toEqual(["meeting_doc_id"]);
  });

  it("Test 13b: validates Example 6 — project-status", () => {
    const result = ContractFileSchema.safeParse(parse(PROJECT_STATUS_YAML));
    if (!result.success) {
      throw new Error(
        `project-status failed: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.success).toBe(true);
    expect(result.data.name).toBe("project-status");
  });

  it("Test 13c: validates Example 7 — code-review-brief", () => {
    const result = ContractFileSchema.safeParse(parse(CODE_REVIEW_YAML));
    if (!result.success) {
      throw new Error(
        `code-review-brief failed: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.success).toBe(true);
    expect(result.data.name).toBe("code-review-brief");
  });

  it("Test 14: rejects contracts missing `name`", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      assembly: [{ as: "x", verb: "literal", value: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("Test 14b: rejects `version: 2` (v2.0.0 only supports version 1)", () => {
    const r = ContractFileSchema.safeParse({
      version: 2,
      name: "x",
      assembly: [{ as: "y", verb: "literal", value: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("Test 14c: rejects assembly step missing `as:`", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "x",
      assembly: [{ verb: "literal", value: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("Test 14d: rejects two steps sharing the same `as:` alias", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "x",
      assembly: [
        { as: "dup", verb: "literal", value: 1 },
        { as: "dup", verb: "literal", value: 2 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/duplicate step alias/);
    }
  });

  it("Test 15: accepts all 11 baseline verbs verbatim", () => {
    const verbs = [
      "search_hybrid",
      "expand",
      "cluster",
      "recall",
      "compile_brief",
      "get_brief",
      "query_frontmatter",
      "list_backlinks",
      "get_outline",
      "search_sections",
      "read_note",
    ];
    for (const verb of verbs) {
      const r = ContractFileSchema.safeParse({
        version: 1,
        name: "x",
        assembly: [{ as: "step", verb }],
      });
      expect(r.success).toBe(true);
    }
  });

  it("Test 15b: accepts `literal` verb", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "x",
      assembly: [{ as: "step", verb: "literal", value: "v" }],
    });
    expect(r.success).toBe(true);
  });

  it("Test 15c: accepts `mcp://server/tool` verb", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "x",
      assembly: [{ as: "step", verb: "mcp://gh/list_issues" }],
    });
    expect(r.success).toBe(true);
  });

  it("Test 15d: REJECTS `write_note` and other write verbs (D-A2a no-write-verbs invariant)", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "x",
      assembly: [{ as: "step", verb: "write_note" }],
    });
    expect(r.success).toBe(false);
  });

  it("Test 15e: REJECTS arbitrary tool name (open-form risk)", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "x",
      assembly: [{ as: "step", verb: "delete_everything" }],
    });
    expect(r.success).toBe(false);
  });

  it("Test 15f: REJECTS malformed mcp:// shape", () => {
    // Missing the tool segment after the server
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "x",
      assembly: [{ as: "step", verb: "mcp://gh" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects kebab-case name with leading digit", () => {
    const r = ContractFileSchema.safeParse({
      version: 1,
      name: "1bad",
      assembly: [{ as: "step", verb: "literal", value: 1 }],
    });
    expect(r.success).toBe(false);
  });
});
