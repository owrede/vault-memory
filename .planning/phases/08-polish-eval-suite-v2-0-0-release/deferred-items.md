# Phase 8 — Deferred Items

Items discovered during phase 8 execution that are deferred to a later plan
or to v2.0.x / v2.1, with the reason and the resolving owner.

## From plan 08-04 (screencast artifacts)

### Task 1 — Record `vault-memory-plugin-walkthrough.mp4` (maintainer-only)

- **Status:** Deferred to plan 08-08 (v2.0.0 GitHub Release cut)
- **Reason:** The MP4 is a Release asset, not committed to the repo (D-14).
  The MP4 only needs to exist on the maintainer's machine in time for the
  Release upload, which is plan 08-08's responsibility. 08-04 should not
  block on it — the canonical URL is already wired into the docs (commit
  `ebb33ee`) and the asset is uploaded at release time.
- **Canonical URL:**
  `https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4`
- **Owner:** Maintainer (manual recording per D-13 storyboard) — execution
  during plan 08-08
- **Acceptance criteria (carried forward):** ≤8 min runtime, 1080p MP4, all
  five storyboard sections present, intro/outro title cards

### Task 2 — Produce `docs/v2/plugin/screencast-thumbnail.png`

- **Status:** Deferred to plan 08-08
- **Reason:** The thumbnail is derived from the MP4 (a still frame from
  Section B at ~1:30). It cannot be produced before the recording exists.
  The in-repo path `docs/v2/plugin/screencast-thumbnail.png` is already
  referenced in INSTALL.md and CONTRACT-EDITOR.md (commit `ebb33ee`);
  GitHub renders the markdown image-link as a broken-image placeholder
  until the PNG lands, which is acceptable since docs are not lint-gated
  on link resolution.
- **Owner:** Maintainer (manual still extraction + resize) — execution
  during plan 08-08
- **Acceptance criteria (carried forward):** Width ≤600px, file size
  <200 KB, committed at `docs/v2/plugin/screencast-thumbnail.png`

### Task 4 flag — README.md screencast cross-link

- **Status:** Flagged for plan 08-02 revision (non-blocking)
- **Reason:** Task 4 of 08-04 was a read-only verification that README.md
  references `docs/v2/plugin/screencast-thumbnail.png` or the canonical
  MP4 URL. As of this writing README.md line 279 still carries the
  "deferred to Phase 8" placeholder note and does NOT reference the
  thumbnail or the MP4 URL. README is plan 08-02's territory; 08-04
  cannot modify it. Recommend plan 08-02 revision (or a small follow-up
  plan) to replace the README placeholder with the same canonical pattern
  used in INSTALL.md / CONTRACT-EDITOR.md.
- **Owner:** Plan 08-02 revision (or 08-08 if rolled into the Release cut)
