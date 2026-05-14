/**
 * Minimal glob-pattern matcher for vault-relative paths.
 *
 * Supports the Obsidian/gitignore-style subset we need:
 *   - `*`  matches zero or more chars except `/`
 *   - `**` matches zero or more chars including `/`
 *   - `?`  matches exactly one char except `/`
 *   - Other characters match literally (regex-special chars are escaped)
 *
 * No brace expansion, no character classes, no negation. If we ever need
 * those we'll add picomatch — but every additional dependency in this
 * package costs us npm-install pain (better-sqlite3 already gave us
 * trouble), so we keep it tiny.
 */

/** Convert a glob into an anchored regex source. Cached per pattern. */
const cache = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;

  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  const compiled = new RegExp(`^${re}$`);
  cache.set(pattern, compiled);
  return compiled;
}

/**
 * True iff `path` matches any of the given glob patterns. Empty pattern
 * list returns false (no exclusion).
 */
export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (compile(p).test(path)) return true;
  }
  return false;
}
