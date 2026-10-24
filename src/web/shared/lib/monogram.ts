/** Letters and a hue that stand in for a project that has no icon, the same for the same name. */
export function monogram(name: string): { letters: string; hue: number } {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return { letters: letters || "?", hue: hash % 360 };
}
