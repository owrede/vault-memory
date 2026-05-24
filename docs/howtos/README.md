# vault-memory How-To Guides

Five short scenarios. Each illustrates **one principle** that makes
vault-memory's contract-driven knowledge layer different from an
arbitrary agent orchestration tool stitched to a vector store.

| # | Principle illustrated | Scenario |
|---|---|---|
| [01](01-clinic-intake-as-first-class-type.md) | **Contracts are a first-class type** (ADR-020) | A clinic intake form is not "a note" — it is a typed object the system can query. |
| [02](02-news-desk-staleness-as-ranking.md) | **Staleness biases retrieval** (ADR-021) | A news desk's research assistant stops citing last quarter's numbers as current. |
| [03](03-academic-lab-typed-edges.md) | **Typed edges across contracts** (ADR-022) | An academic lab asks "which experiments cited which papers by which co-authors" in one query. |
| [04](04-design-agency-contracts-as-resources.md) | **Contracts as MCP resources** (ADR-023) | A design agency's onboarding agent sees the project shape *before* asking the user a single question. |
| [05](05-field-engineer-failure-modes.md) | **Contracts declare failure modes** (ADR-024) | A field engineer's site-visit log stops being a hallucinated work order. |

## How to read these

Each how-to follows the same structure:

1. **The user and their job-to-be-done.**
2. **The naive stack** — what an arbitrary agent + vector store does.
3. **The vault-memory way** — contract excerpt, agent flow, outcome.
4. **What the principle bought you** — the one sentence that matters.

The fictional users are deliberately *not* developers. The point is
that contracts pay off in every domain where work has a shape — not
just in software engineering. If you read all five, you should be
able to explain in plain language *why* a knowledge layer is more
than a search layer.

For the design philosophy these guides distill, see
[`../v2/AGENTIC_KNOWLEDGE_LAYER.md`](../v2/AGENTIC_KNOWLEDGE_LAYER.md).
For the load-bearing ADRs, see [`../v2/adr/`](../v2/adr/).
