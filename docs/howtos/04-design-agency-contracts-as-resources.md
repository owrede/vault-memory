# How-To 04 — The onboarding agent that already knows the shape

**Principle:** Contracts are MCP Resources, not just Tools (ADR-023).
**Domain:** Boutique design studio / client onboarding.
**One-sentence takeaway:** When the contract is in the model's
context as a *resource*, the agent's first message to the user is
no longer "tell me about your project" — it is the right four
questions.

---

## Meet Atelier Vautrin

Atelier Vautrin is a five-person brand-identity studio in Lyon.
They onboard ~30 new clients a year. Their intake conversation has a
shape every studio member knows by heart:

- *What does the client make or sell?*
- *Who are the three most important people on their side?*
- *What is the single brand decision keeping them up at night?*
- *What is the budget ceiling we should not exceed?*
- *What is the deadline we must hit?*
- *Three brands they admire and the one specific thing they admire about each.*

Two years ago founder Camille turned this into a `client-onboarding`
contract. The studio's MCP-aware writing assistant (a Claude Code
session running in their writing-room iPad) is the agent that runs
intake interviews.

---

## The naive stack

A generic agent connected to a generic vector store knows nothing
about Atelier Vautrin's intake shape. The first conversation goes:

```
Agent:  Hello! How can I help you today?
Client: We need a new brand identity.
Agent:  Great! Tell me about your company.
Client: We make artisanal cheese.
Agent:  Wonderful! What's the project about?
Client: ...we just said. A new brand identity.
Agent:  Of course. What are your goals?
Client: ...
```

The agent has no idea what shape an onboarding takes at Atelier
Vautrin. Camille has tried "system prompt with the six questions"
twice; each time the agent improvises off-script in front of a
paying client. The agent does not know the *six questions are the
contract*. It knows them as six suggestions.

The intake meeting ends. Camille spends 40 minutes the next morning
re-asking the questions she actually needs answered.

---

## The vault-memory way

vault-memory loads the `client-onboarding` contract at boot and
exposes it as an MCP **resource** at
`contract://atelier-vautrin/client-onboarding`. The studio's iPad
MCP host (Claude Desktop) subscribes to `resources/list` on session
start.

When Camille opens a chat with a new client present, **the resource
is already in the model's context**:

```text
<resource uri="contract://atelier-vautrin/client-onboarding">
# client-onboarding

Studio intake for a new brand-identity engagement. Every field
must be answered or explicitly deferred before kickoff.

## Inputs

- `client.name`           (string, required)
- `client.industry`       (string, required)
- `client.stakeholders`   (array of Person refs, required, min: 1, max: 5)
- `client.brand_question` (string, required) — the one decision keeping them up at night
- `budget.ceiling_eur`    (integer, required)
- `deadline`              (date, required)
- `inspirations`          (array of objects {brand, what_specifically}, required, min: 3, max: 3)

## Failure modes
- `brand_question`: mark_unresolved (we follow up by email if the client cannot articulate it in the room)
- `inspirations`:    refuse (we do not start a brand without three reference points)
</resource>
```

The agent now opens the conversation **already knowing the shape**:

```
Agent:  Welcome to Atelier Vautrin. I'll be helping us capture
        the six things we need before kickoff. Let's start with
        what you make and who you serve.
Client: We make artisanal cheese — small farm in the Jura,
        five varieties, mostly restaurants.
Agent:  Got it. Of the people on your side, who are the three
        most important for us to know? Often this is the
        founder, whoever owns the budget, and whoever will
        approve the final mark.
Client: My business partner Léa, our cheesemaker Henri, and our
        biggest restaurant client Marc Dubois.
Agent:  Perfect. Now the question that usually takes the longest
        — what is the one decision about the brand that is
        keeping you up at night?
```

By minute eight the agent has hit every contract field. The client
feels heard, not interrogated. Camille watches from across the room
and intervenes twice — once to clarify a stakeholder, once to push
on a fuzzy inspiration. She is the studio director, not the
note-taker.

### Why the resource matters more than the tool

The agent could have, in principle, called `describe_contract` as a
tool. Two problems with that path:

1. **The agent has to know to ask.** Without the resource in
   context, the agent's first move is to call `list_tools` and
   wonder which of 41 tools is relevant to a client conversation.
   The resource is *passive context*: the host injects it without
   the agent doing anything.
2. **It costs a tool roundtrip per session.** With 30 clients a
   year and three onboardings per agent session, that's 90
   roundtrips a year for information that does not change. The
   resource is cached in context and updated only on
   `notifications/resources/updated`.

### When the contract changes

Camille redesigns the contract — `inspirations` now requires four
references, not three. She updates the canvas. The plugin emits new
YAML. vault-memory's loader fires:

```text
notifications/resources/updated({ uri: "contract://atelier-vautrin/client-onboarding" })
```

Claude Desktop re-fetches the resource. Tomorrow's intake session
opens with the new shape in context. No code change, no prompt
update, no studio meeting.

---

## What the principle bought you

> Tools are how an agent **does** things. Resources are how an
> agent **knows** things. A contract is both — and exposing only the
> tool surface under-uses the protocol.

The naive stack treats every conversation as a cold start. The
vault-memory stack treats *the studio's accumulated shape of how
intakes work* as something the model sees before the first word is
typed. The client walks out of the meeting feeling like the studio
knows what it is doing — because the studio's accumulated knowledge
is now in the agent's context.

For the load-bearing decision, see
[ADR-023 — Contracts as MCP Resources, not just Tools](../v2/adr/023-contracts-as-mcp-resources.md).
