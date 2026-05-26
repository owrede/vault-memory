# How vault-memory Works

*A plain-language guide — no technical background required.*

vault-memory connects your Obsidian notes to an AI assistant (like Claude) so the AI
can **find, connect, and use** what you've written — and help you get better results
from your own knowledge. This page explains how, using everyday analogies and one
diagram.

---

## The one-sentence version

> vault-memory turns your pile of notes into something an AI can reason over —
> safely, with sources, and without ever secretly changing your notes.

---

## The problem it solves

When you ask an AI assistant for help, it usually starts from zero every time. It
re-reads, re-searches, and re-discovers the same background again and again. Studies of
agent workflows put this "rediscovery tax" at roughly **85% of the work repeated every
run**.

vault-memory's job is to **stop that waste**: give the AI a fast, reliable way to pull
exactly the right context — and to remember what it figured out — so each request starts
from knowledge, not from scratch.

---

## The big picture (one diagram)

```
                        YOU
              "Prepare my meeting with Sarah."
                         │
                         ▼
        ┌────────────────────────────────────┐
        │   AI ASSISTANT (Claude)             │   ← thinks, judges, talks to you
        │   - understands your request        │
        │   - decides what to do              │
        └───────────────┬────────────────────┘
                         │  asks for help via a shared "language" (MCP)
                         ▼
        ┌────────────────────────────────────┐
        │   vault-memory                      │   ← the librarian of your notes
        │                                     │
        │   • Search      find relevant notes │
        │   • Connect     follow links between│
        │                 notes (the web)     │
        │   • Compile     bundle notes into a │
        │                 ready-made briefing │
        │   • Remember    save findings in a  │
        │                 SEPARATE memory area│
        └───────────────┬────────────────────┘
                         │  reads / writes
                         ▼
        ┌──────────────────────┬─────────────────────────┐
        │  YOUR NOTES          │  AI MEMORY (separate)    │
        │  (untouched by AI)   │  _memory/ folder         │
        │  meetings, people,   │  briefings the AI wrote, │
        │  projects, ideas …   │  always with a source    │
        │                      │  stamp                   │
        └──────────────────────┴─────────────────────────┘
```

Two ideas in that picture matter most:

1. **vault-memory is a librarian, not the author.** The AI does the thinking; the
   librarian fetches and organizes the right material.
2. **Two separate shelves.** Your notes are one shelf. The AI's findings go on a
   *different* shelf (the `_memory/` area). The AI can read your shelf but **cannot
   write to it on its own** — only to its own shelf. This is the single most important
   safety rule of the whole system.

---

## What vault-memory can do (four capabilities)

### 1. Search — find the right notes
Not just keyword matching: it understands *meaning*. Ask "who works on scheduling AI"
and it finds the right person even if your note never used those exact words. (It
combines meaning-based search with classic keyword search and, optionally, a re-ranking
step that pushes the best match to the top.)

### 2. Connect — follow the web between notes
Your notes link to each other (`[[like this]]`). vault-memory can follow that web — from
a person, to their organization, to its projects — and spot clusters of related notes.
So a search isn't just a list of hits; it can be a *neighborhood* of connected context.

### 3. Compile — turn many notes into one briefing
This is the standout feature. vault-memory can read several notes and write a single,
**ready-made briefing** — with a stamp showing exactly which notes it came from. And if
one of those source notes later changes, the briefing **automatically marks itself
"out of date"** so the AI knows to refresh it. Your knowledge never silently goes stale
behind the AI's back.

### 4. Remember — keep findings safely separated
When the AI records something, it goes into the labeled `_memory/` shelf with a
provenance stamp (who wrote it, when, from which sources). It is **structurally
impossible** for the AI to write into your real notes by mistake — every write passes
through a single checkpoint that refuses anything aimed at your notes.

---

## How this helps the AI get better results

| Without vault-memory | With vault-memory |
|---|---|
| AI guesses or re-searches every time | AI pulls the exact relevant context fast |
| Answers without traceable sources | Every result carries its source |
| Stale information cited as current | Briefings flag themselves out-of-date |
| Risk of the AI editing your notes | AI writes only to its own memory shelf |
| Knowledge re-discovered each run | Knowledge compiled once, reused |

The result: the AI walks in **already informed** — with sourced, current, relevant
context — instead of starting cold.

---

## Contracts: your saved research recipes

You'll often want the *same kind* of research repeatedly — every meeting, every project
review. A **contract** is a saved recipe that says: *for this recurring task, gather
THESE notes, in THIS order, and compile them into a briefing.*

- You (or the shipped examples) define a contract once.
- Any AI assistant can then **discover and run it** — you just say "prepare my meeting"
  and it finds and runs the matching recipe.
- A contract is **research only**. It gathers and briefs; it never acts on the outside
  world. (That safety boundary is deliberate — see the honest limits below.)

Think of a contract as a **standing research order** to the librarian: "whenever I have
a meeting, pull the person's file, their organization, and our shared projects, and put
a summary on the memory shelf."

---

## Who does what: the four roles

A real request like *"prepare my meeting with Sarah and email her the agenda"* actually
involves four distinct roles. Keeping them separate is what makes the system both
**safe** and **useful**:

| Role | What it is | What it does | Can it change YOUR notes? |
|---|---|---|---|
| **Contract** | A saved research recipe | Gathers notes → writes a briefing to the memory shelf | **No** (impossible by design) |
| **Agent** (the AI) | The assistant | Reads the briefing, judges, drafts, and — *with your OK* — writes a note or sends an email | **Yes**, with your approval |
| **Skill** | A trigger hint | Tells the AI *when* to reach for a contract ("user said 'prepare a meeting' → use the meeting recipe") | No |
| **You** | The owner | Decide, approve, correct | Always in control |

> **The librarian (contract) prepares the research folder and leaves it on the intake
> desk. The assistant (agent) reads it and — once you nod — writes the final document on
> your desk and sends the email.** The librarian never touches your desk.

---

## Honest limits (what's solid vs. still being designed)

This system is real and tested, but it's evolving. To set expectations clearly:

**Solid and working today:**
- Search, connect, compile, and the safe separate-memory rule.
- Contracts as research recipes (the briefing-compilation path).

**Designed, not yet fully built (concepts on the roadmap):**
- **Workflows** — Today a contract only *researches*; it can't *act* (write a note into
  your vault, send an email). Defining "what should actually be produced or done" is a
  separate, planned layer called a **Workflow**. For now, the AI handles that final step
  on its own, with your approval, guided by a Skill. *(See ADR-028.)*
- **Learning from feedback** — The vision is that when you say "next time also research
  X," the system captures that and improves the recipe automatically. The groundwork
  (the quality signals needed to learn) is being designed now. *(See ADR-029.)*
- **Smarter context budgets** — Giving the AI a context window that's not just relevant
  but optimally *sized and ordered* is a planned refinement. *(See ADR-026.)*

---

## In short

vault-memory is a **safe, sourced, reusable memory layer** between your notes and your AI
assistant. It finds the right things, connects them, compiles them into briefings that
stay honest about their freshness, and keeps the AI's own findings on a separate shelf so
your notes are never silently changed. The AI does the thinking; vault-memory makes sure
it thinks with the *right* material.

---

*For the technical decisions behind each capability, see the
[Architecture Decision Records](adr/README.md). For developers, see
[ARCHITECTURE.md](ARCHITECTURE.md). The safety rule is specified in
[MEMORY_CONTRACT.md](MEMORY_CONTRACT.md).*
