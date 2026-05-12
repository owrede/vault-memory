/**
 * Content-based heuristic inference.
 *
 * A set of vault-agnostic Title/Body pattern matchers. Each rule emits
 * suggested frontmatter when the input note matches its pattern. Rules
 * are intentionally narrow and self-explanatory — the user (or agent)
 * should be able to read the rule list and predict what will be inferred.
 *
 * Confidence is fixed per rule. Multiple rules CAN match (e.g. a meeting
 * note that mentions a person) — the resolver upstream combines them.
 *
 * No LLM, no embeddings. Pure deterministic RegEx + string scanning.
 */

export interface ContentHeuristicEntry {
  /** Frontmatter key the rule contributes (e.g. "class", "type"). */
  key: string;
  /** Suggested value. */
  value: unknown;
  /** Fixed confidence per rule (0..1). */
  confidence: number;
  /** Which rule fired, for transparency in the tool response. */
  rule: string;
}

export interface ContentHeuristicResult {
  entries: ContentHeuristicEntry[];
  /** Rule names that matched (for the agent's debugging). */
  matchedRules: string[];
}

interface HeuristicRule {
  name: string;
  /**
   * Returns the suggested entries when this rule matches; empty array
   * means the rule did not fire.
   */
  match: (input: HeuristicInput) => Omit<ContentHeuristicEntry, "rule">[];
}

interface HeuristicInput {
  title: string;
  bodyHead: string; // first ~2000 chars of body
  fullBody: string;
}

const DEFAULT_CONFIDENCE = 0.7;
const STRONG_CONFIDENCE = 0.85;
const WEAK_CONFIDENCE = 0.5;

/**
 * Email — matches Title-like "E-Mail von X", "Mail von X", "Email from X",
 * OR a body starting with "From:" / "Von:" header (forwarded mail style).
 */
const emailRule: HeuristicRule = {
  name: "email-title-or-header",
  match: ({ title, bodyHead }) => {
    const titleMatch =
      /^(E-?Mail|Email|Mail)\s+(von|from)\s+\S+/i.test(title) ||
      /^(Re|Fwd|AW|WG):\s/i.test(title);
    const headerMatch =
      /^(From|Von):\s+\S+/im.test(bodyHead) &&
      /^(To|An):\s+\S+/im.test(bodyHead);
    if (!titleMatch && !headerMatch) return [];
    return [
      { key: "class", value: "Email", confidence: STRONG_CONFIDENCE },
      { key: "type", value: "email", confidence: STRONG_CONFIDENCE },
    ];
  },
};

/**
 * Meeting — multi-language: Meeting, Treffen, Call, Sondierung, Termin,
 * Standup, Sync. Title-leading keyword OR a YYYY-MM-DD prefix + such a
 * keyword.
 */
const meetingRule: HeuristicRule = {
  name: "meeting-title-keyword",
  match: ({ title, bodyHead }) => {
    const keywords =
      /\b(Meeting|Treffen|Call|Sondierung|Termin|Standup|Sync|Kickoff|Kick-off|Jour\s*fixe|Workshop)\b/i;
    const isMeeting =
      keywords.test(title) ||
      /^\d{4}-\d{2}-\d{2}.*\b(Meeting|Treffen|Call|Sondierung)/i.test(title);
    if (!isMeeting) return [];
    // Many meeting notes have an "Attendees:" / "Teilnehmer:" line — bump
    // confidence when we see one.
    const attendeesPresent =
      /^(Attendees|Teilnehmer|Participants):/im.test(bodyHead);
    const conf = attendeesPresent ? STRONG_CONFIDENCE : DEFAULT_CONFIDENCE;
    return [
      { key: "class", value: "Meeting", confidence: conf },
      { key: "type", value: "meeting", confidence: conf },
    ];
  },
};

/**
 * Person — short title that looks like a personal name (1-4 capitalized
 * tokens), AND body mentions LinkedIn URL, an email address with the
 * person's name, or a phone-number pattern.
 *
 * Deliberately narrow: many notes have person names in titles (e.g.
 * meeting notes) — we require corroborating signals from the body.
 */
const personRule: HeuristicRule = {
  name: "person-name-title-with-corroboration",
  match: ({ title, bodyHead }) => {
    const nameLike =
      /^[A-ZÄÖÜ][a-zäöüß'\-]+( [A-ZÄÖÜ][a-zäöüß'\-]+){0,3}$/.test(title.trim());
    if (!nameLike) return [];
    const corroborating =
      /linkedin\.com\/in\//i.test(bodyHead) ||
      /\b[\w._-]+@[\w.-]+\.[a-z]{2,}\b/i.test(bodyHead) ||
      /\+?\d[\d\s\-./()]{6,}/.test(bodyHead);
    if (!corroborating) return [];
    return [
      { key: "class", value: "Person", confidence: STRONG_CONFIDENCE },
      { key: "type", value: "person", confidence: STRONG_CONFIDENCE },
      { key: "participation", value: [], confidence: WEAK_CONFIDENCE },
    ];
  },
};

/**
 * Reading note / clipping — body starts with a markdown link to a URL
 * (common Obsidian Web Clipper format), or has a `source:` URL in the
 * first ~500 chars.
 */
const clippingRule: HeuristicRule = {
  name: "clipping-source-url",
  match: ({ bodyHead }) => {
    const headSnippet = bodyHead.slice(0, 500);
    const hasMdLink = /^\s*\[.+\]\(https?:\/\/[^\s)]+\)/m.test(headSnippet);
    const hasSourceField = /^source:\s*https?:\/\//im.test(headSnippet);
    if (!hasMdLink && !hasSourceField) return [];
    return [
      { key: "class", value: "Clipping", confidence: DEFAULT_CONFIDENCE },
      { key: "tags", value: ["clippings"], confidence: DEFAULT_CONFIDENCE },
    ];
  },
};

/**
 * Fact / short-status — very short body (<150 chars), one-line subject,
 * looks like a captured fact or status update.
 *
 * Confidence intentionally low — many short notes are not facts but
 * fragments, drafts, etc.
 */
const factRule: HeuristicRule = {
  name: "short-fact",
  match: ({ fullBody }) => {
    const trimmed = fullBody.trim();
    if (trimmed.length === 0 || trimmed.length > 150) return [];
    // Reject if it contains multiple paragraphs (likely fragment, not fact).
    if (/\n\s*\n/.test(trimmed)) return [];
    return [
      { key: "class", value: "Fact", confidence: WEAK_CONFIDENCE },
    ];
  },
};

/**
 * Date prefix → `created` and (for date-prefixed names) `meeting_date`.
 * Common Obsidian convention.
 */
const dateInTitleRule: HeuristicRule = {
  name: "date-prefix-in-title",
  match: ({ title }) => {
    const m = title.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return [];
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return [
      { key: "created", value: iso, confidence: STRONG_CONFIDENCE },
    ];
  },
};

const RULES: readonly HeuristicRule[] = [
  emailRule,
  meetingRule,
  personRule,
  clippingRule,
  factRule,
  dateInTitleRule,
];

/**
 * Run all rules against the input note. Multiple rules CAN fire (e.g.
 * a date-prefix meeting note matches both `dateInTitleRule` and
 * `meetingRule`). The combiner handles cross-rule conflicts upstream;
 * here we just emit every match.
 */
export function inferFromContent(input: {
  title: string;
  body: string;
}): ContentHeuristicResult {
  const heuristicInput: HeuristicInput = {
    title: input.title,
    bodyHead: input.body.slice(0, 2000),
    fullBody: input.body,
  };

  const entries: ContentHeuristicEntry[] = [];
  const matchedRules: string[] = [];

  for (const rule of RULES) {
    const matches = rule.match(heuristicInput);
    if (matches.length > 0) {
      matchedRules.push(rule.name);
      for (const m of matches) {
        entries.push({ ...m, rule: rule.name });
      }
    }
  }

  return { entries, matchedRules };
}
