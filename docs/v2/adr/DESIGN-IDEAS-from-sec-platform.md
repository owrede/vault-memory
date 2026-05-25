# Design Ideas — extracted from the AWS AgentCore Security Platform comparison

**Status:** Exploratory notes, not ADRs. Captured 2026-05-25.
**Source:** Comparison of vault-memory against
[derrickSh43/AWS_AgentCore_Security_Agent_Sec_platform](https://github.com/derrickSh43/AWS_AgentCore_Security_Agent_Sec_platform)
— an AWS-native EKS security-operations platform. The full comparison note
lives in the user's vault (`INIM-RESEARCH/.../Agentic Orchestration Platforms/`).

The AWS platform and vault-memory share one core stance — **the agent never
mutates silently; it proposes, a human confirms, and everything carries
provenance.** vault-memory expresses this through the `MemorySink` validator
(ADR-004); the AWS platform through a GitOps boundary (AI opens a PR → ArgoCD
→ cluster). Same pattern, different substrate.

This document records which patterns from that platform map onto vault-memory.
**Most of the obviously-useful ones are already specified.** The point of this
note is to (a) avoid re-proposing solved problems, and (b) isolate the two
patterns that are *not* yet covered and might warrant an ADR later.

---

## Already covered — do not re-propose

| Pattern in the AWS platform | vault-memory equivalent | Where |
|---|---|---|
| `finding_id = SHA-256(source + key fields)`; re-ingestion is idempotent / deduplicated | `Document.hash = sha256(canonical(blocks) ‖ canonical(properties))` per RFC 8785, byte-identical across adapters | **ADR-003** §Hash semantics, invariants H-1…H-7 |
| Immutable audit trail separate from the live queryable store (S3 archive vs DynamoDB) | All agent writes route through `DeliveryAdapter.write()`; bypass paths forbidden; runtime audit log + `WriteAuditRow` | **ADR-004** M-4; `src/audit/` |
| `confidence` + `status` as first-class fields in the normalized schema | `default-memory-v1` requires `confidence ∈ {direct, inferred, uncertain}` and `status ∈ {active, superseded, rejected}` | **ADR-004** §MemoryContract |
| Prioritize by severity/confidence/exploitability at query time | Authority + staleness + supersession as multiplicative ranking inputs to `hybridSearch` (bias stage after rerank) | **ADR-021** |
| Human-in-the-loop: agent proposes, never executes | `MemorySink` is the only agent-writable location; Guards A/B; sentinel file | **ADR-004** M-3, M-5 |

If a future reader is tempted to "add content-hashing for dedup" or "add a
confidence field" — it exists. Read the ADRs above first.

---

## Gap 1 — Event-driven brief refresh (the `daily_digest` pattern)

**What the AWS platform does.** Its AgentCore runtime fires on two triggers:
an EventBridge event when a critical/high finding lands, and a cron schedule
(8 AM `daily_digest`). The digest is *pushed*, pre-computed, not pulled on
demand.

**Where vault-memory stands.** ADR-005 specifies *how* a brief is compiled
(the LLM ladder, sampling, source-hash citation packets). ADR-003 H-5 specifies
*when a brief becomes stale* (a cited chunk's hash diverges). But nothing
specifies the **trigger** that recompiles a stale brief — today the model is
purely pull: a brief goes stale and sits stale until an agent next requests it
and notices.

**The idea.** A local, opt-in equivalent of `daily_digest`: when the staleness
daemon (Phase 5, BRF-05) flips a brief to `status: stale`, optionally enqueue a
recompile rather than waiting for the next read. The trigger is the existing
chokidar watcher + a debounce, *not* a cron — this keeps it local-first and
inside the single-process constraint.

**Why it fits.**
- The detection half already exists (H-5 staleness check). Only the *reaction*
  is missing.
- It directly attacks the v2 thesis ("agents rediscover 85% of context every
  run") — a pre-warmed brief is the whole point.

**Tensions to resolve before this becomes an ADR.**
- **LLM coupling.** Recompilation calls the brief LLM ladder (ADR-005). Doing
  that on a watcher event means the indexing event loop can trigger LLM calls —
  the CLAUDE.md constraint "no premature LLM coupling" and the single-threaded
  event-loop note both apply. Recompile must be queued and rate-limited, never
  inline in the watcher callback.
- **Cost/thrash.** A noisy vault (many saves) could trigger constant
  recompiles. Needs a debounce window and probably a "max recompiles per hour"
  budget, mirroring the platform's once-daily cadence rather than per-event.
- **Opt-in.** Default should stay pull-only; eager refresh is a `[briefs]`
  config opt-in.

**Smallest viable version.** Mark stale briefs in a queue table; expose a
`refresh_briefs` MCP tool the user (or a host's own scheduler) calls explicitly.
That gets the *pre-computation* benefit without putting any scheduler or LLM
trigger inside vault-memory itself — and is a strictly additive tool. The
event-driven auto-trigger is a later step gated on the cost controls above.

---

## Gap 2 — Impact propagation: "blast radius" → "context radius"

**What the AWS platform plans.** A Cartography/Neo4j identity graph (IAM + K8s)
to answer **blast-radius** queries: "if this credential is compromised, what
else is reachable?" The graph is used for *impact analysis*, not similarity.

**Where vault-memory stands.** ADR-022 introduces typed cross-contract edges
(`ref(Kind)`) for multi-hop *retrieval*. The graph is a retrieval/navigation
structure. What it does **not** model is *impact*: when a memory document is
superseded or goes stale, which downstream artifacts depend on it?

**The idea.** Treat the edge graph as a dependency graph for a **context-radius**
query, the knowledge-layer analog of blast radius: "if I supersede this
observation, which briefs cited it, and which other memories list it as
`evidence`?" The data already exists — ADR-003 stores `evidence` as
`reference` edges, briefs store `source_hashes` (ADR-003 H-5), and supersession
is a first-class status (ADR-004). What's missing is a query that walks the
*reverse* edges to compute the affected set.

**Concretely.** When `supersede` sets `status: superseded` on a memory doc:
1. Find all briefs whose `source_hashes` cite a chunk of that doc → already
   flippable to stale via H-5.
2. Find all memory docs listing the superseded doc in `evidence` (reverse
   reference edge walk) → these are now resting on a retracted basis.
3. Surface the affected set so the agent (or user) can review — *propose*, not
   auto-cascade. Cascading supersession automatically would violate the
   human-in-the-loop stance; this only *reports* the radius.

**Why it fits.**
- Strengthens the supersession story (ADR-004's open follow-up on deletion
  semantics) with a "what does this affect?" answer.
- Reuses the existing edges/graph tables; no new storage, just a reverse-walk
  query.
- Stays advisory — consistent with "agent proposes, human confirms."

**Tensions.**
- Reverse-edge walks can fan out widely; needs a depth bound (mirrors the
  platform's bounded blast-radius queries).
- Overlaps with ADR-022 (typed edges) — likely an *extension* of that ADR's
  graph rather than a new one. Decide whether to amend 022 or write a sibling.

---

## Explicitly not adopted

- **GitOps boundary** — elegant for the AWS platform, but the `MemorySink`
  validator (ADR-004) is already the local equivalent. No added value, just a
  different mechanism.
- **Distributed Lambda fan-out pipeline** — directly contradicts the
  monolithic single-process / synchronous-SQLite constraint (CLAUDE.md). Not
  applicable.
- **Cloud-managed storage (DynamoDB + S3 + KMS)** — contradicts local-first.
  The *separation* (immutable archive vs live store) is the transferable idea,
  and that is Gap-free (covered by ADR-004 + audit log).

---

## If these get promoted

Both gaps are post-v2.0.0 / v2.x in spirit (additive, no v1 break). Per the ADR
README contributing rules, a promotion would take the next free integer (025+),
follow the MADR template with `## Invariants` + `## Examples`, and go through the
discuss → research → plan loop on the v2.x branch. Gap 2 may instead be an
amendment to ADR-022. Neither is decision-ready yet — these are notes.
