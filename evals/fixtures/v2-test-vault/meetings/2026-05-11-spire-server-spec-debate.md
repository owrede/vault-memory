---
title: Spire Site-Local Server Spec Debate — 2026-05-11
date: 2026-05-11
attendees:
  - dana-park
  - carlos-yim
  - bob-martinez
  - quinn-vega
created: 2026-05-11
---

# Spire Site-Local Server Spec Debate — 2026-05-11

Debate (not a decision meeting) on the production-hardware specification
for the [[projects/spire-fleet-orchestrator]] site-local server. Today
the orchestrator runs on a beefy laptop on the test floor; the Spire
product cannot ship without a real specification.

## Positions

- **Carlos: industrial PC.** Off-the-shelf industrial-grade PC (e.g.
  fanless, rated for warehouse temperatures). Pro: cheap, simple supply
  chain through Quinn. Con: limited compute headroom; over a 5-year
  lifecycle we'll regret the lack of GPU.
- **Bob: edge AI box.** A dedicated edge-AI appliance with NPU on
  board. Pro: future-proofs the orchestrator for ML-driven scheduling
  (Q3+ feature). Con: 4–6× cost; new vendor relationship to manage.
- **Dana: bring-your-own-server option.** Sell Spire as software, let
  the customer run it on their existing IT hardware. Pro: removes a
  capex line from the customer side. Con: support surface explodes;
  we'd need to certify many hardware configurations.

## Discussion

No position got a clean win. Bob conceded that the edge-AI feature set
is Q3+ and Carlos's industrial PC clears the Q2/Q3 product. Dana
conceded that bring-your-own-server is unworkable for the first ten
engagements; revisit at scale.

## Outcome

**No decision today.** Decision record will be drafted by Dana for
2026-05-25, after the Site A visit. Two informational asks come out
of this:

- Quinn to draft a notional BOM for an industrial-PC server (for
  cost-modeling purposes only — not committing to procurement).
- Bob to scope the edge-AI feature set that would justify a more
  expensive appliance, with realistic Q3+ feature dates.

## Action items

- [ ] Quinn — notional industrial-PC BOM, due 2026-05-18.
- [ ] Bob — edge-AI feature scope memo, due 2026-05-22.
- [ ] Dana — drive to a decision record by 2026-05-25.

## Notes

This is the open question called out in
[[references/spire-architecture]] and on
[[projects/spire-fleet-orchestrator]]'s open-risks list. The decision
unblocks first-engagement pricing and is on Dana's onboarding plan.
