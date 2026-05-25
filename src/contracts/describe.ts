/**
 * describeContract — Phase 6 / CON-05 / Q-DESCRIBE.
 *
 * Pure function over `ParsedContract` returning the contract's input
 * JSON Schema + an auto-generated markdown summary. Used by the
 * `describe_contract` MCP tool so agents can discover what a contract
 * does before instantiating it.
 *
 * # Output
 *
 *   { ok: true,
 *     json_schema: <ParsedContract.inputJsonSchema>,
 *     summary: <markdown> }
 *   | { ok: false, reason: "unknown_contract", name }
 *
 * The summary contains the headings in RESEARCH §Q-DESCRIBE order:
 * `## Inputs`, `## Sources`, `## Sinks`, `## Assembly`, `## write_back`,
 * `## Output Shape`. Sections with no content are omitted. The
 * `Assembly` section renders steps as a numbered list — agents (and
 * humans) consume this directly without parsing the YAML.
 *
 * # Adapter-seam discipline
 *
 * Zero `fs` / `path` / `gray-matter` / `chokidar` / `yaml` imports.
 * Pure function over an in-memory ParsedContract.
 */

import type { ContractRegistry } from "./registry.js";
import type { ParsedContract } from "./types.js";

/**
 * Plain-language gloss for each baseline assembly verb, so the rendered
 * `## Assembly` section reads as steps a non-technical user can follow —
 * not bare function names. Keyed by the 11 baseline verbs (src/contracts/
 * schema.ts BASELINE_VERBS). `literal` and `mcp://…` peer verbs fall back
 * to a generic gloss.
 */
const VERB_GLOSS: Record<string, string> = {
  read_note: "Read a note's content",
  search_hybrid: "Search the vault (semantic + keyword)",
  search_sections: "Search for matching sections within notes",
  query_frontmatter: "Find notes by their properties (frontmatter)",
  expand: "Gather notes linked to the starting note (follow the graph)",
  cluster: "Group the gathered notes into related communities",
  recall: "Recall earlier agent observations from memory",
  compile_brief: "Compile the gathered notes into a brief",
  get_brief: "Fetch an already-compiled brief",
  list_backlinks: "List notes that link back to this one",
  get_outline: "Read a note's heading outline",
};

function glossFor(verb: string): string {
  if (VERB_GLOSS[verb]) return VERB_GLOSS[verb]!;
  if (verb === "literal") return "Use a fixed inline value";
  if (verb.startsWith("mcp://")) return `Call an external tool (${verb})`;
  return verb;
}

export interface DescribeDeps {
  registry: ContractRegistry;
}

export interface DescribeArgs {
  name: string;
}

export type DescribeResult =
  | { ok: true; json_schema: object; summary: string }
  | { ok: false; reason: "unknown_contract"; name: string };

export function describeContract(
  deps: DescribeDeps,
  args: DescribeArgs,
): DescribeResult {
  const parsed = deps.registry.get(args.name);
  if (!parsed) return { ok: false, reason: "unknown_contract", name: args.name };
  return {
    ok: true,
    json_schema: parsed.inputJsonSchema,
    summary: renderSummary(parsed),
  };
}

function renderSummary(parsed: ParsedContract): string {
  const lines: string[] = [];
  lines.push(`# ${parsed.name}`);
  lines.push("");
  if (parsed.description) {
    lines.push(parsed.description);
    lines.push("");
  }

  // ## Inputs
  if (Object.keys(parsed.inputs).length > 0) {
    lines.push("## Inputs");
    for (const [name, spec] of Object.entries(parsed.inputs)) {
      const s = (spec ?? {}) as Record<string, unknown>;
      const type =
        typeof s.type === "string"
          ? s.type
          : typeof s["$ref"] === "string"
            ? `\`${String(s["$ref"])}\``
            : "any";
      const required = parsed.required.includes(name) ? "required" : "optional";
      const desc = typeof s.description === "string" ? s.description : "";
      const descSuffix = desc ? `: ${desc}` : "";
      lines.push(`- **${name}** (${type}, ${required})${descSuffix}`);
    }
    lines.push("");
  }

  // ## Sources
  if (Object.keys(parsed.sources).length > 0) {
    lines.push("## Sources");
    for (const [handle, decl] of Object.entries(parsed.sources)) {
      const req = decl.required ? "required" : "optional";
      lines.push(`- **${handle}** → \`${decl.handle}\` (${req})`);
    }
    lines.push("");
  }

  // ## Sinks
  if (Object.keys(parsed.sinks).length > 0) {
    lines.push("## Sinks");
    for (const [handle, decl] of Object.entries(parsed.sinks)) {
      const req = decl.required ? "required" : "optional";
      lines.push(`- **${handle}** → \`${decl.handle}\` (${req} MemorySink)`);
    }
    lines.push("");
  }

  // ## Assembly — rendered as plain-language steps so a non-technical user
  // can follow what the contract does, with the verb + arg keys kept inline
  // for agents/authors who want the precise call.
  if (parsed.assembly.length > 0) {
    lines.push("## Assembly");
    parsed.assembly.forEach((step, i) => {
      const argsRender = step.args ? `(${Object.keys(step.args).join(", ")})` : "()";
      lines.push(
        `${i + 1}. **${step.as}** — ${glossFor(step.verb)} _(\`${step.verb}${argsRender}\`)_`,
      );
    });
    lines.push("");
  }

  // ## write_back
  if (parsed.write_back) {
    lines.push("## write_back");
    lines.push(
      `Writes a ${parsed.write_back.document_kind} document to \`${parsed.write_back.sink}\` ` +
        `with body from \`${parsed.write_back.body_from}\`.`,
    );
    lines.push("");
  }

  // ## Output Shape
  if (parsed.output_shape) {
    lines.push("## Output Shape");
    const props =
      ((parsed.output_shape as { properties?: Record<string, unknown> }).properties ?? {}) as Record<
        string,
        unknown
      >;
    const compact = Object.entries(props)
      .map(([k, v]) => {
        const o = (v ?? {}) as { type?: string; $ref?: string };
        const t = typeof o.type === "string" ? o.type : (o.$ref ?? "any");
        return `${k}: ${t}`;
      })
      .join(", ");
    lines.push(`\`{${compact}}\``);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}
