export type IconSignal = "page" | "prefix" | "slash" | null;

function labelTokens(value: string): string[] {
  return value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

/**
 * Three-signal icon classifier.
 *
 *  Precedence on multi-match: page > prefix > slash.
 *
 *  Signals:
 *   - "page":  pageName matches /^icons?$/i  (the page is literally called "Icon" or "Icons")
 *   - "prefix": componentName matches /^(ic[-_]|icon[\/_])/i  OR  /.+\.icon$/i
 *   - "slash": componentName starts with "Icon/" or "Icons/" (the Figma slash-convention)
 *
 *  Returns null if none of the signals fire.
 */
export function detectIconSignal(input: {
  pageName: string;
  componentName: string;
}): IconSignal {
  const { pageName, componentName } = input;

  // Page-name signal — strongest authorial intent
  if (labelTokens(pageName).some((token) => token === "icon" || token === "icons")) return "page";

  // Prefix signal
  // /^(ic[-_]|icon_)/i matches: ic_arrow, ic-arrow, icon_arrow
  // /.+\.icon$/i matches: arrow.icon, foo.icon
  if (/^(ic[-_]|icon_)/i.test(componentName) || /.+\.icon$/i.test(componentName)) {
    return "prefix";
  }

  // Slash signal — Figma "Icon/Arrow/Left" or "Icons/Arrow"
  if (/^(icons?\/)/i.test(componentName)) return "slash";

  return null;
}
