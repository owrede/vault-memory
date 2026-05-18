/**
 * slugify — Phase 6 / D-A1c, ADR-006 §Decision 1.
 *
 * Converts a kebab-case contract name into a snake_case MCP tool name
 * with the configured `tool_prefix` prepended. Zero deps (RESEARCH
 * Anti-Patterns — no `lodash`, no `change-case`).
 *
 * Examples:
 *   slugify("meeting-prep", "vm_")    → "vm_meeting_prep"
 *   slugify("project-status", "")     → "project_status"  (caller's
 *                                       responsibility to enforce A7 .min(1))
 *
 * First-wins on collision is the registry's job (`ContractRegistry.set`).
 *
 * Adapter-seam discipline: pure function, no imports, no I/O.
 */
export function slugify(name: string, prefix: string): string {
  return prefix + name.replace(/-/g, "_");
}
