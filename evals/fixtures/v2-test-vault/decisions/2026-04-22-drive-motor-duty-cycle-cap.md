---
title: Cap drive-motor continuous duty cycle at 70%
date: 2026-04-22
status: accepted
created: 2026-04-22
---

# Cap drive-motor continuous duty cycle at 70%

## Decision

The Atlas-1 control loop will enforce a 70% continuous duty cycle cap
on the drive motors (HM-DR-280 — see
[[references/atlas-1-component-spec]]). The cap is implemented in the
motor controller firmware as a rolling 5-minute window; if average
current draw exceeds 70% of rated continuous, the controller throttles
the maximum commanded velocity until the window recovers below
threshold.

## Context

Through Q1 the drive motors on the test floor showed a worrying MTBF
skew: motor-B (the trailing motor on the chassis design) failed at
roughly two-thirds the MTBF of motor-A. Investigation by
[[people/carlos-yim]] traced this to thermal cycling — motor-B carries
slightly more load during turning maneuvers, and the resulting
temperature gradient accelerates winding-insulation failure modes.

This pattern surfaced as the second-highest intervention category
(22%) in the
[[projects/atlas-1-reliability-program]] April baseline. The
two-shift uptime program target (16h median) cannot be hit with
motor-B failing every ~40 hours of continuous operation.

## Alternatives considered

- **Replace HM-DR-280 with a higher-rated motor.** Rejected — a
  hardware revision in the middle of the Q2 pilot push is the wrong
  cost profile. Deferred to a possible rev-D in 2026-Q4.
- **Hardware fix via additional cooling.** Rejected — fan + air
  duct work would slip the build by 4–6 weeks. Considered acceptable
  only if the duty-cycle cap doesn't move the failure rate.
- **No firmware change; replace motor-B more frequently as a
  consumable.** Rejected — operationally untenable at the pilot sites
  ([[references/customer-pilot-playbook]]) and inconsistent with the
  reliability narrative we're selling Spire on.

## Consequences

- Top end of robot speed reduced under sustained-driving scenarios.
  Field validation by Carlos showed the practical impact is small —
  warehouses generally have stop-and-go traffic, not continuous
  high-speed transit.
- Spare-parts inventory model revised by [[people/quinn-vega]]
  (see [[meetings/2026-04-17-atlas-1-build-review]] action item).
- Motor-B failure rate to be re-baselined by end of May. If the
  failures persist, the rev-D hardware revision option becomes
  active.
- The motor-B intervention rate is the lever for moving the Q2 uptime
  metric from 6h → ≥10h by end of May ([[meetings/2026-04-30-april-reliability-retro]]).
