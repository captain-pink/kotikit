/**
 * Build the value of the `name_tokens` FTS5 column.
 *
 * Examples:
 *   "IconArrowLeft" → "IconArrowLeft Icon Arrow Left"
 *   "Button"        → "Button"
 *   "PieChart 3D"   → "PieChart 3D Pie Chart 3 D"
 *   "TextField"     → "TextField Text Field"
 *   "ic_arrow"      → "ic_arrow ic arrow"
 *   "HTTPSConfig"   → "HTTPSConfig HTTPS Config"   (acronyms stay grouped)
 *
 * Strategy:
 *   - Always include the original string.
 *   - Split on transitions: lowercase→uppercase, letter→digit, digit→uppercase,
 *     `_`, `-`, `/`, whitespace.
 *   - Acronyms stay grouped (consecutive uppercase letters do NOT split between
 *     themselves, only at the transition where the acronym ends).
 *   - Drop empty tokens, deduplicate (preserve order), and join with spaces.
 */
export function buildNameTokens(name: string): string {
  const split = name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2") // camelCase: aB or 3B → a B / 3 B
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // acronym end: HTTPSConfig → HTTPS Config
    .replace(/([a-zA-Z])(\d)/g, "$1 $2") // letter→digit boundary
    .replace(/(\d)([A-Z])/g, "$1 $2") // digit→uppercase boundary (e.g. 3D)
    .replace(/[_/\-\s]+/g, " ") // separators → space
    .trim()
    .split(/\s+/);

  const tokens = split.filter(Boolean);
  const tokenSet = new Set(tokens);

  // Include the original only when at least one of its whitespace-split words
  // is NOT already covered by the token set.  This ensures that a plain
  // repeated input such as "Button Button" collapses to just "Button", while
  // a compound such as "PieChart 3D" is preserved because "PieChart" (the
  // un-split form) is not present in the token set.
  const originalWords = name.split(/\s+/).filter(Boolean);
  const originalAddsValue = originalWords.some((w) => !tokenSet.has(w));
  const combined = originalAddsValue ? [name, ...tokens] : tokens;
  const out = combined.filter((t, i, arr) => arr.indexOf(t) === i);
  return out.join(" ");
}
