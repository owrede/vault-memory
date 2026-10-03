export interface ContextExcerpt {
  text: string;
  truncated: boolean;
  original_chars: number;
}
export function projectContext(text: string, max_chars: number): ContextExcerpt {
  if (!Number.isSafeInteger(max_chars) || max_chars < 0) {
    throw new RangeError("max_chars must be a non-negative safe integer");
  }
  let end = Math.min(text.length, max_chars);
  // Budgets count UTF-16 code units, while avoiding a split surrogate pair.
  if (
    end > 0 &&
    end < text.length &&
    text.charCodeAt(end - 1) >= 0xd800 &&
    text.charCodeAt(end - 1) <= 0xdbff &&
    text.charCodeAt(end) >= 0xdc00 &&
    text.charCodeAt(end) <= 0xdfff
  )
    end--;
  return { text: text.slice(0, end), truncated: end < text.length, original_chars: text.length };
}
