import { describe, it, expect } from "vitest";
import { inferFromContent } from "./content-heuristics.js";

describe("content-heuristics: emailRule", () => {
  it("matches 'E-Mail von X' title", () => {
    const r = inferFromContent({
      title: "E-Mail von Jörg",
      body: "Hi, hier ein paar Gedanken.",
    });
    expect(r.matchedRules).toContain("email-title-or-header");
    const keys = r.entries.map((e) => e.key);
    expect(keys).toContain("class");
    expect(keys).toContain("type");
    const classEntry = r.entries.find((e) => e.key === "class")!;
    expect(classEntry.value).toBe("Email");
  });

  it("matches forwarded-mail headers in body", () => {
    const r = inferFromContent({
      title: "Forwarded text",
      body: "From: alice@example.com\nTo: bob@example.com\nSubject: hi\n\nbody",
    });
    expect(r.matchedRules).toContain("email-title-or-header");
  });

  it("matches Re:/Fwd: title prefixes", () => {
    expect(inferFromContent({ title: "Re: project update", body: "body" }).matchedRules).toContain(
      "email-title-or-header",
    );
    expect(inferFromContent({ title: "AW: Sondierung", body: "body" }).matchedRules).toContain(
      "email-title-or-header",
    );
  });

  it("does not match plain titles", () => {
    const r = inferFromContent({ title: "Random note", body: "body" });
    expect(r.matchedRules).not.toContain("email-title-or-header");
  });
});

describe("content-heuristics: meetingRule", () => {
  it("matches title with German keyword 'Treffen'", () => {
    const r = inferFromContent({
      title: "Treffen mit Jörg",
      body: "body",
    });
    expect(r.matchedRules).toContain("meeting-title-keyword");
    const classEntry = r.entries.find((e) => e.key === "class");
    expect(classEntry?.value).toBe("Meeting");
  });

  it("matches Sondierung + date prefix", () => {
    const r = inferFromContent({
      title: "2026-05-12 Sondierung Firmierung",
      body: "Teilnehmer: A, B",
    });
    expect(r.matchedRules).toContain("meeting-title-keyword");
    // Date prefix also fires.
    expect(r.matchedRules).toContain("date-prefix-in-title");
    const created = r.entries.find((e) => e.key === "created");
    expect(created?.value).toBe("2026-05-12");
  });

  it("bumps confidence when Teilnehmer/Attendees are present", () => {
    const withAttendees = inferFromContent({
      title: "Sync Call",
      body: "Attendees: Alice, Bob",
    }).entries.find((e) => e.key === "class")!;
    const noAttendees = inferFromContent({
      title: "Sync Call",
      body: "Notes from the call.",
    }).entries.find((e) => e.key === "class")!;
    expect(withAttendees.confidence).toBeGreaterThan(noAttendees.confidence);
  });

  it("does not match plain titles", () => {
    const r = inferFromContent({
      title: "Random thoughts",
      body: "body",
    });
    expect(r.matchedRules).not.toContain("meeting-title-keyword");
  });
});

describe("content-heuristics: personRule", () => {
  it("matches a Person name title with LinkedIn corroboration", () => {
    const r = inferFromContent({
      title: "Jörg Herbers",
      body: "https://linkedin.com/in/joerg-herbers/",
    });
    expect(r.matchedRules).toContain("person-name-title-with-corroboration");
    const fields = r.entries.map((e) => e.key);
    expect(fields).toContain("class");
    expect(fields).toContain("type");
    expect(fields).toContain("participation");
  });

  it("matches a Person name with email corroboration", () => {
    const r = inferFromContent({
      title: "Alice Schmidt",
      body: "alice.schmidt@example.com",
    });
    expect(r.matchedRules).toContain("person-name-title-with-corroboration");
  });

  it("rejects all-lowercase titles (clearly not a name)", () => {
    const r = inferFromContent({
      title: "notes from today",
      body: "alice@example.com",
    });
    expect(r.matchedRules).not.toContain("person-name-title-with-corroboration");
  });

  it("rejects name without corroboration", () => {
    const r = inferFromContent({ title: "Alice Schmidt", body: "no signals" });
    expect(r.matchedRules).not.toContain("person-name-title-with-corroboration");
  });
});

describe("content-heuristics: clippingRule", () => {
  it("matches markdown-link source", () => {
    const r = inferFromContent({
      title: "Article title",
      body: "[Original](https://example.com/article)\n\nQuoted text...",
    });
    expect(r.matchedRules).toContain("clipping-source-url");
    const tags = r.entries.find((e) => e.key === "tags");
    expect(tags?.value).toEqual(["clippings"]);
  });

  it("matches `source:` field", () => {
    const r = inferFromContent({
      title: "Article",
      body: "source: https://example.com/foo\n\nBody",
    });
    expect(r.matchedRules).toContain("clipping-source-url");
  });
});

describe("content-heuristics: factRule", () => {
  it("matches a single short line", () => {
    const r = inferFromContent({
      title: "Status update",
      body: "INIM-1234 is now done.",
    });
    expect(r.matchedRules).toContain("short-fact");
  });

  it("rejects long bodies", () => {
    const longBody = "x".repeat(200);
    const r = inferFromContent({ title: "Status", body: longBody });
    expect(r.matchedRules).not.toContain("short-fact");
  });

  it("rejects multi-paragraph short bodies", () => {
    const r = inferFromContent({
      title: "Notes",
      body: "Part one.\n\nPart two.",
    });
    expect(r.matchedRules).not.toContain("short-fact");
  });
});

describe("content-heuristics: dateInTitleRule", () => {
  it("extracts ISO date from date-prefix title", () => {
    const r = inferFromContent({
      title: "2026-01-15 Note",
      body: "body",
    });
    expect(r.matchedRules).toContain("date-prefix-in-title");
    const created = r.entries.find((e) => e.key === "created");
    expect(created?.value).toBe("2026-01-15");
  });

  it("does not match invalid date-like titles", () => {
    const r = inferFromContent({
      title: "Note 12 of 99",
      body: "body",
    });
    expect(r.matchedRules).not.toContain("date-prefix-in-title");
  });
});
